#!/usr/bin/env node
/**
 * Trigger tasks and manage schedules via the Trigger.dev REST API.
 *
 * Usage:
 *   node scripts/trigger-tasks.mjs trigger <task-id>         # trigger a task
 *   node scripts/trigger-tasks.mjs trigger-all               # trigger sync + both training tasks
 *   node scripts/trigger-tasks.mjs schedule <task-id> <cron> # create/update a weekly schedule
 *   node scripts/trigger-tasks.mjs setup-weekly              # create weekly schedules for all 3 tasks
 *   node scripts/trigger-tasks.mjs list-schedules            # list existing schedules
 *
 * Requires TRIGGER_SECRET_KEY in .env or environment.
 *
 * Load .env: node -r dotenv/config scripts/trigger-tasks.mjs ...
 */

const API_BASE = "https://api.trigger.dev";

function getSecretKey() {
  const key = process.env.TRIGGER_SECRET_KEY;
  if (!key) {
    console.error("TRIGGER_SECRET_KEY not set. Set it in .env or environment.");
    process.exit(1);
  }
  return key;
}

async function apiCall(method, path, body) {
  const key = getSecretKey();
  const url = `${API_BASE}${path}`;
  const opts = {
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
  };
  if (body) opts.body = JSON.stringify(body);

  const res = await fetch(url, opts);
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }

  if (!res.ok) {
    console.error(`API ${method} ${path} → ${res.status}`);
    console.error(json ?? text);
    return null;
  }
  return json;
}

async function triggerTask(taskId, payload = {}) {
  console.log(`Triggering ${taskId}...`);
  const result = await apiCall("POST", `/api/v1/tasks/${taskId}/trigger`, {
    payload,
  });
  if (result) {
    console.log(`  Run ID: ${result.id}`);
    console.log(`  Status: triggered`);
  }
  return result;
}

async function createSchedule(taskId, cron, externalId) {
  console.log(`Creating schedule for ${taskId}: ${cron} (id: ${externalId})`);
  const result = await apiCall("POST", "/api/v3/schedules", {
    task: taskId,
    cron,
    externalId,
    deduplicationKey: externalId,
  });
  if (result) {
    console.log(`  Schedule ID: ${result.id}`);
    console.log(`  Next run: ${result.nextRun ?? "unknown"}`);
  }
  return result;
}

async function listSchedules() {
  const result = await apiCall("GET", "/api/v3/schedules");
  if (result && result.data) {
    console.log(`Found ${result.data.length} schedule(s):`);
    for (const s of result.data) {
      console.log(`  ${s.id} | task=${s.task} | cron=${s.cron} | next=${s.nextRun ?? "?"}`);
    }
  } else {
    console.log("No schedules found (or API returned unexpected format).");
    if (result) console.log(JSON.stringify(result, null, 2));
  }
  return result;
}

async function main() {
  const [cmd, ...args] = process.argv.slice(2);

  switch (cmd) {
    case "trigger": {
      const taskId = args[0];
      if (!taskId) {
        console.error("Usage: trigger <task-id>");
        process.exit(1);
      }
      await triggerTask(taskId);
      break;
    }

    case "trigger-all": {
      console.log("=== Triggering sync-labels-nightly ===");
      await triggerTask("sync-labels-nightly");
      console.log("\n=== Triggering train-important-classifier ===");
      await triggerTask("train-important-classifier");
      console.log("\n=== Triggering train-label-router ===");
      await triggerTask("train-label-router");
      break;
    }

    case "schedule": {
      const [taskId, cron] = args;
      if (!taskId || !cron) {
        console.error('Usage: schedule <task-id> "<cron>"');
        process.exit(1);
      }
      await createSchedule(taskId, cron, `${taskId}-weekly`);
      break;
    }

    case "setup-weekly": {
      console.log("Setting up weekly schedules (Sunday UTC)...\n");

      // Sync first at 2am, training at 4am and 5am to ensure sync finishes first
      await createSchedule("sync-labels-nightly", "0 2 * * 0", "sync-labels-weekly");
      console.log();
      await createSchedule("train-important-classifier", "0 4 * * 0", "train-important-weekly");
      console.log();
      await createSchedule("train-label-router", "0 5 * * 0", "train-label-router-weekly");
      console.log("\nDone. Schedules run every Sunday: sync@2am, train-important@4am, train-label-router@5am UTC.");
      break;
    }

    case "list-schedules": {
      await listSchedules();
      break;
    }

    default:
      console.log("Usage:");
      console.log("  trigger <task-id>         Trigger a single task");
      console.log("  trigger-all               Trigger sync + both training tasks");
      console.log('  schedule <task-id> <cron> Create a schedule');
      console.log("  setup-weekly              Create weekly schedules for all 3 tasks");
      console.log("  list-schedules            List existing schedules");
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
