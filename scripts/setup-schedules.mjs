#!/usr/bin/env node
/**
 * Create weekly schedules for sync-labels-nightly, train-important-classifier,
 * and train-label-router using the Trigger.dev SDK.
 *
 * Usage: node -r dotenv/config scripts/setup-schedules.mjs
 */
import { schedules, configure } from "@trigger.dev/sdk/v3";

const key = process.env.TRIGGER_SECRET_KEY;
if (!key) {
  console.error("TRIGGER_SECRET_KEY not set");
  process.exit(1);
}

configure({ secretKey: key });

const defs = [
  {
    task: "sync-labels-nightly",
    cron: "0 2 * * 0",
    externalId: "sync-labels-weekly",
    desc: "Sunday 2am UTC",
  },
  {
    task: "train-important-classifier",
    cron: "0 4 * * 0",
    externalId: "train-important-weekly",
    desc: "Sunday 4am UTC",
  },
  {
    task: "train-label-router",
    cron: "0 5 * * 0",
    externalId: "train-label-router-weekly",
    desc: "Sunday 5am UTC",
  },
];

for (const def of defs) {
  try {
    console.log(`Creating schedule: ${def.task} → ${def.cron} (${def.desc})`);
    const result = await schedules.create({
      task: def.task,
      cron: def.cron,
      externalId: def.externalId,
      deduplicationKey: def.externalId,
    });
    console.log(`  OK — schedule id: ${result.id}\n`);
  } catch (err) {
    console.error(`  FAILED: ${err.message}\n`);
  }
}

console.log("Done.");
