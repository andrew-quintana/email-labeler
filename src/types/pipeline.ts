/** Output of the summarizer (Anthropic); must match prompts/summarizer.md schema. */
export interface SummaryOutput {
  summary: string;
  key_points: string[];
  entities: string[];
  suggested_labels: string[];
  urgency: "low" | "normal" | "high" | "urgent";
}

/** Output of category router (Gemini). */
export interface CategoryOutput {
  category: string;
  confidence: number;
  reason: string;
}

/** Output of subcategory router (Gemini). */
export interface SubcategoryOutput {
  subcategory: string;
  confidence: number;
  reason: string;
}
