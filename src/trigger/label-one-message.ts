import { task, logger } from "@trigger.dev/sdk/v3";
import {
  getGmailClient,
  fetchMessage,
  ensureLabelExists,
  modifyMessageLabels,
  getInboxLabelId,
} from "../gmail/client.js";
import { parseEmail } from "../email/parse.js";
import { runEmailLabelingGraph } from "../orchestration/graph.js";
import { resolveLabelAndArchive } from "../orchestration/apply.js";
import { loadAndValidateAll } from "../config/loader.js";
import {
  resolvePromptVersionIds,
  recordProcessedEmail,
} from "../db/record.js";
import { inferImportant } from "../ml/important-inference.js";

const GMAIL_USER = process.env.GMAIL_USER_ID ?? "me";

const MESSAGE_RETRY_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [1000, 2000];

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

function isTransientError(err: unknown): boolean {
  if (err && typeof err === "object") {
    const status = (err as { response?: { status?: number } }).response?.status;
    if (status === 429) return true;
    if (status != null && status >= 500) return true;
    const code = (err as { code?: string }).code;
    if (
      code === "ECONNRESET" ||
      code === "ETIMEDOUT" ||
      code === "ENOTFOUND" ||
      code === "ECONNREFUSED" ||
      code === "EAI_AGAIN"
    )
      return true;
  }
  return false;
}

export type LabelOneMessagePayload = { messageId: string };

export type LabelOneMessageOutput =
  | { ok: true; messageId: string; label: string; archive: boolean; labels: string[] }
  | { ok: false; messageId: string; error: string; errorType: "transient" | "permanent" };

/**
 * Processes a single message: fetch → parse → graph → apply labels.
 * Runs on a small machine (one message only = low memory). Triggered by poll-and-label.
 *
 * Flow: Gmail fetch → parseEmail → runEmailLabelingGraph (summarize → label_router)
 *       → resolveLabelAndArchive → ensureLabelExists → modifyMessageLabels
 *       → recordProcessedEmail (if SUPABASE_URL). Failures: Gmail (transient retried),
 *       pipeline (state.error → Review), config/prompts (loader), DB (non-fatal unless prompt resolve fails).
 */
