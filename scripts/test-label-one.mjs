/**
 * Run inbox message(s) through the labeling pipeline with optional apply and verification.
 *
 * Usage:
 *   pnpm run test:label                    # dry run, 1 message (first unlabeled)
 *   pnpm run test:label -- --apply        # apply labels to 1 message, then verify
 *   pnpm run test:label -- --count 5      # dry run on 5 messages
 *   pnpm run test:label -- --apply --count 5   # apply to 5 messages, verify each
 *   pnpm run test:label -- <messageId>    # dry run on specific message
 *   pnpm run test:label -- --list-labels  # print user labels and ASCII skeletons (debug)
 *   pnpm run test:label -- --histogram [--count N]  # dry run, then write confidence-histogram.html
 *
 * Load .env via: node -r dotenv/config (npm script does this).
 * With --apply: adds resolved label only, optionally removes INBOX (archive).
 * After --apply: re-fetches message and verifies resolved label is in labelIds (feedback loop).
 */

import {
  getGmailClient,
  listInboxMessageIdsWithoutUserLabels,
  fetchMessage,
  ensureLabelExists,
  modifyMessageLabels,
  getInboxLabelId,
} from "../dist/gmail/client.js";
import { parseEmail } from "../dist/email/parse.js";
import { runEmailLabelingGraph } from "../dist/orchestration/graph.js";
import { resolveLabelAndArchive } from "../dist/orchestration/apply.js";
import { loadAndValidateAll } from "../dist/config/loader.js";

const GMAIL_USER = process.env.GMAIL_USER_ID ?? "me";

function getGmailOptions() {
  const clientId = process.env.GMAIL_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET;
  const refreshToken = process.env.GMAIL_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(
      "Missing GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, or GMAIL_REFRESH_TOKEN in .env"
    );
  }
  return { clientId, clientSecret, refreshToken, userEmail: undefined };
}

function parseArgs() {
  const argv = process.argv.slice(2);
  let messageId = null;
  let apply = false;
  let count = 1;
  let listLabels = false;
  let histogram = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--apply") apply = true;
    else if (a === "--list-labels") listLabels = true;
    else if (a === "--histogram") histogram = true;
    else if (a === "--count" && argv[i + 1] != null) {
      count = Math.max(1, parseInt(argv[i + 1], 10) || 1);
      i++;
    } else if (a.startsWith("--count=")) {
      count = Math.max(1, parseInt(a.slice(8), 10) || 1);
    } else if (!a.startsWith("--")) messageId = a;
  }
  if (messageId) count = 1;
  if (histogram && count === 1) count = 20;
  return { messageId, apply, count, listLabels, histogram };
}

async function processOne(gmail, config, messageId, doApply) {
  const result = {
    messageId,
    subject: null,
    resolvedLabel: null,
    archive: false,
    applied: false,
    verified: false,
    error: null,
    category: null,
    subcategory: null,
    categoryConfidence: null,
    subcategoryConfidence: null,
  };

  try {
    const msg = await fetchMessage(gmail, GMAIL_USER, messageId);
    const email = parseEmail(msg);
    result.subject = email.subject ?? "(no subject)";

    const state = await runEmailLabelingGraph(email);
    const { labelName, archive } = resolveLabelAndArchive(state, config);
    result.resolvedLabel = labelName;
    result.archive = archive;
    result.category = state.category;
    result.subcategory = state.subcategory;
    result.categoryConfidence = state.categoryConfidence;
    result.subcategoryConfidence = state.subcategoryConfidence;
    result.labelConfidence = state.labelConfidence ?? null;
    result.routerLabel = state.label ?? null;

    if (!doApply) return result;

    const inboxLabelId = await getInboxLabelId(gmail, GMAIL_USER);
    const labelId = await ensureLabelExists(gmail, GMAIL_USER, labelName);
    const addIds = [labelId];
    const removeIds = archive ? [inboxLabelId] : [];
    await modifyMessageLabels(gmail, GMAIL_USER, messageId, addIds, removeIds);
    result.applied = true;

    const refetch = await fetchMessage(gmail, GMAIL_USER, messageId);
    const labelIds = refetch.labelIds ?? [];
    result.verified = labelIds.includes(labelId);
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
  }
  return result;
}

