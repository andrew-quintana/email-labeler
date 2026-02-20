import { schedules, tasks } from "@trigger.dev/sdk/v3";
import {
  getGmailClient,
  listMessageIdsWithoutUserLabels,
  getMessageLabelIds,
  isInvalidGrantError,
  INVALID_GRANT_MESSAGE,
} from "../gmail/client.js";
import {
  getProcessedEmailsWithNullLabelsSynced,
  updateLabelsForMessage,
  IMPORTANT_LABEL_ID,
} from "../db/important-update.js";
import type { labelOneMessageTask } from "./label-one-message.js";

const GMAIL_USER = process.env.GMAIL_USER_ID ?? "me";

const POLL_BATCH_SIZE = Math.min(
  Math.max(1, parseInt(process.env.POLL_BATCH_SIZE ?? "5", 10) || 5),
  50
);

const INBOX_LABEL_ID = "INBOX";
const UNREAD_LABEL_ID = "UNREAD";

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

/** True if user is considered to have interacted: read, or archived changed, or labels changed. */
function userModifiedEmail(
  currentLabelIds: string[],
  storedLabelIds: string[] | null,
  storedArchiveApplied: boolean
): boolean {
  const currentUnread = currentLabelIds.includes(UNREAD_LABEL_ID);
  const currentArchived = !currentLabelIds.includes(INBOX_LABEL_ID);
  const stored = storedLabelIds ?? [];
  const sameLabels =
    stored.length === currentLabelIds.length &&
    [...stored].sort().join(",") === [...currentLabelIds].sort().join(",");
  const sameArchived = currentArchived === storedArchiveApplied;
  if (currentUnread && sameArchived && sameLabels) return false;
  return true;
}

/**
 * Scheduled task: (1) Processed emails with null labels_synced_at — fetch Gmail state and sync
 * only when user interacted (read, or archived/labels changed); otherwise leave unsynced so the
 * next run reconsideres. (2) All mail except spam/trash/sent with no user-applied label — trigger
 * label-one-message per id. Add a schedule in the Trigger.dev dashboard or trigger manually.
 */
export const pollAndLabelTask = schedules.task({
  id: "poll-and-label",
  /** Syncs unsynced processed emails (when user modified), then triggers label-one-message for unlabeled messages in all mail (excl. spam/trash/sent). */
  machine: "small-1x",
  run: async (_payload: Record<string, unknown>) => {
    const options = getGmailOptions();
    const gmail = getGmailClient(options);

    let synced = 0;
    let skippedUnmodified = 0;

    try {
      if (process.env.SUPABASE_URL) {
        const nullSyncedRows = await getProcessedEmailsWithNullLabelsSynced(POLL_BATCH_SIZE);
        for (const row of nullSyncedRows) {
          try {
            const labelIdsCurrent = await getMessageLabelIds(gmail, GMAIL_USER, row.message_id);
            if (!userModifiedEmail(labelIdsCurrent, row.label_ids, row.archive_applied)) {
              skippedUnmodified += 1;
              continue;
            }
            const currentImportant = labelIdsCurrent.includes(IMPORTANT_LABEL_ID);
            await updateLabelsForMessage(
              row.message_id,
              currentImportant,
              row.important,
              labelIdsCurrent
            );
            synced += 1;
          } catch (_err) {
            if (isInvalidGrantError(_err)) throw _err;
            // skip failed message; next run will retry (labels_synced_at stays null)
          }
        }
      }

      /** All mail except spam, trash, and sent; then filter to messages with only system labels. */
      const messageIds = await listMessageIdsWithoutUserLabels(
        gmail,
        GMAIL_USER,
        POLL_BATCH_SIZE,
        "-in:spam -in:trash -in:sent"
      );

      for (const messageId of messageIds) {
        await tasks.trigger<typeof labelOneMessageTask>("label-one-message", {
          messageId,
        });
      }

      return {
        synced,
        skippedUnmodified,
        triggered: messageIds.length,
        messageIds,
      };
    } catch (err) {
      if (isInvalidGrantError(err)) {
        throw new Error(INVALID_GRANT_MESSAGE);
      }
      throw err;
    }
  },
});
