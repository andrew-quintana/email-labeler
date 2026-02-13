import { getSupabase } from "./supabase.js";

/**
 * Build a reverse map from Gmail label ID to our known label name.
 * Uses leaf_rules.json to map labelIds (e.g. "Label_1") → label name (e.g. "💼-work-projects").
 */
export function buildGmailIdToLabelMap(
  leafRules: Array<{
    name: string;
    actions: Array<{ type: string; labelIds?: string[] }>;
  }>
): Map<string, string> {
  const map = new Map<string, string>();
  for (const rule of leafRules) {
    for (const action of rule.actions) {
      if (action.type === "addLabels" && action.labelIds) {
        for (const gmailId of action.labelIds) {
          map.set(gmailId, rule.name);
        }
      }
    }
  }
  return map;
}

/**
 * Resolve the user's effective label from label_ids_current.
 * If exactly one of our known labels is on the message, return it.
 * Otherwise return null (ambiguous or no known label).
 */
export function resolveUserLabel(
  labelIdsCurrent: string[],
  gmailIdToLabel: Map<string, string>
): string | null {
  const matchedLabels = new Set<string>();
  for (const gmailId of labelIdsCurrent) {
    const label = gmailIdToLabel.get(gmailId);
    if (label) matchedLabels.add(label);
  }
  if (matchedLabels.size === 1) {
    return [...matchedLabels][0];
  }
  return null; // ambiguous or no known label
}

export type LabelFeedbackRow = {
  message_id: string;
  body: string | null;
  summary: string | null;
  label_applied: string | null;
  label_ids_current: string[] | null;
};

/**
 * Get processed_emails rows that have label_ids_current set (synced).
 * These can be used to derive feedback for the label router.
 */
export async function getLabelFeedbackRows(): Promise<LabelFeedbackRow[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("processed_emails")
    .select("message_id, body, summary, label_applied, label_ids_current")
    .not("label_ids_current", "is", null);

  if (error) throw new Error(`Failed to get label feedback rows: ${error.message}`);

  return (data ?? []).map((row) => ({
    message_id: row.message_id,
    body: row.body ?? null,
    summary: row.summary ?? null,
    label_applied: row.label_applied ?? null,
    label_ids_current: row.label_ids_current ?? null,
  }));
}

export type TrainingFeedbackRow = {
  message_id: string;
  text: string;
  target_label: string;
};

/**
 * Build training dataset from synced rows:
 * For each row where we can resolve the user's effective label from label_ids_current,
 * produce a (text, target_label) pair. Includes mislabeled emails.
 */
export async function getTrainingDataForLabelRouter(
  gmailIdToLabel: Map<string, string>
): Promise<TrainingFeedbackRow[]> {
  const rows = await getLabelFeedbackRows();
  const result: TrainingFeedbackRow[] = [];

  for (const row of rows) {
    if (!row.label_ids_current || row.label_ids_current.length === 0) continue;
    const targetLabel = resolveUserLabel(row.label_ids_current, gmailIdToLabel);
    if (!targetLabel) continue;

    const text = (row.summary || row.body || "").slice(0, 10_000);
    if (!text) continue;

    result.push({
      message_id: row.message_id,
      text,
      target_label: targetLabel,
    });
  }

  return result;
}
