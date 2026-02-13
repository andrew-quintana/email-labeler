# Single label router with per-label weights and learning from feedback

This document describes the design and implementation plan for replacing the current **two-stage category → subcategory** pipeline with a **single router** that assigns a **weight (score) to each label**, and learns from user corrections (RL / learning from feedback). The goal is to align with the n8n-style "one pass over all labels" (see `docs/n8n/n8n_email_labeling.json`) while making the system less brittle to model changes and easy to extend with new labels.

---

## 1. Goal and benefits

- **One router for all labels**: No category → subcategory chain. One model considers the full list of labels (e.g. from `config/leaf_rules.json` or a flat label list) and outputs a weight per label.
- **Two-part scoring**: The **label router** outputs a weight **0–100** for each label (content-based). The **NN head** (trained from feedback) outputs a weight **0–1** for each label. **Final score** per label = (router weight 0–100) × (NN head weight 0–1). The applied label is argmax of these final scores (or fallback when max is below a threshold).
- **Learning from feedback (including mislabeled emails)**: The system must learn from **mislabeled** emails: when we applied the wrong label and the user moved the email to a different one, that correction trains both the important classifier and the label router. Track "label we applied" and "labels after user edits" (all Gmail labels at sync time). A single nightly task (**sync-labels-nightly**) captures **all labels** for each processed message so we can derive the user's effective label and feed corrections into training.
- **Less brittle**: Routing logic lives in an embedding + small trained head, not in LLM prompts or category trees. Changing summarizer or LLM only affects the embedding input; the router can be retrained or left as-is.
- **Easy to add labels**: Add a new output dimension to the head, optionally bootstrap with a few examples or LLM seed data, then let feedback drive the rest. No prompt or tree redesign.

---

## 2. Current vs target architecture

### Current (codebase)

- **Graph**: `summarize → category_router (Gemini) → subcategory_router (Gemini) → END`
- **State**: `summary`, `category`, `subcategory`, `categoryConfidence`, `subcategoryConfidence`
- **Apply**: `resolveLabelAndArchive(state, config)` uses rules + thresholds; label = `emoji-category-subcategory` from config (e.g. `leaf_rules.json`, `categories.json`).
- **Labels**: Hierarchical (category + subcategory); label set derived from config.

### Target (this design)

- **Graph**: `summarize → label_router → END` (no category/subcategory nodes).
- **Label router**: Two components feed into the final score per label:
  - **Router weights (0–100)**: One weight per label from the router (e.g. from embedding + a content-based or rule-based component). Range 0–100.
  - **NN head weights (0–1)**: One weight per label from the trained head (embedding → small NN or logistic regression). Range 0–1, learned from user feedback.
  - **Final score** = router_weight × nn_head_weight per label. Apply label = `labels[argmax(final_scores)]`. Optional: fallback to "Review" or "other" when max final score is below a threshold.
- **Label set**: Single flat list of display labels (e.g. the `name` values from `leaf_rules` or a dedicated `config/labels.json`). Same list as in n8n (e.g. `💼-work-projects`, `👤-personal-family`, …, `other`).
- **Feedback**: Persist `(message_id, summary_or_embedding, label_applied, label_ids_after_user_edits, processed_at)`. When user changes labels, we detect "label_applied != current label" and record a correction for training. The **sync-labels-nightly** task (renamed from update-important-nightly) fetches **all** current Gmail label IDs for each processed message and stores them (`label_ids_current`, `labels_synced_at`) so we can derive the user's effective label and treat mislabeled emails as training signal.
- **Training**: Nightly (or periodic) job: load corrections, embed text, train head (e.g. multi-class logistic regression or small NN) to predict "user's label" from embedding. Save updated head to storage (e.g. Supabase Storage `models/label-router/latest.pkl`). Inference in `label-one-message` loads this artifact.

---

## 3. Components (implementation detail)

### 3.1 Label set and config

