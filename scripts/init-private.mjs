#!/usr/bin/env node
/**
 * Copies config/ and prompts/ into private/ as a starting point for overrides.
 * Run after forking the repo to create your private override tree.
 */

import { cpSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const PRIVATE_README = `# Private overrides

This folder is \`gitignored\`. Use it to override default config and prompts without changing core code.

## Structure

- \`config/\` – same filenames as repo \`config/\`: \`labels.json\`, \`leaf_rules.json\`, \`archive_labels.json\`, \`routing_thresholds.json\`, \`gmail_labels.json\`, \`rules.json\`, etc.
- \`prompts/\` – same filenames as repo \`prompts/\`: \`summarizer.md\`, \`label_router.md\` (and legacy \`category_router.md\`, \`subcategory_router.md\` if present)

## Usage

1. Loader reads \`./private/*\` first; if a file is missing here, the repo default is used.
2. Edit \`private/config/labels.json\`, \`private/config/archive_labels.json\`, \`private/config/routing_thresholds.json\`, and \`private/prompts/label_router.md\` to match your taxonomy and prompts.
3. Edit \`private/config/rules.json\` and \`private/config/leaf_rules.json\` to define when to apply labels and archive.
4. Run \`pnpm run verify:config\` after changes. Never commit \`private/\` to a public repo. Keep secrets in Trigger.dev env vars.
`;

function main() {
  const privateDir = join(ROOT, "private");
  const privateConfig = join(privateDir, "config");
  const privatePrompts = join(privateDir, "prompts");
  const configSrc = join(ROOT, "config");
  const promptsSrc = join(ROOT, "prompts");

  if (!existsSync(configSrc)) {
    console.error("Missing config/ directory in repo root.");
    process.exit(1);
  }
  if (!existsSync(promptsSrc)) {
    console.error("Missing prompts/ directory in repo root.");
    process.exit(1);
  }

  mkdirSync(privateConfig, { recursive: true });
  mkdirSync(privatePrompts, { recursive: true });

  cpSync(configSrc, privateConfig, { recursive: true });
  cpSync(promptsSrc, privatePrompts, { recursive: true });
  writeFileSync(join(privateDir, "README.md"), PRIVATE_README, "utf-8");

  console.log("Created private/ with copies of config/ and prompts/.");
  console.log("Edit private/config/* and private/prompts/* to customize; run pnpm verify:config to validate.");
}

main();
