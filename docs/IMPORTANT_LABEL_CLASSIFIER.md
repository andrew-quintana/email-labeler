# Important label classifier: implementation and ongoing training

This document describes the **Important** label NN model: a binary classifier that predicts whether an email should have Gmail's IMPORTANT label. It is trained from user feedback (when you add or remove Important on an email) and its output is intended to drive adding/removing the IMPORTANT label in `label-one-message`. The same sync-and-train pattern is reused for the (future) label router.

---

## 1. Goal

- **Assign**: For each new email we process, predict **important** (true/false) and add or remove the Gmail `IMPORTANT` label via `modifyMessageLabels`.
- **Learn**: Use manual changes (you add or remove Important) as training signal. Once per day, sync current Important state from Gmail and retrain the head on rows where Important was changed since last sync.

---

## 2. Architecture

- **Embedding**: Fixed encoder (sentence-transformers, e.g. `all-MiniLM-L6-v2`). Input = summary or summary + snippet; output = 384-d vector.
- **Head**: Binary classifier (sklearn `LogisticRegression`). One linear layer + sigmoid; input = embedding, output = P(important). No hidden layers.
- **Artifact**: Pickle at Supabase Storage `models/important-classifier/latest.pkl`: `{ "embedder_name": str, "classifier": LogisticRegression }`. Inference loads this and runs embed → head → threshold (e.g. 0.5) to get a boolean.

**Cold start**: If no artifact exists, we do not set IMPORTANT (only category labels). After the first training run produces a model, inference can apply Important.

---

## 3. RL / bandit formulation (s, a, r, s')

