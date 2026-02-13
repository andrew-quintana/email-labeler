# Email Labeler Setup Prompt

Use this prompt with a coding agent (Cursor, Copilot, Codex, etc.) after cloning the repo.
Copy the entire block below, fill in the form fields, and paste it into your AI coding agent.
The agent will update all config files, prompts, label descriptions, and NN model settings
to match your personal email taxonomy.

---

## Instructions for the coding agent

You are setting up an email labeling pipeline for the user. Based on the form data below,
update ALL of the following files to match the user's label taxonomy:

### Files to update:

1. **`config/categories.json`** — Replace with the user's category list (plain names, no emojis)
2. **`config/subcategories.json`** — Replace with the user's subcategories per category
3. **`config/labels.json`** — Generate the flat label list (see label format rules below)
4. **`config/leaf_rules.json`** — Generate leaf rules for each label (use `"REPLACE_WITH_GMAIL_LABEL_ID"` for labelIds unless the user provides Gmail IDs)
5. **`config/archive_labels.json`** — Set which labels trigger archiving based on user's preferences
6. **`config/rules.json`** — Generate rules for which labels should be archived
7. **`src/config/labelFormat.ts`** — Update the `CATEGORY_EMOJI` map. If the user chose emojis, set each category's emoji; if not, set all values to `""` (empty string)
8. **`src/orchestration/nodes.ts`** — Update the `LABEL_DESCRIPTIONS` map with descriptions for each label. Keys must exactly match labels.json
9. **`trigger.config.ts`** — Replace `proj_YOUR_PROJECT_ID` with the user's Trigger.dev project ID (if provided)
10. **`src/config/embeddedData.ts`** — Regenerate by running `node scripts/embed-config.mjs` (or tell the user to run `pnpm run build`)

### Label format rules:

The label format depends on whether the user chooses to use emojis:

- **With emojis**: `"emoji-category-subcategory"` → e.g. `"💼-work-projects"`, `"💰-finance-bills"`
- **Without emojis**: `"category-subcategory"` → e.g. `"work-projects"`, `"finance-bills"`

The special labels `"Review"` and `"other"` always stay the same regardless of emoji choice.

When generating labels.json, leaf_rules.json, archive_labels.json, and LABEL_DESCRIPTIONS,
use whichever format the user selected. All files must be consistent — don't mix formats.

### Validation:
After updating, run `pnpm run verify:config` to validate all config files align.

---

## Setup Form (fill this out before pasting to your agent)

```
=== EMAIL LABELER CONFIGURATION FORM ===

1. USE EMOJIS IN LABELS?
   Emojis make labels visually distinct in Gmail.
   Choose YES or NO. If YES, provide an emoji for each category in section 2.

   USE EMOJIS: YES / NO


2. CATEGORIES AND SUBCATEGORIES
   List your email categories and their subcategories.
   If you chose YES for emojis, include an emoji before each category name.
   If you chose NO, just list the category names.

   With emojis:
     💼 work: projects, meetings, deadlines, collaboration
     👤 personal: family, friends, events, travel, health
     💰 finance: banking, bills, income, subscriptions

   Without emojis:
     work: projects, meetings, deadlines, collaboration
     personal: family, friends, events, travel, health
     finance: banking, bills, income, subscriptions

   YOUR CATEGORIES:
   _____
   _____
   _____
   _____
   _____
   _____
   _____
   (add more lines as needed)


3. LABEL DESCRIPTIONS
   For each subcategory, provide a one-line description of what emails belong there.
   This helps the LLM classify accurately. Leave blank for auto-generated descriptions.

   Example:
   work/projects: "Emails about work projects, tasks, deliverables, or status updates."
   work/meetings: "Meeting invitations, calendar updates, or meeting notes."

   YOUR DESCRIPTIONS (optional — agent will generate defaults if blank):
   _____/_____: "_____"
   _____/_____: "_____"
   _____/_____: "_____"
   (add more lines as needed)


4. ARCHIVE BEHAVIOR
   Which labels should automatically archive (remove from Inbox)?
   List the full label names. Typically: newsletters, low-priority notifications,
   shipping updates, promotions, etc.

   With emojis example: 📰-newsletters-tech, 🔔-notifications-social-media
   Without emojis example: newsletters-tech, notifications-social-media

   ARCHIVE THESE LABELS:
   _____
   _____
   _____
   (add more lines as needed)


5. TRIGGER.DEV PROJECT ID
   From your Trigger.dev dashboard (cloud.trigger.dev → your project → Settings).

   PROJECT ID: proj_____________________


6. GMAIL LABEL IDS (optional — can be set up later)
   If you already have Gmail labels created, list the mapping.
   Run `pnpm run test:label -- --list-labels` after setup to see your Gmail label IDs.
   Format: label-name = Label_ID

   YOUR MAPPINGS (leave blank to use auto-create):
   _____ = _____
   _____ = _____
   (add more lines as needed)


7. CONFIDENCE THRESHOLDS (optional — defaults are fine for most users)
   - Minimum confidence to apply a label (default: 0.6): _____
   - Fallback label name when confidence is low (default: "Review"): _____
   - Multi-label: include extra labels when score >= ratio of max (default: 0.6): _____


8. POLLING SETTINGS (optional)
   - Max messages per poll cycle (default: 5): _____
   - Gmail query scope (default: "-in:spam -in:trash -in:sent"): _____


=== END OF FORM ===
```