function printResult(r, index) {
  const status = r.error
    ? `ERROR: ${r.error.slice(0, 60)}`
    : r.applied
      ? (r.verified ? "APPLIED+VERIFIED" : "APPLIED but NOT VERIFIED")
      : `${r.resolvedLabel} (dry run)`;
  const catConf = r.categoryConfidence != null ? r.categoryConfidence.toFixed(2) : "—";
  const subConf = r.subcategoryConfidence != null ? r.subcategoryConfidence.toFixed(2) : "—";
  console.log(
    `  ${index + 1}. ${r.messageId} | ${r.category}/${r.subcategory} | ${r.resolvedLabel ?? "—"} | cat=${catConf} sub=${subConf} | ${status}`
  );
  if (r.error) console.log(`      ${r.error}`);
}

function asciiSkeleton(s) {
  return (s ?? "").normalize("NFC").toLowerCase().replace(/[^\x20-\x7e]/g, "");
}

async function main() {
  const { messageId, apply, count, listLabels, histogram } = parseArgs();
  const options = getGmailOptions();
  const gmail = getGmailClient(options);
  const config = loadAndValidateAll();

  if (listLabels) {
    const list = await gmail.users.labels.list({ userId: GMAIL_USER });
    const labels = list.data.labels ?? [];
    console.log("User labels (name -> ascii skeleton):\n");
    labels
      .filter((l) => l.type === "user" || l.type === undefined)
      .forEach((l) => {
        const skel = asciiSkeleton(l.name);
        console.log(`  ${l.name ?? ""} -> "${skel}"`);
      });
    process.exit(0);
    return;
  }

  const doApply = apply && !histogram;
  let ids = [];
  if (messageId) {
    ids = [messageId];
    console.log("Using message:", messageId);
  } else {
    ids = await listInboxMessageIdsWithoutUserLabels(gmail, GMAIL_USER, count);
    if (ids.length === 0) {
      console.log("No unlabeled message(s) in inbox.");
      console.log("Usage: pnpm run test:label [--apply] [--count N] [--histogram] [messageId]");
      process.exit(0);
      return;
    }
    console.log(`Processing ${ids.length} message(s) (apply=${doApply}${histogram ? ", histogram=yes" : ""})\n`);
  }

  const results = [];
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    process.stdout.write(`  [${i + 1}/${ids.length}] ${id} ... `);
    const r = await processOne(gmail, config, id, doApply);
    results.push(r);
    console.log(r.error ? "FAIL" : r.applied ? (r.verified ? "OK" : "APPLIED") : "OK");
  }

  console.log("\n--- Per-message ---");
  results.forEach((r, i) => printResult(r, i));

  const withError = results.filter((r) => r.error);
  const applied = results.filter((r) => r.applied);
  const verified = results.filter((r) => r.verified);

  console.log("\n--- Summary ---");
  console.log(`  total:    ${results.length}`);
  console.log(`  applied:  ${applied.length}`);
  console.log(`  verified: ${verified.length} (of applied)`);
  console.log(`  failed:   ${withError.length}`);

  const ok = results.filter((r) => !r.error);
  if (ok.length > 0) {
    const catConfs = ok.map((r) => r.categoryConfidence).filter((c) => c != null);
    const subConfs = ok.map((r) => r.subcategoryConfidence).filter((c) => c != null);
    const minCat = config.routing_thresholds.minCategoryConfidence;
    const minSub = config.routing_thresholds.minSubcategoryConfidence;
    const belowCat = catConfs.filter((c) => c < minCat).length;
    const belowSub = subConfs.filter((c) => c < minSub).length;
    console.log(`  confidence: category [min threshold=${minCat}] below: ${belowCat}/${catConfs.length}, subcategory [min threshold=${minSub}] below: ${belowSub}/${subConfs.length}`);
    if (catConfs.length) {
      const avgCat = (catConfs.reduce((a, b) => a + b, 0) / catConfs.length).toFixed(2);
      const avgSub = subConfs.length ? (subConfs.reduce((a, b) => a + b, 0) / subConfs.length).toFixed(2) : "—";
      console.log(`  confidence: category avg=${avgCat}, subcategory avg=${avgSub}`);
    }
  }

  if (withError.length > 0) {
    console.log("\n  Errors:");
    withError.forEach((r) => console.log(`    ${r.messageId}: ${r.error}`));
  }

  const labelCounts = {};
  results.forEach((r) => {
    const L = r.resolvedLabel ?? "—";
    labelCounts[L] = (labelCounts[L] || 0) + 1;
  });
  console.log("\n  Labels used:");
  Object.entries(labelCounts)
    .sort((a, b) => b[1] - a[1])
    .forEach(([label, n]) => console.log(`    ${label}: ${n}`));

  if (histogram) {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const outPath = path.join(process.cwd(), "confidence-histogram.html");
    const html = buildHistogramHtml(results.filter((r) => !r.error), config.routing_thresholds);
    fs.writeFileSync(outPath, html, "utf-8");
    console.log(`\n  Histogram: ${outPath}`);
  }

  console.log("\nDone.");
  process.exit(withError.length > 0 ? 1 : 0);
}

