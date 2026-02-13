# AGENTS.md

Context and instructions for AI coding agents working on this repo.

## What this project is

**email-labeler** — Gmail labeling worker on **Trigger.dev**. No GCP push (Pub/Sub/Cloud Functions); Gmail OAuth and LLM keys run inside Trigger.dev.

- **poll-and-label** (task): Two duties per run. (1) **Sync check**: loads processed emails with `labels_synced_at = null`, fetches current Gmail state, and updates (`label_ids_current`, `labels_synced_at`, `important`, `important_updated`) only when the user actually interacted (read the email, changed labels, or changed archive status); unmodified emails are skipped so the next run reconsiders them. (2) **Label new mail**: lists message IDs in all mail (excluding spam, trash, and sent) that have **only system labels** (no user-applied label), then triggers **label-one-message** per ID. Run or schedule from the Trigger.dev dashboard.
- **label-one-message** (task): fetches message → runs pipeline (summarize → **label_router**) → resolves label + archive from config → applies the **resolved label** + **IMPORTANT** (from NN model) → records to Supabase.
- **Review**: used when label confidence is below threshold (see `src/orchestration/apply.ts`).

### Pipeline architecture

- **Graph**: `summarize → label_router → END` (single label router replaces two-stage category → subcategory).
- **Label router**: Two-part scoring per label:
  - **Router weights (0–100)**: from Gemini (content-based, `prompts/label_router.md`).
  - **NN head weights (0–1)**: from trained artifact (`models/label-router/latest.pkl`). Cold start: all 1.0.
  - **Final score** = router_weight × nn_head_weight; apply label = argmax.
- **Important classifier**: Binary NN (embedding + logistic regression). Artifact at `models/important-classifier/latest.pkl`. Applied in `label-one-message` after label routing.

### Nightly tasks

- **sync-labels-nightly**: Fetches current Gmail labels for today's processed emails; updates `important`, `important_updated`, `label_ids_current`, `labels_synced_at`.
- **train-important-classifier**: Trains binary classifier from rows where `important_updated = true`.
- **train-label-router**: Trains multi-class classifier from feedback (mislabeled emails where `label_applied != user's effective label from label_ids_current`).

Key paths: `src/trigger/`, `src/orchestration/` (graph, nodes, apply, state), `src/ml/` (important-inference, label-router-inference), `src/db/` (record, label-feedback, important-update), `src/gmail/client.ts`, `src/config/loader.ts`, `config/` (labels, leaf_rules, archive_labels, routing_thresholds, gmail_labels), `prompts/`, `python/`.

## Customization

- **Label taxonomy**: Edit `config/categories.json`, `config/subcategories.json`, `config/labels.json`, `config/leaf_rules.json`, `config/archive_labels.json`. Update `src/config/labelFormat.ts` (CATEGORY_EMOJI) and `src/orchestration/nodes.ts` (LABEL_DESCRIPTIONS).
- **Setup form**: Use `SETUP_PROMPT.md` as a prompt for AI agents to configure the entire taxonomy from user input.
- **Private overrides**: `pnpm run init:private` creates `private/` (gitignored) for per-user config/prompts.

## Commit messages (hyper-concise)

Use short, scannable prefixes and minimal body. One logical change per commit.

- `feat: <what>` — new feature or capability
- `fix: <what>` — bug or incorrect behavior
- `docs: <what>` — README, AGENTS.md, docs/*, comments
- `config: <what>` — config/*, prompts/*, schemas/*
- `chore: <what>` — deps, tooling, .gitignore, scripts
- `refactor: <what>` — structure/rename, no behavior change
- `test: <what>` — tests or fixtures

No period at end of subject. Optional body on next line for detail; keep subject < 72 chars.

## Dependencies (why node_modules has SDKs + LangGraph)

- **LangGraph** is used only for **orchestration** (state graph, nodes, edges). It does not call LLMs.
- **LLM calls** use the **official SDKs** directly: `@anthropic-ai/sdk` (summarize), `@google/generative-ai` (label router).
- **ML inference**: `@trigger.dev/python` calls Python scripts for embedding + classifier (sentence-transformers, sklearn). Artifacts in Supabase Storage bucket `models`.
- We do **not** use `@langchain/anthropic` or `@langchain/google`; no duplicate chat-model stacks.

## Dev environment

- **Node:** `>=18`. Package manager: **pnpm**.
- **Scripts:** `pnpm dev` (Trigger.dev), `pnpm test`, `pnpm lint`, `pnpm init:private`, `pnpm verify:config`, `pnpm run build`. **Deploy:** `pnpm run deploy`.
- **Config/prompts:** Loader prefers `private/*` over `config/` and `prompts/`. Validate with `pnpm verify:config` after edits.
- **Secrets:** `.env` / `.env.local` are gitignored. Use Trigger.dev env vars for deploy; never commit `private/`.

## Testing and lint

- Run `pnpm test` before committing. Run `pnpm lint` for type and style checks.
- After changing config or prompts, run `pnpm verify:config`.
- For labeling: `pnpm run test:label` (optionally `-- --apply`, `-- --count N`).

## PR / push checklist

- Commits: hyper-concise prefix + short subject.
- No personal categories, label names, or email addresses in the **public** repo; keep those in `private/`.
- Before pushing: tests and lint pass; `private/` remains untracked.
