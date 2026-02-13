# Email Labeler

An AI-powered Gmail email-labeling pipeline on **Trigger.dev**. Automatically classifies incoming emails into your custom label taxonomy using LLMs (Anthropic + Gemini) with reinforcement learning from your corrections.

**Clone this repo, fill out the setup form, and deploy your own email labeler.**

## How it works

```
New email arrives
       │
       ▼
  poll-and-label (scheduled)
       │ lists unlabeled messages
       ▼
  label-one-message (per email)
       │
       ├── 1. Fetch from Gmail API
       ├── 2. Parse (cheerio)
       ├── 3. Summarize (Anthropic Claude)
       ├── 4. Label Router (Gemini × NN head)
       │      router_weight (0-100) × nn_head (0-1)
       │      label = argmax(final_scores)
       ├── 5. Important Classifier (NN)
       ├── 6. Apply labels in Gmail
       └── 7. Record to Supabase (optional)

  Nightly:
       ├── sync-labels-nightly (capture user corrections)
       ├── train-important-classifier (binary NN from feedback)
       └── train-label-router (multi-class NN from feedback)
```

- **poll-and-label**: Lists messages with no user-applied label, triggers labeling per message. Also syncs previously processed emails when you've interacted with them (read, relabeled, archived).
- **label-one-message**: Fetches → parses → summarizes → classifies → applies label + optional IMPORTANT → records to DB.
- **Learns from you**: When you correct a mislabeled email, nightly jobs retrain the NN models so classification improves over time.

No GCP push (Pub/Sub, Cloud Functions) needed. Everything runs inside Trigger.dev with Gmail OAuth and your LLM keys.

## Quick Start

### 1. Clone and install

```bash
git clone https://github.com/andrew-quintana/email-labeler.git
cd email-labeler
pnpm install
```

### 2. Configure your label taxonomy

**Option A — Use the AI setup prompt (recommended):**
1. Open `SETUP_PROMPT.md`
2. Fill out the form with your categories, subcategories, and preferences
3. Paste the filled form into your AI coding agent (Cursor, Copilot, etc.)
4. The agent updates all config files, prompts, and label descriptions automatically

**Option B — Edit config files manually:**
- `config/categories.json` — Your category names
- `config/subcategories.json` — Subcategories per category
- `config/labels.json` — Flat label list (single source of truth)
- `config/archive_labels.json` — Which labels trigger archiving
- `src/config/labelFormat.ts` — Category emoji map
- `src/orchestration/nodes.ts` — Label descriptions for the LLM

Run `pnpm run verify:config` after any changes.

### 3. Environment variables

Copy `.env.example` to `.env` and fill in:

| Variable | Required | Description |
|----------|----------|-------------|
| `TRIGGER_SECRET_KEY` | Yes | From Trigger.dev dashboard → your project → API keys |
| `GEMINI_API_KEY` | Yes | Google AI / Gemini API key (label router) |
| `ANTHROPIC_API_KEY` | Yes | Anthropic API key (summarizer) |
| `GMAIL_CLIENT_ID` | Yes | OAuth 2.0 Client ID from GCP |
| `GMAIL_CLIENT_SECRET` | Yes | OAuth 2.0 Client secret from GCP |
| `GMAIL_REFRESH_TOKEN` | Yes | Refresh token from OAuth flow (see step 4) |
| `GMAIL_USER_ID` | No | Defaults to `"me"` |
| `SUPABASE_URL` | Optional | For recording processed emails and ML model storage |
| `SUPABASE_SERVICE_ROLE_KEY` | Optional | Required if using Supabase |
| `POLL_BATCH_SIZE` | No | Max messages per poll (default 5) |

Also set `project` in `trigger.config.ts` to your Trigger.dev project ID.

### 4. Gmail OAuth (refresh token)

1. **GCP:** Create a project, enable Gmail API, configure OAuth consent screen, create OAuth 2.0 credentials (Web application) with redirect URI `http://127.0.0.1:9999/callback`. See **[docs/SETUP_GMAIL_OAUTH.md](docs/SETUP_GMAIL_OAUTH.md)** for full steps.
2. Run `pnpm run setup:gmail` and paste your Client ID and Client Secret.
3. Run `pnpm run get-refresh-token` — sign in with the Gmail account to label.
4. Copy the printed refresh token into `.env` as `GMAIL_REFRESH_TOKEN`.

### 5. Supabase (optional but recommended)

For recording processed emails and ML model storage:

