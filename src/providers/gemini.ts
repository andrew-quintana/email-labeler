import { GoogleGenerativeAI } from "@google/generative-ai";

const DEFAULT_MODEL = "gemini-2.5-flash";
const TIMEOUT_MS = 30_000;
/** Total attempts (parse + rate limit); backoff used for rate/transient errors. */
const MAX_RETRIES = 5;

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

/** True if error is 429, resource exhausted, overloaded, or timeout (retry with backoff). */
function isRetryableRateOrTransientError(e: unknown): boolean {
  const msg = (e as Error).message?.toLowerCase() ?? "";
  const code = (e as { code?: number; status?: number }).code ?? (e as { code?: number; status?: number }).status;
  if (code === 429) return true;
  return (
    msg.includes("429") ||
    msg.includes("too many requests") ||
    msg.includes("resource exhausted") ||
    msg.includes("resource_exhausted") ||
    msg.includes("overloaded") ||
    msg.includes("timeout") ||
    msg.includes("unavailable") ||
    (typeof code === "number" && code >= 500)
  );
}

export interface GeminiOptions {
  apiKey?: string;
  model?: string;
  timeoutMs?: number;
}

function runWithTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, rej) => setTimeout(() => rej(new Error("Timeout")), ms)),
  ]);
}

/**
 * Category classification: strict JSON { category, confidence, reason }.
 * Constrain to allowed categories list; one repair retry on parse failure.
 */
export async function classifyCategory(
  prompt: string,
  allowedCategories: string[],
  options: GeminiOptions = {}
): Promise<{ category: string; confidence: number; reason: string }> {
  const apiKey = options.apiKey ?? process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is required");
  const modelId = options.model ?? process.env.DEFAULT_GEMINI_MODEL ?? DEFAULT_MODEL;
  const timeoutMs = options.timeoutMs ?? TIMEOUT_MS;

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: modelId });
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const result = await runWithTimeout(
        model.generateContent({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0,
            responseMimeType: "application/json",
          },
        }),
        timeoutMs
      );
      const text = result.response.text()?.trim() ?? "";
      const parsed = parseJson<{ category: string; confidence: number; reason: string }>(text);
      const category = allowedCategories.includes(parsed.category)
        ? parsed.category
        : allowedCategories[0] ?? "other";
      return {
        category,
        confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || 0)),
        reason: String(parsed.reason ?? ""),
      };
    } catch (e) {
      lastError = e as Error;
      const isParse = (e as Error).message?.includes("JSON") ?? false;
      if (isParse && attempt < MAX_RETRIES - 1) continue;
      if (isRetryableRateOrTransientError(e) && attempt < MAX_RETRIES - 1) {
        await sleep(jitter(1000 * Math.pow(2, attempt)));
        continue;
      }
      throw lastError;
    }
  }
  throw lastError ?? new Error("Classify category failed");
}

/**
 * Subcategory classification: strict JSON { subcategory, confidence, reason }.
 * Constrain to allowed subcategories for the chosen category.
 */
export async function classifySubcategory(
  prompt: string,
  allowedSubcategories: string[],
  options: GeminiOptions = {}
): Promise<{ subcategory: string; confidence: number; reason: string }> {
  const apiKey = options.apiKey ?? process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is required");
  const modelId = options.model ?? process.env.DEFAULT_GEMINI_MODEL ?? DEFAULT_MODEL;
  const timeoutMs = options.timeoutMs ?? TIMEOUT_MS;

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: modelId });
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const result = await runWithTimeout(
        model.generateContent({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0,
            responseMimeType: "application/json",
          },
        }),
        timeoutMs
      );
      const text = result.response.text()?.trim() ?? "";
      const parsed = parseJson<{ subcategory: string; confidence: number; reason: string }>(text);
      const subcategory = allowedSubcategories.includes(parsed.subcategory)
        ? parsed.subcategory
        : allowedSubcategories[0] ?? "other";
      return {
        subcategory,
        confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || 0)),
        reason: String(parsed.reason ?? ""),
      };
    } catch (e) {
      lastError = e as Error;
      const isParse = (e as Error).message?.includes("JSON") ?? false;
      if (isParse && attempt < MAX_RETRIES - 1) continue;
      if (isRetryableRateOrTransientError(e) && attempt < MAX_RETRIES - 1) {
        await sleep(jitter(1000 * Math.pow(2, attempt)));
        continue;
      }
      throw lastError;
    }
  }
  throw lastError ?? new Error("Classify subcategory failed");
}

/**
 * Label router classification: strict JSON { label, confidence, reason, weights }.
 * Returns the chosen label and per-label weights (0-100).
 */
export async function classifyLabel(
  prompt: string,
  allowedLabels: string[],
  options: GeminiOptions = {}
): Promise<{
  label: string;
  confidence: number;
  reason: string;
  weights: Record<string, number>;
}> {
  const apiKey = options.apiKey ?? process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is required");
  const modelId = options.model ?? process.env.DEFAULT_GEMINI_MODEL ?? DEFAULT_MODEL;
  const timeoutMs = options.timeoutMs ?? TIMEOUT_MS;

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: modelId });
  let lastError: Error | null = null;
  const labelSet = new Set(allowedLabels);

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const result = await runWithTimeout(
        model.generateContent({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0,
            responseMimeType: "application/json",
          },
        }),
        timeoutMs
      );
      const text = result.response.text()?.trim() ?? "";
      const parsed = parseJson<{
        label: string;
        confidence: number;
        reason: string;
        weights?: Record<string, number>;
      }>(text);

      const label = labelSet.has(parsed.label)
        ? parsed.label
        : allowedLabels[0] ?? "Review";

      // Normalize weights: ensure all allowed labels have a value
      const rawWeights = parsed.weights ?? {};
      const weights: Record<string, number> = {};
      for (const l of allowedLabels) {
        const w = rawWeights[l];
        weights[l] = typeof w === "number" ? Math.max(0, Math.min(100, w)) : 0;
      }

      return {
        label,
        confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || 0)),
        reason: String(parsed.reason ?? ""),
        weights,
      };
    } catch (e) {
      lastError = e as Error;
      const isParse = (e as Error).message?.includes("JSON") ?? false;
      if (isParse && attempt < MAX_RETRIES - 1) continue;
      if (isRetryableRateOrTransientError(e) && attempt < MAX_RETRIES - 1) {
        await sleep(jitter(1000 * Math.pow(2, attempt)));
        continue;
      }
      throw lastError;
    }
  }
  throw lastError ?? new Error("Classify label failed");
}
