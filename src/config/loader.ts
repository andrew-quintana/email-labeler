import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import AjvModule from "ajv";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_FROM_DIRNAME = join(__dirname, "..", "..");
const require = createRequire(import.meta.url);

/** Embedded config/prompts/schemas (from scripts/embed-config.mjs) for when filesystem doesn't have them (e.g. Trigger.dev). */
function getEmbedded(): {
  config: Record<string, unknown>;
  prompts: Record<string, string>;
  schemas: Record<string, object>;
} | null {
  try {
    const emb = require("./embeddedData.js");
    return {
      config: emb.embeddedConfigFiles ?? {},
      prompts: emb.embeddedPromptFiles ?? {},
      schemas: emb.embeddedSchemaFiles ?? {},
    };
  } catch {
    return null;
  }
}
const embedded = getEmbedded();

/** Project root: from dist/config (local) or process.cwd() when deploy has config/ at cwd (Trigger.dev). */
function getRoot(): string {
  const fromDir = ROOT_FROM_DIRNAME;
  if (existsSync(join(fromDir, "config", "categories.json"))) return fromDir;
  const cwd = process.cwd();
  if (existsSync(join(cwd, "config", "categories.json"))) return cwd;
  return fromDir;
}
const ROOT = getRoot();

const CONFIG_FILES = [
  "categories.json",
  "subcategories.json",
  "actions.json",
  "routing_thresholds.json",
  "gmail_labels.json",
  "rules.json",
  "archive_labels.json",
  "labels.json",
  "leaf_rules.json",
] as const;

const PROMPT_FILES = [
  "summarizer.md",
  "category_router.md",
  "subcategory_router.md",
  "label_router.md",
] as const;

export type ConfigName = (typeof CONFIG_FILES)[number];
export type PromptName = (typeof PROMPT_FILES)[number];

const configDir = (usePrivate: boolean) =>
  usePrivate ? join(ROOT, "private", "config") : join(ROOT, "config");
const promptDir = (usePrivate: boolean) =>
  usePrivate ? join(ROOT, "private", "prompts") : join(ROOT, "prompts");