- **Source of truth**: A single ordered list of label names (strings) used for both inference and training. Suggested: `config/labels.json` (array of strings) or derive from `leaf_rules` by collecting unique `name` (or a new `config/flat_labels.json`). Must include a fallback, e.g. `other` or `unlabeled`.
- **Mapping to Gmail**: Keep existing `gmail_labels.json` or equivalent to map label name → Gmail label ID. Archive behavior can stay in `archive_labels.json` (list of label names that trigger archive).

### 3.2 Embedding

- **Model**: Same as important classifier (e.g. sentence-transformers `all-MiniLM-L6-v2`) for consistency. Input: summary only, or `summary + "\n" + snippet` for a bit more context.
- **Output**: Fixed-size vector (e.g. 384 dims). Stored in training data and computed at inference time.

### 3.3 Scoring: router weights (0–100) × NN head weights (0–1)

- **Label router** (content-based): Produces one **router weight** per label in the range **0–100**. This can come from an embedding + linear layer (or rule-based scores, or a first-stage classifier) and reflects how much the content matches each label. Normalize or clamp so each value is in [0, 100].
- **NN head** (learned from feedback): Produces one **head weight** per label in the range **0–1** (e.g. sigmoid or softmax output). Same pattern as the important classifier: embedding → small NN or logistic regression → one value per label, trained on user corrections.
- **Final score** (per label): **`final_score[i] = router_weight[i] × nn_head_weight[i]`** Then apply label = `label_list[argmax(final_score)]`. Multiplying ensures the NN head acts as a learned bias/multiplier on the router: even if the router says 80 for a label, the head can down-weight it to 0.3 so the effective score is 24, or up-weight another label to win.
- **Artifact**: Persist the NN head the same way as important classifier (e.g. pickle with embedder_name, classifier, label_list at `models/label-router/latest.pkl`). The router weights (0–100) may come from the same model or a separate path; the head output (0–1) is what gets trained from feedback.

### 3.4 Inference (label-one-message)

- After summarizer runs: embed `state.summary.summary` (and optionally snippet).
- **Router weights (0–100)**: Compute one weight per label from the router (embedding + router model or rules). Ensure each is in [0, 100].
- **NN head weights (0–1)**: Load the label-router artifact from storage; run the head on the embedding → one weight per label in [0, 1]. Cold start: use 1.0 for all labels so final score = router weight only.
- **Final scores**: For each label, `final_score[i] = router_weight[i] × nn_head_weight[i]`.
- Apply label = `label_list[argmax(final_scores)]`. If max final score < threshold, apply fallback label (e.g. `other` or `Review`).
- Apply that single label (and archive per config). No category/subcategory in state; only `summary` and router output (label name, optional router weights, head weights, and final scores).

### 3.5 Feedback collection (including mislabeled emails)

- **On apply**: Persist for each processed message: `message_id`, `summary` (or store embedding to avoid re-embedding later), `label_applied`, `label_ids` (Gmail label IDs after our apply), `processed_at`.
- **Incremental sync (poll-and-label)**: Each **poll-and-label** run loads processed emails with `labels_synced_at = null`, fetches their current Gmail state, and syncs (`label_ids_current`, `labels_synced_at`, `important`, `important_updated`) only when the user actually interacted (read the email, changed labels, or changed archive status). Unmodified emails are left unsynced so the next run reconsiders them. This provides faster feedback than waiting for the nightly sync.
- **Nightly - sync-labels-nightly**: The nightly task is **sync-labels-nightly** (not just "update important"). It fetches **all** current Gmail label IDs for each processed message from that day and updates the row: `important`, `important_updated`, **`label_ids_current`**, **`labels_synced_at`**. From `label_ids_current` we resolve which of our known labels the user has now. When that differs from `label_applied`, that is a **mislabeled email** and a correction for training. This single task feeds both the important classifier and the label router.
- **Training dataset**: Rows of the form `(text_or_embedding, target_label)` where `target_label` is the user's effective label (from `label_ids_current` or derived). Include **mislabeled** emails (we applied A, user has B) so the model learns to correct them. Optionally weight by "user changed" vs "user left as-is" (e.g. higher weight for corrections).

### 3.6 Training job

