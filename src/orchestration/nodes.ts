import { logger } from "@trigger.dev/sdk/v3";
import type { EmailLabelingStateType } from "./state.js";
import { loadPrompt, loadAndValidateAll } from "../config/loader.js";
import { parseLabelComponents } from "../config/labelFormat.js";
import { summarize as anthropicSummarize } from "../providers/anthropic.js";
import { classifyLabel } from "../providers/gemini.js";
import { inferLabelRouterHead } from "../ml/label-router-inference.js";

const NODE_SUMMARIZE = "summarize";
const NODE_LABEL_ROUTER = "label_router";

/**
 * Label descriptions for the label router prompt.
 *
 * Keys must exactly match the label names in config/labels.json.
 * Works with both emoji-prefixed labels ("💼-work-projects") and plain
 * labels ("work-projects") — just keep keys in sync with your labels.json.
 *
 * CUSTOMIZE: Update these descriptions to match your label taxonomy.
 * Run the setup prompt (SETUP_PROMPT.md) to regenerate from your taxonomy.
 */
const LABEL_DESCRIPTIONS: Record<string, string> = {
  // --- System labels (always present) ---
  "Review": "Emails that need manual review (low confidence or unclear).",
  "other": "Emails not captured by any other label.",

  // --- Work ---
  "💼-work-projects":
    "Emails about work projects, tasks, deliverables, or project status updates.",
  "💼-work-meetings":
    "Meeting invitations, calendar updates, agenda items, or meeting notes.",
  "💼-work-deadlines":
    "Deadline reminders, due date notifications, or time-sensitive work items.",
  "💼-work-collaboration":
    "Team communication, shared documents, code reviews, or collaborative work.",

  // --- Personal ---
  "👤-personal-family":
    "Emails from or about family members, family plans, or family matters.",
  "👤-personal-friends":
    "Emails from friends, social plans, or personal correspondence.",
  "👤-personal-events":
    "Invitations or RSVPs for personal social events, meetups, or gatherings.",
  "👤-personal-travel":
    "Personal trips, itineraries, flight/hotel confirmations, or travel plans.",
  "👤-personal-health":
    "Health appointments, prescriptions, provider messages, or wellness reminders.",

  // --- Finance ---
  "💰-finance-banking":
    "Bank statements, balance notifications, or account access alerts.",
  "💰-finance-bills":
    "Utility bills, credit card due notices, or recurring payment invoices.",
  "💰-finance-income":
    "Pay stubs, deposit notices, or freelance/salary payment confirmations.",
  "💰-finance-subscriptions":
    "Subscription renewals, expiring plans, or automatic charge warnings.",
  "💰-finance-investments":
    "Investment account updates, portfolio changes, or market alerts.",

  // --- Shopping ---
  "🛒-shopping-orders":
    "Order confirmations, purchase receipts, or new order notifications.",
  "🛒-shopping-shipping":
    "Shipping notifications, delivery tracking, or package updates.",
  "🛒-shopping-deals":
    "Sales promotions, coupon codes, limited-time offers, or discount announcements.",
  "🛒-shopping-returns":
    "Return confirmations, refund status, or exchange notifications.",

  // --- Notifications ---
  "🔔-notifications-account-alerts":
    "Security alerts, password resets, or account activity notifications.",
  "🔔-notifications-social-media":
    "Social media notifications, mentions, likes, or follower updates.",
  "🔔-notifications-app-updates":
    "App update notices, new feature announcements, or service notifications.",

  // --- Newsletters ---
  "📰-newsletters-tech":
    "Technology newsletters, dev blogs, programming digests, or tech news.",
  "📰-newsletters-news":
    "General news digests, current events, or news briefings.",
  "📰-newsletters-industry":
    "Industry-specific newsletters, professional updates, or market reports.",

  // ------------------------------------------------------------------
  // NO-EMOJI EQUIVALENTS (for setups that opt out of emojis).
  // When your labels.json uses plain labels, these keys will match.
  // You only need one set — whichever matches your labels.json.
  // Both are provided so the defaults work regardless of emoji choice.
  // ------------------------------------------------------------------
  "work-projects":
    "Emails about work projects, tasks, deliverables, or project status updates.",
  "work-meetings":
    "Meeting invitations, calendar updates, agenda items, or meeting notes.",
  "work-deadlines":
    "Deadline reminders, due date notifications, or time-sensitive work items.",
  "work-collaboration":
    "Team communication, shared documents, code reviews, or collaborative work.",
  "personal-family":
    "Emails from or about family members, family plans, or family matters.",
  "personal-friends":
    "Emails from friends, social plans, or personal correspondence.",
  "personal-events":
    "Invitations or RSVPs for personal social events, meetups, or gatherings.",
  "personal-travel":
    "Personal trips, itineraries, flight/hotel confirmations, or travel plans.",
  "personal-health":
    "Health appointments, prescriptions, provider messages, or wellness reminders.",
  "finance-banking":
    "Bank statements, balance notifications, or account access alerts.",
  "finance-bills":
    "Utility bills, credit card due notices, or recurring payment invoices.",
  "finance-income":
    "Pay stubs, deposit notices, or freelance/salary payment confirmations.",
  "finance-subscriptions":
    "Subscription renewals, expiring plans, or automatic charge warnings.",
  "finance-investments":
    "Investment account updates, portfolio changes, or market alerts.",
  "shopping-orders":
    "Order confirmations, purchase receipts, or new order notifications.",
  "shopping-shipping":
    "Shipping notifications, delivery tracking, or package updates.",
  "shopping-deals":
    "Sales promotions, coupon codes, limited-time offers, or discount announcements.",
  "shopping-returns":
    "Return confirmations, refund status, or exchange notifications.",
  "notifications-account-alerts":
    "Security alerts, password resets, or account activity notifications.",
  "notifications-social-media":
    "Social media notifications, mentions, likes, or follower updates.",
  "notifications-app-updates":
    "App update notices, new feature announcements, or service notifications.",
  "newsletters-tech":
    "Technology newsletters, dev blogs, programming digests, or tech news.",
  "newsletters-news":
    "General news digests, current events, or news briefings.",
  "newsletters-industry":
    "Industry-specific newsletters, professional updates, or market reports.",
};

