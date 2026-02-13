import { writeFile, readFile, mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { schedules, logger } from "@trigger.dev/sdk/v3";
import { getFeedbackRowsForTraining } from "../db/important-update.js";
import { getSupabase, getUTCDateString } from "../db/supabase.js";

type TrainingPayload = Record<string, unknown>;

/**
 * Train the importance classifier on rows where important_updated = true.
 * Embeds (sentence-transformers) + trains logistic regression, then persists model.
 * Run after sync-labels-nightly (e.g. nightly).
 */
export const trainImportantClassifierTask = schedules.task({
  id: "train-important-classifier",
  machine: "small-2x",
  run: async (_payload: TrainingPayload) => {
    if (!process.env.SUPABASE_URL) {
      logger.info("SUPABASE_URL not set; skipping train-important-classifier");
      return { trained: false, skipped: true, reason: "no_supabase" };
    }

    const rows = await getFeedbackRowsForTraining();
    if (rows.length === 0) {
      return { trained: false, samples: 0, message: "No feedback rows with important_updated = true" };
    }

    const trainingData = rows.map((r) => ({
      text: (r.summary || r.body || "").slice(0, 10_000),
      important: r.important,
    }));

    try {
      const { python } = await import("@trigger.dev/python");
      const dir = await mkdtemp(join(tmpdir(), "train-"));
      const dataPath = join(dir, "data.json");
      const modelPath = join(dir, "important_model.pkl");
      await writeFile(dataPath, JSON.stringify(trainingData), "utf-8");

      const scriptPath = "./python/train_important.py";
      const result = await python.runScript(scriptPath, [dataPath, modelPath]);
      const out = result.stdout?.trim() || "{}";
      let meta: { samples?: number; path?: string } = {};
      try {
        meta = JSON.parse(out);
      } catch {
        meta = { samples: rows.length };
      }

      const supabase = getSupabase();
      let modelData: Buffer;
      try {
        modelData = await readFile(modelPath);
      } catch (readErr) {
        logger.warn("Could not read model file for upload", {
          path: modelPath,
          error: readErr instanceof Error ? readErr.message : String(readErr),
        });
        return { trained: true, samples: rows.length, modelSaved: false, meta };
      }

      const bucket = "models";
      const datedKey = `important-classifier/${getUTCDateString(1)}.pkl`;
      const latestKey = "important-classifier/latest.pkl";
      const uploadOpts = { contentType: "application/octet-stream", upsert: true };

      const { error: datedErr } = await supabase.storage.from(bucket).upload(datedKey, modelData, uploadOpts);
      if (datedErr) {
        throw new Error(`Supabase storage upload failed (bucket "${bucket}"): ${datedErr.message}`);
      }
      const { error: latestErr } = await supabase.storage.from(bucket).upload(latestKey, modelData, uploadOpts);
      if (latestErr) {
        throw new Error(`Supabase storage upload failed (bucket "${bucket}"): ${latestErr.message}`);
      }

      return {
        trained: true,
        samples: rows.length,
        modelSaved: true,
        modelPaths: [datedKey, latestKey],
        meta,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (
        msg.includes("Cannot find module") ||
        msg.includes("@trigger.dev/python") ||
        msg.includes("python.runScript")
      ) {
        logger.info("Python extension not available; training data prepared", {
          samples: rows.length,
          hint: "Add @trigger.dev/python and pythonExtension to run embedding + training",
        });
        return {
          trained: false,
          samples: rows.length,
          message: "Install @trigger.dev/python and pythonExtension for embed + train",
        };
      }
      throw err;
    }
  },
});
