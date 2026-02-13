import { describe, it, expect } from "vitest";
import { resolveLabelAndArchive } from "./apply.js";
import type { EmailLabelingStateType } from "./state.js";

/** Config with emoji-prefixed labels (default). */
const baseConfig = {
  categories: [],
  subcategories: {},
  actions: [],
  routing_thresholds: {
    minCategoryConfidence: 0.7,
    minSubcategoryConfidence: 0.6,
    fallbackLabel: "Review",
    archiveRequiresConfidenceAbove: 0.85,
    defaultArchive: false,
  },
  gmail_labels: {
    labelPrefix: "",
    needsReviewLabel: "Review",
  },
  rules: { rules: [] },
  archive_labels: [
    "🛒-shopping-deals",
    "📰-newsletters-tech",
  ],
  non_archiving_labels: [],
  labels: [],
  leaf_rules: [],
};

/** Config with plain labels (no emojis). */
const noEmojiConfig = {
  ...baseConfig,
  archive_labels: [
    "shopping-deals",
    "newsletters-tech",
  ],
};

function makeState(overrides: Partial<EmailLabelingStateType>): EmailLabelingStateType {
  return {
    email: {} as EmailLabelingStateType["email"],
    summary: null,
    label: null,
    labels: null,
    routerWeights: null,
    headWeights: null,
    finalScores: null,
    labelConfidence: 0,
    category: null,
    categoryConfidence: 0,
    categoryReason: null,
    subcategory: null,
    subcategoryConfidence: 0,
    subcategoryReason: null,
    error: null,
    ...overrides,
  };
}

describe("resolveLabelAndArchive", () => {
  it("returns fallback on error", () => {
    const state = makeState({ error: "some error" });
    const result = resolveLabelAndArchive(state, baseConfig);
    expect(result.labelName).toBe("Review");
    expect(result.labelNames).toEqual(["Review"]);
    expect(result.archive).toBe(false);
  });

  it("uses label from label router with sufficient confidence", () => {
    const state = makeState({
      label: "🛒-shopping-deals",
      labels: ["🛒-shopping-deals"],
      labelConfidence: 0.85,
    });
    const result = resolveLabelAndArchive(state, baseConfig);
    expect(result.labelName).toBe("🛒-shopping-deals");
    expect(result.labelNames).toEqual(["🛒-shopping-deals"]);
    expect(result.archive).toBe(true);
  });

  it("uses fallback when label router confidence is below threshold", () => {
    const state = makeState({
      label: "🛒-shopping-deals",
      labels: ["🛒-shopping-deals"],
      labelConfidence: 0.3,
    });
    const result = resolveLabelAndArchive(state, baseConfig);
    expect(result.labelName).toBe("Review");
    expect(result.labelNames).toEqual(["Review"]);
    expect(result.archive).toBe(false);
  });

  it("does not archive non-archive labels", () => {
    const state = makeState({
      label: "💼-work-projects",
      labels: ["💼-work-projects"],
      labelConfidence: 0.9,
    });
    const result = resolveLabelAndArchive(state, baseConfig);
    expect(result.labelName).toBe("💼-work-projects");
    expect(result.labelNames).toEqual(["💼-work-projects"]);
    expect(result.archive).toBe(false);
  });

  it("archives labels in archive_labels list", () => {
    const state = makeState({
      label: "📰-newsletters-tech",
      labels: ["📰-newsletters-tech"],
      labelConfidence: 0.9,
    });
    const result = resolveLabelAndArchive(state, baseConfig);
    expect(result.labelName).toBe("📰-newsletters-tech");
    expect(result.labelNames).toEqual(["📰-newsletters-tech"]);
    expect(result.archive).toBe(true);
  });

  it("allows Review label even with low confidence", () => {
    const state = makeState({
      label: "Review",
      labels: ["Review"],
      labelConfidence: 0.2,
    });
    const result = resolveLabelAndArchive(state, baseConfig);
    expect(result.labelName).toBe("Review");
    expect(result.labelNames).toEqual(["Review"]);
    expect(result.archive).toBe(false);
  });

  it("returns multiple labels when state.labels has more than one", () => {
    const state = makeState({
      label: "🛒-shopping-deals",
      labels: ["🛒-shopping-deals", "🛒-shopping-orders"],
      labelConfidence: 0.85,
    });
    const result = resolveLabelAndArchive(state, baseConfig);
    expect(result.labelName).toBe("🛒-shopping-deals");
    expect(result.labelNames).toEqual(["🛒-shopping-deals", "🛒-shopping-orders"]);
    expect(result.archive).toBe(true);
  });
});

describe("resolveLabelAndArchive (no emojis)", () => {
  it("applies plain labels with archive", () => {
    const state = makeState({
      label: "shopping-deals",
      labels: ["shopping-deals"],
      labelConfidence: 0.9,
    });
    const result = resolveLabelAndArchive(state, noEmojiConfig);
    expect(result.labelName).toBe("shopping-deals");
    expect(result.archive).toBe(true);
  });

  it("does not archive plain labels not in archive list", () => {
    const state = makeState({
      label: "work-projects",
      labels: ["work-projects"],
      labelConfidence: 0.9,
    });
    const result = resolveLabelAndArchive(state, noEmojiConfig);
    expect(result.labelName).toBe("work-projects");
    expect(result.archive).toBe(false);
  });

  it("still uses Review fallback on low confidence", () => {
    const state = makeState({
      label: "shopping-deals",
      labels: ["shopping-deals"],
      labelConfidence: 0.3,
    });
    const result = resolveLabelAndArchive(state, noEmojiConfig);
    expect(result.labelName).toBe("Review");
    expect(result.archive).toBe(false);
  });
});
