import { createHash } from "node:crypto";
import { getSupabase } from "./supabase.js";
import type { PromptName } from "../config/loader.js";
import { loadPrompt } from "../config/loader.js";

const PROMPT_NAMES: PromptName[] = [
  "summarizer.md",
  "category_router.md",
  "subcategory_router.md",
  "label_router.md",
];

function contentHash(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

/**
 * Ensure a prompt version row exists; return its id.
 * Uses name + content_hash as unique key.
 */
export async function ensurePromptVersion(
  name: string,
  content: string
): Promise<string> {
  const hash = contentHash(content);
  const version = hash.slice(0, 16);
  const supabase = getSupabase();

  const { data: existing } = await supabase
    .from("prompt_versions")
    .select("id")
    .eq("name", name)
    .eq("content_hash", hash)
    .limit(1)
    .maybeSingle();

  if (existing?.id) return existing.id;

  const { data: inserted, error } = await supabase
    .from("prompt_versions")
    .insert({
      name,
      version,
      content_hash: hash,
      content,
    })
    .select("id")
    .single();

  if (error) throw new Error(`Failed to insert prompt_version: ${error.message}`);
  if (!inserted?.id) throw new Error("No id returned from prompt_versions insert");
  return inserted.id;
}

/**
 * Resolve prompt version ids for the three pipeline nodes (using current loaded prompt content).
 */
export async function resolvePromptVersionIds(): Promise<{
  summarizer: string;
  category_router: string;
  subcategory_router: string;
  label_router: string;
}> {
  const contents = PROMPT_NAMES.map((name) => ({
    name,
    content: loadPrompt(name),
  }));
  const ids = await Promise.all(
    contents.map(({ name, content }) => ensurePromptVersion(name, content))
  );
  return {
    summarizer: ids[0]!,
    category_router: ids[1]!,
    subcategory_router: ids[2]!,
    label_router: ids[3]!,
  };
}

export type RecordProcessedEmailParams = {
  messageId: string;
  threadId: string;
  /** Post-cheerio-parsed body (plain text used for LLM). */
  body: string;
  /** All Gmail label IDs on the message at processing time (after our apply). */
  labelIds: string[];
  snippet: string | null;
  summary: string | null;
  category: string | null;
  subcategory: string | null;
  labelApplied: string;
  archiveApplied: boolean;
  /** Current Important label state (from model or Gmail); null if unknown. */
  important: boolean | null;
  summarizerPromptVersionId: string;
  categoryRouterPromptVersionId: string;
  subcategoryRouterPromptVersionId: string;
  importancePromptVersionId: string | null;
};

/**
 * Insert a processed_emails row with body and prompt versioning.
 * Sets important_updated = false (nightly job updates important + important_updated by querying that day's emails).
 * Idempotent: on conflict (message_id) we update the row.
 */
export async function recordProcessedEmail(
  params: RecordProcessedEmailParams
): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase.from("processed_emails").upsert(
    {
      message_id: params.messageId,
      thread_id: params.threadId,
      body: params.body,
      label_ids: params.labelIds,
      snippet: params.snippet ?? null,
      summary: params.summary ?? null,
      category: params.category ?? null,
      subcategory: params.subcategory ?? null,
      label_applied: params.labelApplied,
      archive_applied: params.archiveApplied,
      important: params.important,
      important_updated: false,
      summarizer_prompt_version_id: params.summarizerPromptVersionId,
      category_router_prompt_version_id: params.categoryRouterPromptVersionId,
      subcategory_router_prompt_version_id:
        params.subcategoryRouterPromptVersionId,
      importance_prompt_version_id: params.importancePromptVersionId,
    },
    { onConflict: "message_id" }
  );
  if (error) throw new Error(`Failed to record processed_email: ${error.message}`);
}