1. Create a Supabase project
2. Run the SQL in `supabase/migrations/` in order (Supabase SQL editor)
3. Set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in `.env`

Without Supabase, the pipeline runs in cold start (no trained ML, no persistence).

### 6. Build and run

```bash
pnpm run build
pnpm run dev          # Start Trigger.dev dev server
```

Trigger **poll-and-label** from the Trigger.dev dashboard to start labeling.

### 7. Deploy

```bash
pnpm run deploy
```

Set the same environment variables in Trigger.dev dashboard (Project → Environment Variables).

## Tasks

| Task | Description |
|------|-------------|
| **poll-and-label** | Syncs processed emails, lists unlabeled messages, triggers label-one-message per ID |
| **label-one-message** | Fetch → parse → summarize → label → apply → record (per message) |
| **sync-labels-nightly** | Fetches current Gmail labels for today's emails; captures user corrections |
| **train-important-classifier** | Trains Important NN from user feedback |
| **train-label-router** | Trains label router head from mislabeled email corrections |

## Architecture

### Label scoring (two-part)

```
Email summary
     │
     ├── Gemini 2.5 Flash ──► Router weights (0-100 per label)
     │                                  │
     └── sentence-transformers ──► NN head weights (0-1 per label)
          (all-MiniLM-L6-v2)           │
                                        ▼
                          final_score[i] = router[i] × head[i]
                                        │
                                        ▼
                          label = argmax(final_scores)
                          if max < threshold → "Review"
```

### Nightly RL training loop

1. **During the day**: Emails are labeled; you interact (read, relabel, archive)
2. **Nightly sync**: Captures current Gmail state for all processed emails
3. **Training**: Rows where user changed labels → retrain NN heads
4. **Next day**: Updated models produce better predictions

## Project structure

```
├── config/              # Label taxonomy, routing thresholds, rules
├── prompts/             # LLM prompt templates (summarizer, label_router)
├── schemas/             # JSON schemas for config validation
├── src/
│   ├── config/          # Config loader, label format, embedded data
│   ├── db/              # Supabase client, recording, feedback queries
│   ├── email/           # Gmail message parsing (cheerio)
│   ├── gmail/           # Gmail API client (OAuth, labels, modify)
│   ├── ml/              # ML inference (important classifier, label router head)
│   ├── orchestration/   # LangGraph pipeline (summarize → label_router)
│   ├── providers/       # LLM providers (Anthropic, Gemini)
│   ├── trigger/         # Trigger.dev tasks (poll, label, sync, train)
│   └── types/           # TypeScript types
├── python/              # Python scripts for ML training/inference
├── scripts/             # Setup, validation, and testing scripts
├── supabase/migrations/ # Database schema
├── docs/                # Setup guides and design docs
├── SETUP_PROMPT.md      # AI agent setup form ← START HERE
└── AGENTS.md            # Context for AI coding agents
```

## Customization

### Emoji or plain labels — your choice

Labels can use **emojis** or be **plain text** — both work throughout the pipeline:

| Style | Example labels | CATEGORY_EMOJI value |
|-------|---------------|---------------------|
| With emojis | `💼-work-projects`, `💰-finance-bills` | `work: "💼"` |
| Without emojis | `work-projects`, `finance-bills` | `work: ""` |
| Mixed | Some with, some without | Per-category choice |

Set this in `src/config/labelFormat.ts` (`CATEGORY_EMOJI` map). The setup form in `SETUP_PROMPT.md` asks this as the first question and configures everything consistently.

### Private overrides

Run `pnpm run init:private` to create a `private/` directory (gitignored) with copies of `config/` and `prompts/`. Edit `private/config/*` and `private/prompts/*` — the loader prefers `private/` over repo defaults.

### Adding new labels

1. Add the category/subcategory to config files
2. Add a description in `src/orchestration/nodes.ts`
3. Update `src/config/labelFormat.ts` if adding a new category
4. Run `pnpm run build` to regenerate embedded data
5. The NN models will learn the new label automatically from your corrections

## Validation and testing

- **Config:** `pnpm run verify:config`
- **Local pipeline:** `pnpm run test:label` (dry run); `-- --apply` to apply labels
- **Unit tests:** `pnpm test`

## Cost and resilience

- **Scheduler**: small-1x machine (list + trigger only)
- **Per message**: small-2x machine via label-one-message
- **Retries**: Up to 3 attempts with backoff on transient errors
- **Batch size**: Set `POLL_BATCH_SIZE` (default 5) to control throughput

## License

MIT