function interpolate(template: string, vars: Record<string, string>): string {
  let out = template;
  for (const [k, v] of Object.entries(vars)) {
    out = out.replace(new RegExp(`{{${k}}}`, "g"), v);
  }
  return out;
}

/** Node: summarize email with Anthropic (template from prompts/summarizer.md). */
export async function summarizeNode(
  state: EmailLabelingStateType
): Promise<Partial<EmailLabelingStateType>> {
  const email = state.email;
  const subject = email?.subject?.slice(0, 80) ?? "";
  if (!email?.bodyText && !email?.snippet) {
    logger.warn("Pipeline node failed", {
      node: NODE_SUMMARIZE,
      subject,
      error: "No email body or snippet",
    });
    return { error: "No email body or snippet" };
  }
  const template = loadPrompt("summarizer.md");
  const body = (email.bodyText || email.snippet || "").slice(0, 20_000);
  const prompt = interpolate(template, {
    from: email.from ?? "",
    to: email.to ?? "",
    subject: email.subject ?? "",
    date: email.date ?? "",
    body,
  });
  try {
    const summary = await anthropicSummarize(prompt);
    return {
      summary,
      error: null,
    };
  } catch (e) {
    const err = e as Error & { status?: number; code?: string };
    const errMsg = err.message;
    logger.error("Pipeline node failed", {
      node: NODE_SUMMARIZE,
      subject,
      errorMessage: errMsg,
      errorName: err.name,
      status: err.status ?? null,
      code: err.code ?? null,
      stack: err.stack?.slice(0, 500) ?? null,
    });
    return {
      error: errMsg,
    };
  }
}

/**
 * Node: Single label router — replaces category_router + subcategory_router.
 * Two-part scoring: router weights (0-100) from Gemini × NN head weights (0-1).
 * Final score = router_weight × nn_head_weight; label = argmax.
 */
