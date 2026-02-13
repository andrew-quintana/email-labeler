import { logger } from "@trigger.dev/sdk/v3";
import Anthropic from "@anthropic-ai/sdk";

const DEFAULT_MODEL = "claude-haiku-4-5";
const TIMEOUT_MS = 60_000;
const MAX_RETRIES = 5; // parse + rate/transient with backoff

function parseJson<T>(raw: string): T {
  const trimmed = raw.trim().replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim();
  return JSON.parse(trimmed) as T;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function jitter(baseMs: number): number {
  return Math.floor(baseMs * (0.5 + Math.random() * 0.5));
}

/** True if error is rate limit, overloaded, timeout, or 5xx (retry with backoff). */
function isRetryableRateOrTransientError(e: unknown): boolean {
  const msg = (e as Error).message?.toLowerCase() ?? "";
  const code = (e as { code?: number; status?: number }).code ?? (e as { code?: number; status?: number }).status;
  if (code === 429) return true;
  return (
    msg.includes("429") ||
    msg.includes("rate") ||
    msg.includes("overloaded") ||
    msg.includes("timeout") ||
    msg.includes("unavailable") ||
    (e as Error).name === "AbortError" ||
    (typeof code === "number" && code >= 500)
  );
}

export interface SummarizerOptions {
  apiKey?: string;
  model?: string;
  timeoutMs?: number;
}

/**
 * Call Anthropic for summarization with strict JSON output.
 * Retries on parse failure; up to 5 attempts with exponential backoff on 429/rate/overloaded/timeout.
 */
export async function summarize(
  prompt: string,
  options: SummarizerOptions = {}
): Promise<{
  summary: string;
  key_points: string[];
  entities: string[];
  suggested_labels: string[];
  urgency: "low" | "normal" | "high" | "urgent";
}> {
  const apiKey = options.apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is required");
  const model = options.model ?? process.env.DEFAULT_ANTHROPIC_MODEL ?? DEFAULT_MODEL;
  const timeoutMs = options.timeoutMs ?? TIMEOUT_MS;

  const client = new Anthropic({ apiKey });
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      const response = await client.messages.create(
        {
          model,
          max_tokens: 1024,
          system: "You respond only with valid JSON. No markdown code fences, no explanation.",
          messages: [{ role: "user", content: prompt }],
        },
        { signal: controller.signal }
      );
      clearTimeout(timeout);

      const text =
        response.content?.find((b) => b.type === "text")?.type === "text"
          ? (response.content.find((b) => b.type === "text") as { type: "text"; text: string }).text
          : "";
      if (!text || !text.trim()) {
        logger.warn("Anthropic summarizer: empty response text", {
          provider: "anthropic",
          model,
          contentBlockCount: response.content?.length ?? 0,
        });
        throw new Error("Anthropic returned empty or non-text content");
      }
      const parsed = parseJson<{
        summary: string;
        key_points: string[];
        entities: string[];
        suggested_labels: string[];
        urgency: string;
      }>(text);

      const urgency = ["low", "normal", "high", "urgent"].includes(parsed.urgency)
        ? (parsed.urgency as "low" | "normal" | "high" | "urgent")
        : "normal";
      return {
        summary: String(parsed.summary ?? ""),
        key_points: Array.isArray(parsed.key_points) ? parsed.key_points.map(String) : [],
        entities: Array.isArray(parsed.entities) ? parsed.entities.map(String) : [],
        suggested_labels: Array.isArray(parsed.suggested_labels) ? parsed.suggested_labels.map(String) : [],
        urgency,
      };
    } catch (e) {
      lastError = e as Error;
      const err = e as Error & { status?: number; code?: string };
      logger.warn("Anthropic summarizer: attempt failed", {
        provider: "anthropic",
        attempt: attempt + 1,
        errorMessage: lastError.message,
        errorName: lastError.name,
        status: err.status ?? null,
        code: err.code ?? null,
        willRetry:
          (lastError.message?.includes("JSON") && attempt < MAX_RETRIES - 1) ||
          (isRetryableRateOrTransientError(e) && attempt < MAX_RETRIES - 1),
      });
      const isParse = lastError.message?.includes("JSON") ?? false;
      if (isParse && attempt < MAX_RETRIES - 1) continue;
      if (isRetryableRateOrTransientError(e) && attempt < MAX_RETRIES - 1) {
        await sleep(jitter(1000 * Math.pow(2, attempt)));
        continue;
      }
      logger.error("Anthropic summarizer: all retries exhausted", {
        provider: "anthropic",
        errorMessage: lastError.message,
        errorName: lastError.name,
        status: err.status ?? null,
        code: err.code ?? null,
      });
      throw lastError;
    }
  }
  logger.error("Anthropic summarizer: failed", {
    provider: "anthropic",
    errorMessage: lastError?.message ?? "unknown",
    errorName: lastError?.name ?? null,
  });
  throw lastError ?? new Error("Summarize failed");
}