function buildHistogramHtml(results, routing_thresholds) {
  const minCat = routing_thresholds.minCategoryConfidence ?? 0.7;
  const minSub = routing_thresholds.minSubcategoryConfidence ?? 0.6;
  const catConfs = results.map((r) => r.categoryConfidence).filter((c) => c != null);
  const subConfs = results.map((r) => r.subcategoryConfidence).filter((c) => c != null);

  const bins = 20;
  const step = 1 / bins;
  const toBin = (v) => Math.min(bins - 1, Math.floor(v / step));
  const catCounts = Array(bins).fill(0);
  catConfs.forEach((c) => { catCounts[toBin(c)]++; });
  const subCounts = Array(bins).fill(0);
  subConfs.forEach((c) => { subCounts[toBin(c)]++; });
  const barCenters = Array.from({ length: bins }, (_, i) => (i + 0.5) * step);

  const catBars = barCenters.map((x, i) => ({ x, y: catCounts[i] }));
  const subBars = barCenters.map((x, i) => ({ x, y: subCounts[i] }));

  const maxCatY = Math.max(1, ...catCounts);
  const maxSubY = Math.max(1, ...subCounts);
  const catLine = [{ x: minCat, y: 0 }, { x: minCat, y: maxCatY }];
  const subLine = [{ x: minSub, y: 0 }, { x: minSub, y: maxSubY }];

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Confidence scores</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>
  <style>body{font-family:sans-serif;margin:1rem;} h1{font-size:1.1rem;} .chart{max-width:640px;height:300px;margin:1rem 0;}</style>
</head>
<body>
  <h1>Category confidence (red line = min threshold ${minCat})</h1>
  <div class="chart"><canvas id="catChart"></canvas></div>
  <h1>Subcategory confidence (red line = min threshold ${minSub})</h1>
  <div class="chart"><canvas id="subChart"></canvas></div>
  <script>
    const catBars = ${JSON.stringify(catBars)};
    const subBars = ${JSON.stringify(subBars)};
    const catLine = ${JSON.stringify(catLine)};
    const subLine = ${JSON.stringify(subLine)};
    const barOpt = { borderWidth: 1, borderColor: "rgba(54,162,235,0.8)", backgroundColor: "rgba(54,162,235,0.4)", barPercentage: 0.9, categoryPercentage: 1 };
    const lineOpt = { type: "line", borderColor: "red", borderWidth: 2, fill: false, pointRadius: 0, data: null };
    function makeChart(id, barData, lineData) {
      new Chart(document.getElementById(id), {
        type: "bar",
        data: {
          datasets: [
            { ...barOpt, data: barData },
            { ...lineOpt, data: lineData }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: {
            x: { type: "linear", min: 0, max: 1, title: { display: true, text: "confidence" } },
            y: { beginAtZero: true, title: { display: true, text: "count" } }
          },
          plugins: { legend: { display: false } }
        }
      });
    }
    makeChart("catChart", catBars, catLine);
    makeChart("subChart", subBars, subLine);
  </script>
</body>
</html>`;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
