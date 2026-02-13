import { writeFile, mkdtemp } from "node:fs/promises";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { logger } from "@trigger.dev/sdk/v3";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..", "..");

/** Candidate roots for python/ in Trigger.dev (cwd can be /app, code under /app/workspace). */
function resolvePythonScriptPath(scriptName: string): string | null {
  const candidates = [
    join(process.cwd(), "python", scriptName),
    join(ROOT, "python", scriptName),
    join("/app", "python", scriptName),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

import { getSupabase, getUTCDateString } from "../db/supabase.js";

export interface LabelRouterHeadResult {
  /** Weight per label in [0, 1]. Keys are label names. */
  headWeights: Record<string, number>;
  labelList: string[];
}

/**
 * Download the label-router artifact from Supabase Storage,
 * run the Python inference script, and return head weights.
 * Returns null on cold start (no artifact) or inference failure.
 */
export async function inferLabelRouterHead(
  text: string
): Promise<LabelRouterHeadResult | null> {
  if (!process.env.SUPABASE_URL) return null;

  const supabase = getSupabase();
  const bucket = "models";
  const datedKey = `label-router/${getUTCDateString()}.pkl`;
  const fallbackKey = "label-router/latest.pkl";

  // Try today's dated artifact first, then fall back to latest
  let blob: Blob | null = null;
  let usedKey = datedKey;
  const { data: datedBlob, error: datedErr } = await supabase.storage
    .from(bucket)
    .download(datedKey);
  if (datedErr || !datedBlob) {
    const { data: latestBlob, error: latestErr } = await supabase.storage
      .from(bucket)
      .download(fallbackKey);
    if (latestErr || !latestBlob) {
      logger.info("Label router artifact not found (cold start)", {
        error: latestErr?.message ?? "no data",
      });
      return null;
    }
    blob = latestBlob;
    usedKey = fallbackKey;
  } else {
    blob = datedBlob;
  }
  logger.info("Label router loaded", { key: usedKey });

  try {
    const { python } = await import("@trigger.dev/python");
    const dir = await mkdtemp(join(tmpdir(), "infer-label-router-"));
    const modelPath = join(dir, "model.pkl");

    const arrayBuffer = await blob.arrayBuffer();
    await writeFile(modelPath, Buffer.from(arrayBuffer));

    const scriptPath = resolvePythonScriptPath("infer_label_router.py");
    if (!scriptPath) {
      logger.warn("Label router inference script not found", {
        cwd: process.cwd(),
        rootsTried: [process.cwd(), ROOT, "/app"],
      });
      return null;
    }
    const result = await python.runScript(scriptPath, [
      modelPath,
      text.slice(0, 10_000),
    ]);
    const out = result.stdout?.trim() || "{}";
    const parsed = JSON.parse(out) as {
      head_weights?: Record<string, number>;
      label_list?: string[];
    };

    if (!parsed.head_weights || !parsed.label_list) {
      logger.warn("Label router inference: unexpected output", { out });
      return null;
    }

    return {
      headWeights: parsed.head_weights,
      labelList: parsed.label_list,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (
      msg.includes("Cannot find module") ||
      msg.includes("@trigger.dev/python")
    ) {
      logger.info(
        "Python extension not available; skipping label router head inference"
      );
    } else {
      logger.warn("Label router head inference failed", { error: msg });
    }
    return null;
  }
}