function loadJson<T>(path: string): T {
  const raw = readFileSync(path, "utf-8");
  try {
    return JSON.parse(raw) as T;
  } catch (e: unknown) {
    throw new Error(`Invalid JSON at ${path}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

function loadText(path: string): string {
  return readFileSync(path, "utf-8");
}

/** Resolve path: private first, then default config/prompts. */
function resolvePath(
  kind: "config" | "prompts",
  filename: string,
  usePrivate: boolean
): string {
  const dir = kind === "config" ? configDir(usePrivate) : promptDir(usePrivate);
  return join(dir, filename);
}

/** Load a config file with precedence: private/ > config/ > embedded. */
export function loadConfig<T = unknown>(name: ConfigName): T {
  const privatePath = resolvePath("config", name, true);
  const defaultPath = resolvePath("config", name, false);
  const path = existsSync(privatePath) ? privatePath : defaultPath;
  if (existsSync(path)) return loadJson<T>(path);
  if (embedded?.config && name in embedded.config) {
    return embedded.config[name] as T;
  }
  throw new Error(
    `Config file not found: ${name} (checked private/config, config/, and embedded)`
  );
}

/** Load a prompt file with precedence: private/prompts > prompts/ > embedded. */
export function loadPrompt(name: PromptName): string {
  const privatePath = resolvePath("prompts", name, true);
  const defaultPath = resolvePath("prompts", name, false);
  const path = existsSync(privatePath) ? privatePath : defaultPath;
  if (existsSync(path)) return loadText(path);
  if (embedded?.prompts && name in embedded.prompts) {
    return embedded.prompts[name] as string;
  }
  throw new Error(
    `Prompt file not found: ${name} (checked private/prompts, prompts/, and embedded)`
  );
}

// ESM default export can be module namespace; Ajv class may be at .default
const ajv = new (((AjvModule as unknown) as { default?: new (opts?: object) => unknown }).default ?? (AjvModule as unknown) as new (opts?: object) => unknown)({ strict: false }) as import("ajv").default;

function loadSchema(schemaName: string): object {
  const path = join(ROOT, "schemas", schemaName);
  if (existsSync(path)) return loadJson<object>(path);
  if (embedded?.schemas && schemaName in embedded.schemas) {
    return embedded.schemas[schemaName];
  }
  throw new Error(`Schema not found: ${schemaName}`);
}

const schemaCache = new Map<string, ReturnType<typeof ajv.compile>>();

function getValidator(schemaName: string) {
  if (!schemaCache.has(schemaName)) {
    const schema = loadSchema(schemaName);
    schemaCache.set(schemaName, ajv.compile(schema));
  }
  return schemaCache.get(schemaName)!;
}

const CONFIG_SCHEMAS: Partial<Record<ConfigName, string>> = {
  "categories.json": "categories.json",
  "subcategories.json": "subcategories.json",
  "actions.json": "actions.json",
  "routing_thresholds.json": "routing_thresholds.json",
  "gmail_labels.json": "gmail_labels.json",
  "rules.json": "rules.json",
  "archive_labels.json": "archive_labels.json",
};

/** Validate a config object against its JSON schema. Throws with actionable message if invalid. */
export function validateConfig(name: ConfigName, data: unknown): void {
  const schemaName = CONFIG_SCHEMAS[name];
  if (!schemaName) return; // no schema for this config (e.g. labels.json)
  const validate = getValidator(schemaName);
  const valid = validate(data);
  if (!valid) {
    const errList = (validate as { errors?: Array<{ instancePath?: string; message?: string }> }).errors;
    const errors = errList?.map((err: { instancePath?: string; message?: string }) => `${err.instancePath || "/"} ${err.message}`).join("; ");
    throw new Error(
      `Config validation failed for ${name}: ${errors ?? "unknown error"}`
    );
  }
}

/** Load and validate all configs; ensure categories and subcategories align. */
export function loadAndValidateAll(): {
  categories: string[];
  subcategories: Record<string, string[]>;
  actions: Array<{ type: string; labelName?: string; description: string }>;
  routing_thresholds: {
    minCategoryConfidence: number;
    minSubcategoryConfidence: number;
    fallbackLabel: string;
    archiveRequiresConfidenceAbove: number;
    defaultArchive?: boolean;
    /** Include extra labels when score >= this ratio of max (0 = single label only). Default 0.6. */
    multiLabelRatioOfMax?: number;
    /** Include extra labels only when final score >= this (0-100). Default 25. */
    multiLabelMinScore?: number;
  };
  gmail_labels: {
    labelPrefix: string;
    /** @deprecated No longer used; we only add the resolved label and skip messages that already have any user label. */
    processedLabel?: string;
    needsReviewLabel: string;
    labelNaming?: string;
  };
  rules: {
    rules: Array<{
      id: string;
      match: Record<string, string>;
      actions: string[];
      archive?: boolean;
      labelOverride?: string;
    }>;
  };
  archive_labels: string[];
  /** Labels that must not be archived (overrides archive_labels). From archive_labels.json _non_archiving_labels. */
  non_archiving_labels: string[];
  /** Flat label list for label router (single source of truth). */
  labels: string[];
  /** Leaf rules from n8n (label name → Gmail label IDs, archive). */
  leaf_rules: Array<{
    id: string;
    name: string;
    match: Record<string, string>;
    actions: Array<{ type: string; labelIds?: string[] }>;
    labels: string[];
    archive: boolean;
  }>;
} {
  const categories = loadConfig<string[]>("categories.json");
  const subcategories = loadConfig<Record<string, string[]>>(
    "subcategories.json"
  );
  const actions = loadConfig<Array<{ type: string; labelName?: string; description: string }>>(
    "actions.json"
  );
  const routing_thresholds = loadConfig<{
    minCategoryConfidence: number;
    minSubcategoryConfidence: number;
    fallbackLabel: string;
    archiveRequiresConfidenceAbove: number;
    defaultArchive?: boolean;
    multiLabelRatioOfMax?: number;
    multiLabelMinScore?: number;
  }>("routing_thresholds.json");
  const gmail_labels = loadConfig<{
    labelPrefix: string;
    processedLabel?: string;
    needsReviewLabel: string;
    labelNaming?: string;
  }>("gmail_labels.json");
  const rules = loadConfig<{
    rules: Array<{
      id: string;
      match: Record<string, string>;
      actions: string[];
      archive?: boolean;
      labelOverride?: string;
    }>;
  }>("rules.json");
  const archiveLabelsConfig = loadConfig<{
    labels: string[];
    _non_archiving_labels?: string[];
    _comment?: string;
  }>("archive_labels.json");
  const archive_labels = Array.isArray(archiveLabelsConfig.labels) ? archiveLabelsConfig.labels : [];
  const non_archiving_labels = Array.isArray(archiveLabelsConfig._non_archiving_labels)
    ? archiveLabelsConfig._non_archiving_labels
    : [];
  const labelsConfig = loadConfig<{ labels: string[]; _comment?: string }>("labels.json");
  const labels = Array.isArray(labelsConfig.labels) ? labelsConfig.labels : [];
  const leafRulesConfig = loadConfig<{
    leaf_rules: Array<{
      id: string;
      name: string;
      match: Record<string, string>;
      actions: Array<{ type: string; labelIds?: string[] }>;
      labels: string[];
      archive: boolean;
    }>;
  }>("leaf_rules.json");
  const leaf_rules = leafRulesConfig.leaf_rules ?? [];

  const configData: Record<string, unknown> = {
    "categories.json": categories,
    "subcategories.json": subcategories,
    "actions.json": actions,
    "routing_thresholds.json": routing_thresholds,
    "gmail_labels.json": gmail_labels,
    "rules.json": rules,
    "archive_labels.json": archiveLabelsConfig,
    "labels.json": labelsConfig,
    "leaf_rules.json": leafRulesConfig,
  };
  for (const name of CONFIG_FILES) {
    validateConfig(name, configData[name]);
  }

  const categorySet = new Set(categories);
  for (const cat of Object.keys(subcategories)) {
    if (!categorySet.has(cat)) {
      throw new Error(
        `subcategories.json references category "${cat}" which is not in categories.json`
      );
    }
  }
  for (const cat of categories) {
    if (!subcategories[cat] || !Array.isArray(subcategories[cat])) {
      throw new Error(
        `categories.json has "${cat}" but subcategories.json has no array for it`
      );
    }
  }

  return {
    categories,
    subcategories,
    actions,
    routing_thresholds,
    gmail_labels,
    rules,
    archive_labels,
    non_archiving_labels,
    labels,
    leaf_rules,
  };
}
