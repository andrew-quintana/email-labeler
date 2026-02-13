import { describe, it, expect } from "vitest";
import { buildResolvedLabel, parseLabelComponents } from "./labelFormat.js";

describe("buildResolvedLabel", () => {
  it("prefixes with emoji when category has one", () => {
    expect(buildResolvedLabel("work", "projects")).toBe("💼-work-projects");
    expect(buildResolvedLabel("finance", "banking")).toBe("💰-finance-banking");
  });

  it("returns plain format when category has no emoji", () => {
    expect(buildResolvedLabel("other", "other")).toBe("other-other");
  });

  it("returns plain format for unknown categories", () => {
    expect(buildResolvedLabel("custom", "stuff")).toBe("custom-stuff");
  });
});

describe("parseLabelComponents", () => {
  const categories = ["work", "personal", "finance", "shopping", "notifications", "newsletters", "other"];

  // Emoji-prefixed labels
  it("parses emoji-prefixed labels", () => {
    expect(parseLabelComponents("💼-work-projects", categories))
      .toEqual({ category: "work", subcategory: "projects" });
    expect(parseLabelComponents("💰-finance-banking", categories))
      .toEqual({ category: "finance", subcategory: "banking" });
  });

  // Plain labels (no emoji)
  it("parses plain labels when given categories list", () => {
    expect(parseLabelComponents("work-projects", categories))
      .toEqual({ category: "work", subcategory: "projects" });
    expect(parseLabelComponents("finance-banking", categories))
      .toEqual({ category: "finance", subcategory: "banking" });
  });

  it("parses multi-word subcategories correctly", () => {
    expect(parseLabelComponents("notifications-account-alerts", categories))
      .toEqual({ category: "notifications", subcategory: "account-alerts" });
    expect(parseLabelComponents("🔔-notifications-account-alerts", categories))
      .toEqual({ category: "notifications", subcategory: "account-alerts" });
  });

  // Special labels
  it("handles special labels", () => {
    expect(parseLabelComponents("other")).toEqual({ category: "other", subcategory: "other" });
    expect(parseLabelComponents("Review")).toEqual({ category: "other", subcategory: "other" });
  });

  // Fallback without known categories
  it("falls back to first-dash split without categories list", () => {
    expect(parseLabelComponents("foo-bar")).toEqual({ category: "foo", subcategory: "bar" });
    expect(parseLabelComponents("nodash")).toEqual({ category: "nodash", subcategory: "other" });
  });
});