---

## Example A: Filled-out form WITH emojis

```
=== EMAIL LABELER CONFIGURATION FORM ===

1. USE EMOJIS: YES

2. CATEGORIES AND SUBCATEGORIES
   💼 work: projects, meetings, deadlines, collaboration, reports
   👤 personal: family, friends, events, travel, health, hobbies
   💰 finance: banking, bills, income, subscriptions, investments, taxes
   🛒 shopping: orders, shipping, deals, returns
   🔔 notifications: account-alerts, social-media, app-updates
   📰 newsletters: tech, news, industry, digest

3. LABEL DESCRIPTIONS
   work/projects: "Work project updates, task assignments, and deliverable tracking."
   work/meetings: "Meeting invitations, calendar events, agenda items, and meeting notes."
   work/reports: "Status reports, analytics summaries, and periodic reviews."
   finance/taxes: "Tax documents, filing reminders, and tax-related correspondence."
   personal/hobbies: "Hobby-related emails, classes, workshops, or group activities."
   shopping/deals: "Sales, promotions, coupon codes, and discount announcements."
   newsletters/digest: "Weekly or daily digest emails summarizing multiple topics."

4. ARCHIVE THESE LABELS:
   🛒-shopping-deals
   🛒-shopping-shipping
   🔔-notifications-social-media
   🔔-notifications-app-updates
   📰-newsletters-tech
   📰-newsletters-news
   📰-newsletters-industry
   📰-newsletters-digest

5. PROJECT ID: proj_abc123def456

6. GMAIL LABEL IDS: (leave blank — will auto-create)

7. CONFIDENCE THRESHOLDS: (use defaults)

8. POLLING SETTINGS: Max messages per poll: 10

=== END OF FORM ===
```

## Example B: Filled-out form WITHOUT emojis

```
=== EMAIL LABELER CONFIGURATION FORM ===

1. USE EMOJIS: NO

2. CATEGORIES AND SUBCATEGORIES
   work: projects, meetings, deadlines, reports
   personal: family, friends, events, travel
   finance: banking, bills, subscriptions
   shopping: orders, shipping, returns
   notifications: security, social-media
   newsletters: tech, news

3. LABEL DESCRIPTIONS
   work/projects: "Work project updates, task assignments, and deliverable tracking."
   work/meetings: "Meeting invitations, calendar events, and meeting notes."
   (leave rest blank for auto-generated defaults)

4. ARCHIVE THESE LABELS:
   shopping-shipping
   notifications-social-media
   newsletters-tech
   newsletters-news

5. PROJECT ID: proj_xyz789

6. GMAIL LABEL IDS: (leave blank — will auto-create)

7. CONFIDENCE THRESHOLDS: (use defaults)

8. POLLING SETTINGS: (use defaults)

=== END OF FORM ===
```

---

## What the agent should do after receiving the filled form

1. Check section 1 — determine if emojis are being used (YES/NO)
2. Parse all categories, subcategories, and emojis (if any) from section 2
3. Generate the flat label list using the correct format:
   - Emojis: `["Review", "other", "💼-work-projects", ...]`
   - No emojis: `["Review", "other", "work-projects", ...]`
4. Update `config/categories.json` with the category names (always plain, no emojis)
5. Update `config/subcategories.json` with the subcategory arrays per category
6. Update `config/labels.json` with the flat label list
7. Update `config/leaf_rules.json` with one rule per label (placeholder Gmail IDs)
8. Update `config/archive_labels.json` with the user's archive preferences
9. Update `config/rules.json` with archive rules for archived labels
10. Update `src/config/labelFormat.ts` `CATEGORY_EMOJI` map:
    - If emojis: set each category to its emoji (e.g. `work: "💼"`)
    - If no emojis: set all to empty string (e.g. `work: ""`)
11. Update `src/orchestration/nodes.ts` `LABEL_DESCRIPTIONS` — use user-provided descriptions or generate clear defaults. Keys must match labels.json exactly
12. Update `trigger.config.ts` project ID if provided
13. Run `node scripts/embed-config.mjs` to regenerate `src/config/embeddedData.ts`
14. Run `pnpm run verify:config` to validate
15. Print a summary of changes and next steps (Gmail OAuth, Supabase, deploy)

### NN Model Notes

The NN models (important classifier and label router head) are trained from user
feedback and do NOT need manual configuration. They automatically:
- Start in "cold start" mode (all weights = 1.0, so only LLM scores matter)
- Learn from your corrections over time (nightly training jobs)
- The label list in `config/labels.json` defines the output dimensions

The user only needs to:
1. Set up their label taxonomy (this form)
2. Deploy and start labeling
3. The models will improve automatically as they correct mislabeled emails