- **Input**: Feedback rows with `(summary/text, target_label)`.
- **Pipeline**: Embed all texts with the same sentence-transformers model; train multi-class head (e.g. `sklearn.linear_model.LogisticRegression` multi_class='multinomial', or a small PyTorch NN). Save artifact with `label_list` and embedder name.
- **Output**: Upload to Supabase Storage (or same store as important classifier) at `models/label-router/latest.pkl`. Next inference run will pick it up (load on startup or on first use).

### 3.7 Persistence (Supabase)

- **processed_emails** (existing): Keep `message_id`, `body`, `summary`, `label_ids` (at processing time), `label_applied`, `processed_at`, etc. The **sync-labels-nightly** task sets **`label_ids_current`** (all Gmail label IDs at sync time) and **`labels_synced_at`**. From `label_ids_current` we derive the user's effective label for training (and detect mislabeled emails when it differs from `label_applied`).
- **Feedback for router**: Use the same table: rows where "resolved label from label_ids_current" != label_applied are corrections (mislabeled emails). Optionally a separate `label_feedback` table for explicit feedback rows.
- **Model artifact**: Stored in object storage (e.g. Supabase Storage bucket `models`, key `label-router/latest.pkl`).

### 3.8 RL / bandit formulation (s, a, r, s')

The label router is trained from user feedback in a **contextual bandit** setting: one decision per email, with no multi-step transition. The tuple **(s, a, r, s')** is:

| Symbol | Meaning |
|--------|--------|
| **s** | **State**: The embedding of the email (summary or summary + snippet). What we observe before choosing a label. |
| **a** | **Action**: Which label we apply. a ∈ {label_1, …, label_K}. |
| **r** | **Reward**: Implicit in training. r = 1 when the user's effective label (from `label_ids_current` after sync) matches what we want to predict; r = 0 (or wrong) when we applied A and the user has B (mislabeled). We train the head with supervised (s, target_label) so reward is "correct class." |
| **s'** | **Next state**: The same email with updated Gmail labels (`label_ids_current` at sync). Used only to compute r (resolve user's effective label); we do not model transitions. |

Training uses (s, target_label) where target_label is derived from s'; the NN head learns to predict the user's label from the embedding.

---

## 4. Adding new labels

1. **Config**: Add the new label name to the flat label list (e.g. `config/labels.json` or the source used by the router). Ensure Gmail label exists (or create via API) and archive config updated if needed.
2. **Model**: Extend the head with one more output (new column in the weight matrix). Initialize to zero or small random so the new label doesn't dominate until it has feedback.
3. **Training**: Include the new label in `label_list` in the artifact. Next training run will have feedback rows that reference the new label once users start using it; no prompt or tree change.
4. **Cold start**: Optionally bootstrap with a few (embedding, new_label) examples from an LLM call or rules, then run one training pass.

---

## 5. Implementation phases (suggested)

1. **Phase 1 – Config and label list**: Introduce `config/labels.json` (or equivalent) with the flat list of labels; loader and mapping to Gmail IDs; no change to pipeline yet.
2. **Phase 2 – Router model and inference**: Implement embedding + head (load from artifact or use a random/zero head for cold start). Replace category_router + subcategory_router in the graph with a single `label_router` node that runs embed + head and writes chosen label (and optional scores) to state. Update `resolveLabelAndArchive` to use state.label from the router instead of category/subcategory.
3. **Phase 3 – Feedback**: Persist `label_applied` and, when available, "user's current label" (from re-fetch or history). Build training dataset from corrections.
4. **Phase 4 – Training job**: Nightly (or scheduled) task that loads feedback, embeds, trains head, uploads artifact. Reuse patterns from `train-important-classifier` (Python script + Trigger.dev task).
5. **Phase 5 – Tuning**: Threshold for fallback label, weighting of "no change" vs "user changed" in training, and optional bootstrap for new labels.

---

## 6. Prompt to execute implementation

For a **combined prompt** that includes both (A) completing the Important NN inference in label-one-message and (B) implementing the single label router and its head, use **docs/PROMPT_IMPORTANT_AND_LABEL_ROUTER.md**.