| Symbol | Meaning |
|--------|--------|
| **s** | **State**: The embedding of the email (summary or summary + snippet). What we observe before deciding. |
| **a** | **Action**: Binary — add IMPORTANT (1) or remove IMPORTANT (0). |
| **r** | **Reward**: Implicit in training. We train on (embedding, user's Important). So r = 1 when the user's current Important state matches the target we learn; r = 0 (wrong) when the user changed it after we applied. |
| **s'** | **Next state**: The same email with updated Gmail labels (including IMPORTANT). Used only to define r after **sync-labels-nightly**; we do not model transitions. |

This is a one-shot (bandit) setting: (s, a, r) per email; s' is only used to compute r at sync time.

---

## 4. Implementation

### 4.1 Persistence (Supabase)

- **processed_emails**: For each processed message we store `message_id`, `body`, `summary`, `label_ids` (at processing time), `label_applied`, **`important`** (boolean or null), **`important_updated`** (boolean), and (after nightly sync) **`label_ids_current`**, **`labels_synced_at`**.
- **important**: Current Important state we have on record (from our apply or from last sync).
- **important_updated**: Set to `true` when the nightly sync finds that Gmail's Important state differs from what we had stored (user added or removed Important since last check). This flag selects rows for training.

### 4.2 Sync: sync-labels-nightly

- **Task**: `sync-labels-nightly` (Trigger.dev scheduled task).
- **What it does**: For each row in `processed_emails` with `processed_at` in **today** (UTC), fetches current Gmail label IDs for that message. Sets:
  - `important` = whether `IMPORTANT` is in the label list.
  - `important_updated` = true if this `important` value is different from the previous stored value.
  - `label_ids_current` = full list of Gmail label IDs (for all-labels feedback, including future label router).
  - `labels_synced_at` = now.
- **Code**: `src/trigger/sync-labels-nightly.ts`; DB helpers in `src/db/important-update.ts` (`getProcessedEmailsForDay`, `updateLabelsForMessage`).
- **Schedule**: Run once per day (e.g. end of day) before training.

### 4.3 Training: train-important-classifier

- **Task**: `train-important-classifier` (Trigger.dev scheduled task). Run after **sync-labels-nightly**.
- **Input**: Rows from `processed_emails` where **`important_updated = true`** (and `important` is not null). Each row gives (summary or body, important).
- **Pipeline**:
  1. Build training data: `[{ text: summary || body, important: boolean }, ...]` (text truncated to 10k chars).
  2. Write JSON to a temp file and call Python script `python/train_important.py <data.json> <output.pkl>`.
  3. Script: load sentence-transformers (default `all-MiniLM-L6-v2`), embed all texts, train sklearn `LogisticRegression`, pickle `{ embedder_name, classifier }`.
  4. Upload the pickle to Supabase Storage bucket `models`, key `important-classifier/latest.pkl` (upsert).
- **Code**: `src/trigger/train-important-classifier.ts`, `python/train_important.py`.
- **Dependencies**: `@trigger.dev/python`; Python deps in `requirements.txt`: `sentence-transformers`, `scikit-learn`. If Python is unavailable, the task logs and returns without saving a model.

### 4.4 Inference (in label-one-message)

- After the graph (summary, label_router), `label-one-message` calls `inferImportant(summaryText)` from `src/ml/important-inference.ts`.
- This downloads the artifact from Supabase Storage (`models/important-classifier/latest.pkl`), writes it to a temp file, and calls `python/infer_important.py` via `@trigger.dev/python`.
- The Python script loads the pickle, embeds the text with the same sentence-transformers model, runs the classifier, thresholds at 0.5, and returns `{ important: boolean, probability: float }`.
- Gmail `modifyMessageLabels` includes `IMPORTANT` in `addLabelIds` (if true) or `removeLabelIds` (if false).
- Persists `important: model_important` and `important_updated: false` when recording the processed email.
- **Cold start**: If no artifact exists or inference fails, `important: null` is recorded and IMPORTANT is not modified.

**Key files for inference**: `python/infer_important.py`, `src/ml/important-inference.ts`, `src/trigger/label-one-message.ts`.

---

## 5. Ongoing training flow

1. **Throughout the day**: `label-one-message` processes new emails, records rows with `important: null` (or, when inference is added, `important: model_important`), `important_updated: false`. You manually add/remove Important on some emails in Gmail.
1b. **Each poll-and-label run**: For processed emails with `labels_synced_at = null`, poll-and-label fetches their current Gmail state and syncs them only when the user actually interacted (read the email, changed labels, or changed archive status). Unmodified emails are left unsynced so the next run reconsiders them. This provides faster feedback than waiting for the nightly sync.
2. **Nightly (e.g. 00:00 UTC)**: **sync-labels-nightly** runs. For every processed email from that day, it fetches current Gmail labels and updates `important`, `important_updated`, `label_ids_current`, `labels_synced_at`. Rows where you changed Important get `important_updated = true`.
3. **After sync**: **train-important-classifier** runs. It loads all rows with `important_updated = true`, builds (text, important) pairs, runs the Python script (embed + logistic regression), and uploads the new model to `models/important-classifier/latest.pkl`.
4. **Next day**: New runs of `label-one-message` (once inference is added) will load the updated artifact and apply Important using the new weights.

No separate "promotion" step: the artifact is always `latest.pkl`; each successful training run overwrites it.

---

## 6. Key files

| Path | Purpose |
|------|--------|
| `python/train_important.py` | Embed (sentence-transformers) + train LogisticRegression; reads JSON, writes pickle. |
| `python/infer_important.py` | Load pickle, embed text, run classifier, return `{ important, probability }`. |
| `src/ml/important-inference.ts` | Download artifact from Storage, call Python infer script, return result or null. |
| `src/trigger/train-important-classifier.ts` | Trigger.dev task: get feedback rows, call Python script, upload to Storage. |
| `src/trigger/sync-labels-nightly.ts` | Trigger.dev task: fetch today's processed emails, get Gmail labels, update `important`, `important_updated`, `label_ids_current`, `labels_synced_at`. |
| `src/trigger/label-one-message.ts` | Calls `inferImportant()` after graph, applies IMPORTANT via Gmail, records result. |
| `src/db/important-update.ts` | `getProcessedEmailsForDay`, `getProcessedEmailsWithNullLabelsSynced`, `updateLabelsForMessage`, `getFeedbackRowsForTraining`, `IMPORTANT_LABEL_ID`. |
| `src/db/record.ts` | Records processed emails (body, label_ids, summary, important, etc.). |
| Supabase Storage | Bucket `models`, key `important-classifier/latest.pkl`. |

---

## 7. References

- **Single label router (same pattern)**: `docs/SINGLE_LABEL_ROUTER_RL.md` — same embedding + head + sync + train pattern for the category label router.
- **AGENTS.md**: Project overview, Trigger.dev tasks, config.
