import { schedules, logger } from "@trigger.dev/sdk/v3";
import { getGmailClient, getMessageLabelIds, isInvalidGrantError, INVALID_GRANT_MESSAGE } from "../gmail/client.js";
import {
  getUnsyncedProcessedEmails,
  updateLabelsForMessage,
  IMPORTANT_LABEL_ID,
} from "../db/important-update.js";

const GMAIL_USER = process.env.GMAIL_USER_ID ?? "me";

/** Process unsynced emails in batches of this size. */
const BATCH_SIZE = 50;

/** Delay between Gmail API calls (ms) to avoid rate limits. */
const API_DELAY_MS = 100;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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
 * Sync task: query ALL processed_emails where labels_synced_at IS NULL,
 * fetch current Gmail labels for each message, and update important,
 * important_updated, label_ids_current, labels_synced_at.
 *
 * Processes the full backlog in batches until no more unsynced rows remain.
 * Captures all labels so both the important classifier and the label router
 * can learn from user corrections. Run weekly before training tasks.
 */
export const syncLabelsNightlyTask = schedules.task({
  id: "sync-labels-nightly",
  machine: "small-1x",
  maxDuration: 300,
  run: async (_payload: Record<string, unknown>) => {
    if (!process.env.SUPABASE_URL) {
      logger.info("SUPABASE_URL not set; skipping sync-labels-nightly");
      return { updated: 0, skipped: true, reason: "no_supabase" };
    }

    const options = getGmailOptions();
    const gmail = getGmailClient(options);

    let totalUpdated = 0;
    let totalErrors = 0;
    let totalProcessed = 0;

    try {
      // Process in batches until no more unsynced rows
      while (true) {
        const rows = await getUnsyncedProcessedEmails(BATCH_SIZE);
        if (rows.length === 0) break;

        totalProcessed += rows.length;
        logger.info("sync-labels-nightly: processing batch", {
          batchSize: rows.length,
          totalProcessedSoFar: totalProcessed,
        });

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
            totalUpdated += 1;
          } catch (err) {
            if (isInvalidGrantError(err)) throw err;
            totalErrors += 1;
            logger.warn("Failed to sync labels for message", {
              messageId: row.message_id,
              error: err instanceof Error ? err.message : String(err),
            });
          }
          // Rate limit Gmail API calls
          await sleep(API_DELAY_MS);
        }
      }
    } catch (err) {
      if (isInvalidGrantError(err)) {
        throw new Error(INVALID_GRANT_MESSAGE);
      }
      throw err;
    }

    logger.info("sync-labels-nightly complete", {
      totalUpdated,
      totalErrors,
      totalProcessed,
    });

    return {
      updated: totalUpdated,
      errors: totalErrors,
      totalProcessed,
    };
  },
});