Alternatively, copy the block below to implement **only** the single label router (no Important inference changes).

```markdown
Implement the "single label router with per-label weights and learning from feedback" design in this repo, as specified in docs/SINGLE_LABEL_ROUTER_RL.md.

Context:
- This repo is an email labeling worker on Trigger.dev (see AGENTS.md). Current pipeline: summarize → category_router (Gemini) → subcategory_router (Gemini) → resolve label from config and apply.
- The target is: summarize → label_router with two-part scoring: router outputs weights 0–100 per label, NN head outputs weights 0–1 per label; final score per label = router_weight × nn_head_weight; apply label = argmax(final_scores). The head is trained from user corrections (we apply label A, user moves to B → train on (embedding, B)).
- Important classifier already uses: sentence-transformers embedding + sklearn LogisticRegression, trained nightly from feedback, artifact in Supabase Storage. Reuse the same patterns where possible.

Do the following:

1. **Config and label list**
   - Add a single source of truth for the flat list of label names (e.g. config/labels.json or derive from existing leaf_rules). Ensure the list is ordered and stable (used as output order for the head). Document in the config loader.
   - Keep mapping from label name to Gmail label ID and archive behavior (e.g. gmail_labels.json, archive_labels.json) working with this list.

2. **Label router model (inference)**
   - Implement two-part scoring: (a) **Router weights (0–100)**: from summary/snippet (e.g. embed + linear layer or rules), one weight per label in [0, 100]. (b) **NN head weights (0–1)**: load artifact, run head on embedding to get one weight per label in [0, 1]. (c) **Final score** per label = router_weight × nn_head_weight. (d) Apply label = label_list[argmax(final_scores)].
   - Model artifact: NN head only (same format as important classifier: pickle with embedder_name, classifier, label_list), stored at models/label-router/latest.pkl. Router weights 0–100 can come from the same or a separate model. Cold start: use nn_head_weight = 1.0 for all labels so final score = router weight only.
   - Integrate into the orchestration graph: replace category_router and subcategory_router with one node that computes router weights, head weights, final scores, and sets state.label (and state.routerWeights, state.headWeights, state.finalScores if useful). Update state type and apply.ts to use state.label and optional threshold for fallback label.

3. **Feedback collection (including mislabeled emails)**
   - Persist label_applied and label_ids for each processed message (already partly there). The **sync-labels-nightly** task captures **all labels** (label_ids_current) for each message; from that derive the user's effective label. Rows where label_applied != resolved label from label_ids_current are **mislabeled emails** and must be used as training signal. Produce a training dataset: (text or embedding, target_label) where target_label is the user's effective label (from label_ids_current).

4. **Training job**
   - Add a Trigger.dev task (e.g. train-label-router) that: loads feedback rows, embeds texts with sentence-transformers, trains a multi-class head (sklearn LogisticRegression multinomial or equivalent), saves artifact with label_list, uploads to Supabase Storage at models/label-router/latest.pkl. Reuse the pattern from train-important-classifier (Python script, @trigger.dev/python, same bucket).

5. **Tests and docs**
   - Add or update tests for the new router and apply logic. Keep existing scripts (e.g. test-label-one.mjs) working with the new pipeline. Update AGENTS.md and any README to describe the single-router + feedback flow.

Do not change the n8n JSON file or the important classifier; only add or refactor the category/subcategory path into the single label router and its training pipeline.
```

---

## 7. References

- **n8n single-label flow**: `docs/n8n/n8n_email_labeling.json` — one "Give a Label AI Agent" that outputs a single `email_label` from a flat list.
- **Important classifier (pattern to reuse)**: `docs/IMPORTANT_LABEL_CLASSIFIER.md` — full implementation and ongoing training; `python/train_important.py`, `src/trigger/train-important-classifier.ts`, Supabase Storage `models/important-classifier/latest.pkl`.
- **Current orchestration**: `src/orchestration/graph.ts`, `nodes.ts`, `apply.ts`, `state.ts`.
- **Config**: `config/leaf_rules.json`, `config/categories.json`, `config/archive_labels.json`, `config/gmail_labels.json`.
