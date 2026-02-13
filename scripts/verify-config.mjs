#!/usr/bin/env node
/**
 * Validates JSON schemas and ensures categories/subcategories align.
 * Run after changing config (default or private overrides).
 */

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv from "ajv";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

function loadJson(path) {
  const raw = readFileSync(path, "utf-8");
  return JSON.parse(raw);
}

function resolveConfigPath(filename) {
  const privatePath = join(ROOT, "private", "config", filename);
  const defaultPath = join(ROOT, "config", filename);
  return existsSync(privatePath) ? privatePath : defaultPath;
}

const CONFIG_SCHEMAS = {
  "categories.json": "categories.json",
  "subcategories.json": "subcategories.json",
  "actions.json": "actions.json",
  "routing_thresholds.json": "routing_thresholds.json",
  "gmail_labels.json": "gmail_labels.json",
  "rules.json": "rules.json",
};

function main() {
  const schemasDir = join(ROOT, "schemas");
  if (!existsSync(schemasDir)) {
    console.error("Missing schemas/ directory.");
    process.exit(1);
  }

  const ajv = new Ajv({ strict: false });
  const validators = {};
  for (const [configFile, schemaFile] of Object.entries(CONFIG_SCHEMAS)) {
    const schemaPath = join(schemasDir, schemaFile);
    if (!existsSync(schemaPath)) {
      console.error(`Schema not found: ${schemaFile}`);
      process.exit(1);
    }
    const schema = loadJson(schemaPath);
    validators[configFile] = ajv.compile(schema);
  }

  let failed = false;
  const categoriesPath = resolveConfigPath("categories.json");
  const subcategoriesPath = resolveConfigPath("subcategories.json");

  const categories = loadJson(categoriesPath);
  const subcategories = loadJson(subcategoriesPath);

  if (!validators["categories.json"](categories)) {
    console.error("categories.json:", ajv.errorsText(validators["categories.json"].errors));
    failed = true;
  }
  if (!validators["subcategories.json"](subcategories)) {
    console.error("subcategories.json:", ajv.errorsText(validators["subcategories.json"].errors));
    failed = true;
  }

  const categorySet = new Set(categories);
  for (const cat of Object.keys(subcategories)) {
    if (!categorySet.has(cat)) {
      console.error(`subcategories.json references category "${cat}" not in categories.json`);
      failed = true;
    }
  }
  for (const cat of categories) {
    if (!Array.isArray(subcategories[cat])) {
      console.error(`categories.json has "${cat}" but subcategories.json has no array for it`);
      failed = true;
    }
  }

  for (const configFile of ["actions.json", "routing_thresholds.json", "gmail_labels.json", "rules.json"]) {
    const path = resolveConfigPath(configFile);
    const data = loadJson(path);
    if (!validators[configFile](data)) {
      console.error(`${configFile}:`, ajv.errorsText(validators[configFile].errors));
      failed = true;
    }
  }

  if (failed) {
    process.exit(1);
  }
  console.log("All config files valid; categories and subcategories aligned.");
}

main();
