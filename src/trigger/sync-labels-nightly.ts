import { schedules, logger } from "@trigger.dev/sdk/v3";
import { getGmailClient, getMessageLabelIds } from "../gmail/client.js";
import {
  getProcessedEmailsForDay,
  updateLabelsForMessage,
  IMPORTANT_LABEL_ID,
} from "../db/important-update.js";

const GMAIL_USER = process.env.GMAIL_USER_ID ?? "me";

function getGmailOptions() {
  const clientId = process.env.GMAIL_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET;
  const refreshToken = process.env.GMAIL_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(
      "Missing Gmail OAuth env: GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN"
    );
  }
  return { clientId, clientSecret, refreshToken, userEmail: undefined };
}

/**
 * Nightly task: query all processed_emails from that day, fetch current Gmail labels
 * for each message, and update important, important_updated, label_ids_current, labels_synced_at.
 * Captures all labels so both the important classifier and the (future) label router
 * can learn from user corrections (e.g. mislabeled emails). Run once per day before training.
 */
export const syncLabelsNightlyTask = schedules.task({
  id: "sync-labels-nightly",
  machine: "small-1x",
  run: async (_payload: Record<string, unknown>) => {
    if (!process.env.SUPABASE_URL) {
      logger.info("SUPABASE_URL not set; skipping sync-labels-nightly");
      return { updated: 0, skipped: true, reason: "no_supabase" };
    }

    const now = new Date();
    const startOfDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
    const endOfDay = new Date(startOfDay);
    endOfDay.setUTCDate(endOfDay.getUTCDate() + 1);

    const startOfDayISO = startOfDay.toISOString();
    const endOfDayISO = endOfDay.toISOString();

    const rows = await getProcessedEmailsForDay(startOfDayISO, endOfDayISO);
    if (rows.length === 0) {
      return { updated: 0, processedToday: 0 };
    }

    const options = getGmailOptions();
    const gmail = getGmailClient(options);

    let updated = 0;
    let errors = 0;

    for (const row of rows) {
      try {
        const labelIdsCurrent = await getMessageLabelIds(gmail, GMAIL_USER, row.message_id);
        const currentImportant = labelIdsCurrent.includes(IMPORTANT_LABEL_ID);
        await updateLabelsForMessage(
          row.message_id,
          currentImportant,
          row.important,
          labelIdsCurrent
        );
        updated += 1;
      } catch (err) {
        errors += 1;
        logger.warn("Failed to sync labels for message", {
          messageId: row.message_id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return {
      updated,
      errors,
      processedToday: rows.length,
      startOfDay: startOfDayISO,
      endOfDay: endOfDayISO,
    };
  },
});