export async function labelRouterNode(
  state: EmailLabelingStateType
): Promise<Partial<EmailLabelingStateType>> {
  const subject = state.email?.subject?.slice(0, 80) ?? "";
  const config = loadAndValidateAll();
  const labels = config.labels;

  if (!labels || labels.length === 0) {
    logger.warn("Pipeline node failed", {
      node: NODE_LABEL_ROUTER,
      subject,
      error: "No labels configured in config/labels.json",
    });
    return { error: "No labels configured" };
  }

  const summary = state.summary;

  // Build label descriptions for prompt — works with any label format
  const labelsWithDescriptions = labels
    .map((l) => `${l}\n→ ${LABEL_DESCRIPTIONS[l] ?? "See label name."}`)
    .join("\n\n");
  const labelsList = labels.join(", ");

  const template = loadPrompt("label_router.md");
  const prompt = interpolate(template, {
    labels_with_descriptions: labelsWithDescriptions,
    labels_list: labelsList,
    summary: summary?.summary ?? "",
    key_points: Array.isArray(summary?.key_points) ? summary.key_points.join("; ") : "",
    subject: state.email?.subject ?? "",
  });

  try {
    // Step 1: Get router weights (0-100) from Gemini
    const result = await classifyLabel(prompt, labels);
    const routerWeights = labels.map((l) => result.weights[l] ?? 0);

    // Step 2: Get NN head weights (0-1) from trained artifact
    let headWeights: number[];
    const summaryText = summary?.summary ?? "";
    let headResult: Awaited<ReturnType<typeof inferLabelRouterHead>> = null;

    if (summaryText) {
      try {
        headResult = await inferLabelRouterHead(summaryText);
      } catch (headErr) {
        logger.warn("Label router head inference failed (non-fatal, using cold start)", {
          node: NODE_LABEL_ROUTER,
          error: headErr instanceof Error ? headErr.message : String(headErr),
        });
      }
    }

    if (headResult) {
      headWeights = labels.map((l) => headResult!.headWeights[l] ?? 1.0);
      logger.info("Label router classifier head output", {
        node: NODE_LABEL_ROUTER,
        subject,
        headWeights: headResult.headWeights,
        labelList: headResult.labelList,
      });
    } else {
      // Cold start: all head weights = 1.0 → final score = router weight
      headWeights = labels.map(() => 1.0);
      logger.info("Label router classifier head: cold start (no artifact)", {
        node: NODE_LABEL_ROUTER,
        subject,
      });
    }

    // Step 3: Final scores = router_weight × nn_head_weight
    const finalScores = routerWeights.map((rw, i) => rw * headWeights[i]);

    // Step 4: Primary = argmax (always at least one label)
    let maxIdx = 0;
    let maxScore = finalScores[0];
    for (let i = 1; i < finalScores.length; i++) {
      if (finalScores[i] > maxScore) {
        maxScore = finalScores[i];
        maxIdx = i;
      }
    }
    const chosenLabel = labels[maxIdx];
    const confidence = maxScore / 100; // normalize to [0, 1]

    // Step 5: Include extra labels when relevant enough (multi-label)
    const rt = config.routing_thresholds;
    const ratio = rt.multiLabelRatioOfMax ?? 0.6;
    const minScore = rt.multiLabelMinScore ?? 25;
    const threshold =
      ratio > 0 ? Math.max(minScore, ratio * maxScore) : maxScore + 1;
    const primaryIdx = maxIdx;
    const indicesByScore = finalScores
      .map((score, i) => ({ i, score }))
      .filter(({ score }) => score >= threshold)
      .sort((a, b) => b.score - a.score);
    // Dedupe: primary first, then others in score order (no duplicate indices)
    const seen = new Set<number>([primaryIdx]);
    const chosenIndices = [primaryIdx];
    for (const { i } of indicesByScore) {
      if (!seen.has(i)) {
        seen.add(i);
        chosenIndices.push(i);
      }
    }
    const chosenLabels = chosenIndices.map((i) => labels[i]);

    // Log scoring details for observability: head only → router only → combined
    const scoredLabels = labels
      .map((l, i) => ({ label: l, router: routerWeights[i], head: headWeights[i], final: finalScores[i] }));
    const top5ByHead = [...scoredLabels]
      .sort((a, b) => b.head - a.head)
      .slice(0, 5)
      .map((s) => `${s.label}: ${s.head.toFixed(2)}`);
    const top5ByRouter = [...scoredLabels]
      .sort((a, b) => b.router - a.router)
      .slice(0, 5)
      .map((s) => `${s.label}: ${s.router}`);
    const top5ByCombined = [...scoredLabels]
      .sort((a, b) => b.final - a.final)
      .slice(0, 5)
      .map((s) => `${s.label}: r=${s.router} h=${s.head.toFixed(2)} f=${s.final.toFixed(1)}`);
    logger.info("Label router scoring", {
      node: NODE_LABEL_ROUTER,
      subject,
      chosenLabel,
      chosenLabels,
      confidence,
      headSource: headResult ? "model" : "cold_start",
      top5Head: top5ByHead,
      top5Router: top5ByRouter,
      top5Combined: top5ByCombined,
    });

    // Extract category/subcategory from label for backward compat
    const { category, subcategory } = parseLabelComponents(chosenLabel, config.categories);

    return {
      label: chosenLabel,
      labels: chosenLabels,
      routerWeights,
      headWeights,
      finalScores,
      labelConfidence: confidence,
      // Backward compat
      category,
      categoryConfidence: result.confidence,
      categoryReason: result.reason,
      subcategory,
      subcategoryConfidence: result.confidence,
      subcategoryReason: result.reason,
      error: null,
    };
  } catch (e) {
    const errMsg = (e as Error).message;
    logger.warn("Pipeline node failed", {
      node: NODE_LABEL_ROUTER,
      subject,
      error: errMsg,
    });
    return {
      error: errMsg,
    };
  }
}
