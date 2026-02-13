import { getSupabase } from "./supabase.js";

export type ProcessedEmailForUpdate = {
  message_id: string;
  important: boolean | null;
};

export type ProcessedEmailNullSynced = {
  message_id: string;
  label_ids: string[] | null;
  archive_applied: boolean;
  important: boolean | null;
};

const IMPORTANT_LABEL_ID = "IMPORTANT";

/**
 * Get processed_emails rows where labels_synced_at is null (not yet synced).
 * Used by poll-and-label to check user interaction before updating sync.
 */
export async function getProcessedEmailsWithNullLabelsSynced(
  limit: number
): Promise<ProcessedEmailNullSynced[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("processed_emails")
    .select("message_id, label_ids, archive_applied, important")
    .is("labels_synced_at", null)
    .limit(limit);

  if (error) throw new Error(`Failed to get processed_emails (null synced): ${error.message}`);
  return (data ?? []).map((row) => ({
    message_id: row.message_id,
    label_ids: (row.label_ids ?? []) as string[],
    archive_applied: Boolean(row.archive_applied),
    important: row.important as boolean | null,
  }));
}

/**
 * Get processed_emails rows from the given day (by processed_at in UTC).
 * Returns message_id and current important for comparison.
 */
export async function getProcessedEmailsForDay(
  startOfDayISO: string,
  endOfDayISO: string
): Promise<ProcessedEmailForUpdate[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("processed_emails")
    .select("message_id, important")
    .gte("processed_at", startOfDayISO)
    .lte("processed_at", endOfDayISO);

  if (error) throw new Error(`Failed to get processed_emails: ${error.message}`);
  return (data ?? []).map((row) => ({
    message_id: row.message_id,
    important: row.important as boolean | null,
  }));
}

/**
 * Update important, important_updated, and current label set for a message.
 * important_updated = true when the new important value differs from the previous stored value.
 * label_ids_current = all Gmail label IDs at sync time (for label-router and important feedback).
 */
export async function updateLabelsForMessage(
  messageId: string,
  currentImportant: boolean,
  previousImportant: boolean | null,
  labelIdsCurrent: string[]
): Promise<void> {
  const important_updated = previousImportant !== currentImportant;
  const supabase = getSupabase();
  const { error } = await supabase
    .from("processed_emails")
    .update({
      important: currentImportant,
      important_updated,
      label_ids_current: labelIdsCurrent,
      labels_synced_at: new Date().toISOString(),
    })
    .eq("message_id", messageId);

  if (error)
    throw new Error(`Failed to update labels for ${messageId}: ${error.message}`);
}


export { IMPORTANT_LABEL_ID };

export type FeedbackRow = {
  message_id: string;
  body: string | null;
  summary: string | null;
  important: boolean;
};

/**
 * Load processed_emails rows where important_updated = true (for RL training).
 */
export async function getFeedbackRowsForTraining(): Promise<FeedbackRow[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("processed_emails")
    .select("message_id, body, summary, important")
    .eq("important_updated", true);

  if (error) throw new Error(`Failed to get feedback rows: ${error.message}`);

  return (data ?? [])
    .filter((row): row is typeof row & { important: boolean } => row.important !== null)
    .map((row) => ({
      message_id: row.message_id,
      body: row.body ?? null,
      summary: row.summary ?? null,
      important: row.important as boolean,
    }));
}
