import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

let client: SupabaseClient | null = null;

/**
 * Supabase client for server/backend only. Uses the service role key so RLS
 * is bypassed and the app has full access. Do not use the anon key here.
 */
export function getSupabase(): SupabaseClient {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      "Missing Supabase env: set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (required for RLS tables)"
    );
  }
  if (!client) {
    client = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  }
  return client;
}

export type ProcessedEmailRow = {
  id: string;
  message_id: string;
  thread_id: string | null;
  body: string;
  label_ids: string[] | null;
  label_ids_current: string[] | null;
  labels_synced_at: string | null;
  snippet: string | null;
  summary: string | null;
  category: string | null;
  subcategory: string | null;
  label_applied: string | null;
  archive_applied: boolean;
  important: boolean | null;
  important_updated: boolean;
  summarizer_prompt_version_id: string | null;
  category_router_prompt_version_id: string | null;
  subcategory_router_prompt_version_id: string | null;
  importance_prompt_version_id: string | null;
  processed_at: string;
  created_at: string;
};

/**
 * Return a UTC date string in YYYY-MM-DD format.
 * @param offsetDays — number of days to add (default 0 = today, +1 = tomorrow)
 */
export function getUTCDateString(offsetDays = 0): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

export type PromptVersionRow = {
  id: string;
  name: string;
  version: string;
  content_hash: string;
  content: string | null;
  created_at: string;
};
