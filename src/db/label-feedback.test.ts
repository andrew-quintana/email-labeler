import { describe, it, expect } from "vitest";
import { buildGmailIdToLabelMap, resolveUserLabel } from "./label-feedback.js";

describe("buildGmailIdToLabelMap", () => {
  it("maps Gmail label IDs to emoji-prefixed label names", () => {
    const leafRules = [
      {
        name: "💼-work-projects",
        actions: [{ type: "addLabels", labelIds: ["Label_1"] }],
      },
      {
        name: "💰-finance-banking",
        actions: [{ type: "addLabels", labelIds: ["Label_2"] }],
      },
    ];
    const map = buildGmailIdToLabelMap(leafRules);
    expect(map.get("Label_1")).toBe("💼-work-projects");
    expect(map.get("Label_2")).toBe("💰-finance-banking");
    expect(map.get("Label_999")).toBeUndefined();
  });

  it("maps Gmail label IDs to plain label names (no emojis)", () => {
    const leafRules = [
      {
        name: "work-projects",
        actions: [{ type: "addLabels", labelIds: ["Label_10"] }],
      },
      {
        name: "finance-banking",
        actions: [{ type: "addLabels", labelIds: ["Label_20"] }],
      },
    ];
    const map = buildGmailIdToLabelMap(leafRules);
    expect(map.get("Label_10")).toBe("work-projects");
    expect(map.get("Label_20")).toBe("finance-banking");
  });
});

describe("resolveUserLabel", () => {
  const map = new Map([
    ["Label_1", "💼-work-projects"],
    ["Label_2", "💰-finance-banking"],
    ["Label_3", "📰-newsletters-tech"],
  ]);

  it("returns the label when exactly one known label is present", () => {
    const result = resolveUserLabel(
      ["INBOX", "UNREAD", "Label_1"],
      map
    );
    expect(result).toBe("💼-work-projects");
  });

  it("returns null when no known label is present", () => {
    const result = resolveUserLabel(["INBOX", "UNREAD"], map);
    expect(result).toBeNull();
  });

  it("returns null when multiple known labels are present (ambiguous)", () => {
    const result = resolveUserLabel(
      ["Label_1", "Label_2"],
      map
    );
    expect(result).toBeNull();
  });
});