export const labelOneMessageTask = task({
  id: "label-one-message",
  /** Single message: one fetch, one graph run. Fits in 1 GB. */
  machine: "small-2x",
  run: async (payload: LabelOneMessagePayload): Promise<LabelOneMessageOutput> => {
    const { messageId } = payload;
    const runId = process.env.TRIGGER_RUN_ID ?? process.env.TRIGGER_TASK_RUN_ID ?? null;
    logger.info("label-one-message started", { messageId, runId });

    const options = getGmailOptions();
    const gmail = getGmailClient(options);
    const config = loadAndValidateAll();
    const inboxLabelId = await getInboxLabelId(gmail, GMAIL_USER);

    let lastErr: unknown;
    for (let attempt = 0; attempt < MESSAGE_RETRY_ATTEMPTS; attempt++) {
      try {
        if (attempt > 0) {
          await sleep(RETRY_DELAYS_MS[attempt - 1] ?? 2000);
        }
        const msg = await fetchMessage(gmail, GMAIL_USER, messageId);
        const email = parseEmail(msg);
        const state = await runEmailLabelingGraph(email);
        const { labelName, labelNames, archive } = resolveLabelAndArchive(state, config);

        // Full summarizer node output for debugging; log null explicitly if missing
        const summaryOutput = state.summary;
        if (summaryOutput === null || summaryOutput === undefined) {
          logger.warn("Summarizer produced no output (summary is null)", {
            messageId,
            subject: email.subject?.slice(0, 80),
            pipelineError: state.error ?? null,
          });
        } else {
          logger.info("Summary (full summarizer output)", {
            messageId,
            subject: email.subject?.slice(0, 80),
            summaryOutput: {
              summary: summaryOutput.summary,
              key_points: summaryOutput.key_points,
              entities: summaryOutput.entities,
              urgency: summaryOutput.urgency,
            },
          });
        }

        // --- Important classifier inference ---
        let modelImportant: boolean | null = null;
        const summaryText = state.summary?.summary ?? "";
        if (summaryText) {
          try {
            const inferResult = await inferImportant(summaryText);
            if (inferResult) {
              modelImportant = inferResult.important;
              logger.info("Important classifier result", {
                messageId,
                important: inferResult.important,
                probability: inferResult.probability,
                source: "model",
              });
            } else {
              logger.info("Important classifier: cold start (no model artifact)", { messageId });
            }
          } catch (impErr) {
            logger.warn("Important inference error (non-fatal)", {
              messageId,
              error: impErr instanceof Error ? impErr.message : String(impErr),
            });
          }
        }

        const addIds: string[] = [];
        for (const name of labelNames) {
          const id = await ensureLabelExists(gmail, GMAIL_USER, name);
          addIds.push(id);
        }
        const removeIds = archive ? [inboxLabelId] : [];

        // Remove Google's auto-applied CATEGORY_* labels
        const labelsBefore = msg.labelIds ?? [];
        const categoryLabelIds = labelsBefore.filter((id) => id.startsWith("CATEGORY_"));
        if (categoryLabelIds.length > 0) {
          logger.info("Removing CATEGORY_* labels", { messageId, categoryLabelIds });
        }
        removeIds.push(...categoryLabelIds);

        // Apply IMPORTANT label from model prediction
        if (modelImportant === true) {
          addIds.push("IMPORTANT");
        } else if (modelImportant === false) {
          removeIds.push("IMPORTANT");
        }

        logger.info("Gmail labels: modify", {
          messageId,
          label: labelName,
          labelNames,
          archive,
          important: modelImportant,
          removeLabelIds: removeIds.length ? removeIds : [],
          categoryConfidence: state.categoryConfidence ?? null,
          subcategoryConfidence: state.subcategoryConfidence ?? null,
        });
        await modifyMessageLabels(gmail, GMAIL_USER, messageId, addIds, removeIds);

        const labelsAfter = [
          ...labelsBefore.filter((id) => !removeIds.includes(id)),
          ...addIds,
        ];
        const labels = [...new Set(labelsAfter)];

        if (process.env.SUPABASE_URL) {
          try {
            const promptIds = await resolvePromptVersionIds();
            await recordProcessedEmail({
              messageId,
              threadId: email.threadId ?? "",
              body: email.bodyText ?? "",
              labelIds: labels,
              snippet: email.snippet || null,
              summary: state.summary?.summary ?? null,
              category: state.category ?? null,
              subcategory: state.subcategory ?? null,
              labelApplied: labelName,
              archiveApplied: archive,
              important: modelImportant,
              summarizerPromptVersionId: promptIds.summarizer,
              categoryRouterPromptVersionId: promptIds.category_router,
              subcategoryRouterPromptVersionId: promptIds.subcategory_router,
              importancePromptVersionId: null,
            });
          } catch (dbErr) {
            logger.warn("DB record processed_email failed (non-fatal)", {
              messageId,
              error: dbErr instanceof Error ? dbErr.message : String(dbErr),
            });
          }
        }

        return { ok: true, messageId, label: labelName, archive, labels };
      } catch (err) {
        lastErr = err;
        const errorType = isTransientError(err) ? "transient" : "permanent";
        logger.warn("label-one-message attempt failed", {
          messageId,
          runId,
          attempt: attempt + 1,
          errorType,
          error: err instanceof Error ? err.message : String(err),
        });
        if (attempt < MESSAGE_RETRY_ATTEMPTS - 1 && isTransientError(err)) {
          continue;
        }
        return {
          ok: false,
          messageId,
          error: err instanceof Error ? err.message : String(err),
          errorType,
        };
      }
    }
    logger.warn("label-one-message exhausted retries", {
      messageId,
      runId,
      error: lastErr instanceof Error ? lastErr.message : String(lastErr),
    });
    return {
      ok: false,
      messageId,
      error: lastErr instanceof Error ? lastErr.message : String(lastErr),
      errorType: "transient",
    };
  },
});
