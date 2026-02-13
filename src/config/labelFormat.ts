/**
 * Category → emoji mapping. Controls the label format throughout the pipeline.
 *
 * - **With emojis**: Set each category to an emoji string (e.g. "💼").
 *   Resolved labels look like "💼-work-projects".
 * - **Without emojis**: Set every value to "" (empty string).
 *   Resolved labels look like "work-projects".
 * - **Mixed**: Some categories with emojis, others without — both work fine.
 *
 * CUSTOMIZE: Update this map when you change your categories.
 * Run the setup prompt (SETUP_PROMPT.md) to regenerate from your taxonomy.
 */
export const CATEGORY_EMOJI: Record<string, string> = {
  work: "💼",
  personal: "👤",
  finance: "💰",
  shopping: "🛒",
  notifications: "🔔",
  newsletters: "📰",
  other: "",
};

/**
 * Build the resolved Gmail label name from category + subcategory.
 *
 * Format depends on whether the category has an emoji in CATEGORY_EMOJI:
 *   - emoji present  → "emoji-category-subcategory" (e.g. "💼-work-projects")
 *   - emoji absent   → "category-subcategory" (e.g. "work-projects")
 */
export function buildResolvedLabel(category: string, subcategory: string): string {
  const emoji = CATEGORY_EMOJI[category] ?? "";
  if (emoji) {
    return `${emoji}-${category}-${subcategory}`;
  }
  return `${category}-${subcategory}`;
}

/**
 * Parse a label string back into {category, subcategory}.
 *
 * Handles both emoji-prefixed ("💼-work-projects") and plain ("work-projects")
 * label formats. Uses the CATEGORY_EMOJI map and a known categories list for
 * robust parsing regardless of which format is in use.
 *
 * @param label       - The label string to parse
 * @param categories  - Optional list of known category names for disambiguation.
 *                      When provided, plain labels like "work-projects" are matched
 *                      against this list instead of splitting on the first dash.
 */
export function parseLabelComponents(
  label: string,
  categories?: string[]
): { category: string; subcategory: string } {
  // Special cases
  if (label === "other") return { category: "other", subcategory: "other" };
  if (label === "Review") return { category: "other", subcategory: "other" };

  // Try emoji-prefixed format: "emoji-category-subcategory"
  const emojiCategories = Object.entries(CATEGORY_EMOJI).filter(([, e]) => e !== "");
  for (const [cat, emoji] of emojiCategories) {
    const prefix = `${emoji}-${cat}-`;
    if (label.startsWith(prefix)) {
      return { category: cat, subcategory: label.slice(prefix.length) };
    }
  }

  // Try plain format: "category-subcategory" using known categories
  const knownCats = categories ?? Object.keys(CATEGORY_EMOJI);
  // Sort longest-first so "side-projects" matches before "side"
  const sorted = [...knownCats].sort((a, b) => b.length - a.length);
  for (const cat of sorted) {
    const prefix = `${cat}-`;
    if (label.startsWith(prefix) && label.length > prefix.length) {
      return { category: cat, subcategory: label.slice(prefix.length) };
    }
  }

  // Last resort: split on first dash
  const dash = label.indexOf("-");
  if (dash > 0) {
    return { category: label.slice(0, dash), subcategory: label.slice(dash + 1) };
  }
  return { category: label, subcategory: "other" };
}
