import { writeFile, readFile, mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { schedules, logger } from "@trigger.dev/sdk/v3";
import { getSupabase, getUTCDateString } from "../db/supabase.js";
import {
  buildGmailIdToLabelMap,
  getTrainingDataForLabelRouter,
} from "../db/label-feedback.js";
import { loadConfig } from "../config/loader.js";

type TrainingPayload = Record<string, unknown>;

/**
 * Train the label router head from user feedback (mislabeled emails).
 * Embeds (sentence-transformers) + trains multi-class logistic regression, persists model.
 * Run after sync-labels-nightly (e.g. nightly).
 */
export const trainLabelRouterTask = schedules.task({
  id: "train-label-router",
  machine: "small-2x",
  run: async (_payload: TrainingPayload) => {
    if (!process.env.SUPABASE_URL) {
      logger.info("SUPABASE_URL not set; skipping train-label-router");
      return { trained: false, skipped: true, reason: "no_supabase" };
    }

    // Load leaf_rules to build Gmail ID → label name map
    const leafRulesConfig = loadConfig<{
      leaf_rules: Array<{
        name: string;
        actions: Array<{ type: string; labelIds?: string[] }>;
      }>;
    }>("leaf_rules.json" as Parameters<typeof loadConfig>[0]);
    const leafRules = leafRulesConfig.leaf_rules ?? [];
    const gmailIdToLabel = buildGmailIdToLabelMap(leafRules);

    const rows = await getTrainingDataForLabelRouter(gmailIdToLabel);
    if (rows.length === 0) {
      return {
        trained: false,
        samples: 0,
        message: "No feedback rows with resolvable target labels",
      };
    }

    const trainingData = rows.map((r) => ({
      text: r.text,
      target_label: r.target_label,
    }));

    try {
      const { python } = await import("@trigger.dev/python");
      const dir = await mkdtemp(join(tmpdir(), "train-label-router-"));
      const dataPath = join(dir, "data.json");
      const modelPath = join(dir, "label_router_model.pkl");
      await writeFile(dataPath, JSON.stringify(trainingData), "utf-8");

      const scriptPath = "./python/train_label_router.py";
      const result = await python.runScript(scriptPath, [dataPath, modelPath]);
      const out = result.stdout?.trim() || "{}";
      let meta: { samples?: number; labels?: number; path?: string; skipped?: boolean; reason?: string } = {};
      try {
        meta = JSON.parse(out);
      } catch {
        meta = { samples: rows.length };
      }

      // Not enough distinct labels to train — exit gracefully
      if (meta.skipped) {
        logger.info("Training skipped", { reason: meta.reason, samples: meta.samples });
        return { trained: false, samples: rows.length, labels: meta.labels ?? 0, message: meta.reason };
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
      const datedKey = `label-router/${getUTCDateString(1)}.pkl`;
      const latestKey = "label-router/latest.pkl";
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
        labels: meta.labels ?? 0,
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
          message:
            "Install @trigger.dev/python and pythonExtension for embed + train",
        };
      }
      throw err;
    }
  },
});
