export { getSupabase } from "./supabase.js";
export type { ProcessedEmailRow, PromptVersionRow } from "./supabase.js";
export {
  ensurePromptVersion,
  resolvePromptVersionIds,
  recordProcessedEmail,
} from "./record.js";
export type { RecordProcessedEmailParams } from "./record.js";
