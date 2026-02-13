import type { EmailLabelingStateType } from "./state.js";
import type { loadAndValidateAll } from "../config/loader.js";
import { buildResolvedLabel } from "../config/labelFormat.js";

type Config = ReturnType<typeof loadAndValidateAll>;

export interface LabelDecision {
  /** Primary label (first in list); used for archive decision and DB. */
  labelName: string;
  /** All labels to apply (≥1). Primary first. */
  labelNames: string[];
  archive: boolean;
}

/**
 * Resolve which label to apply and whether to archive from graph state and config.
 * Uses the label_router output (state.label) when available; falls back to
 * category/subcategory for backward compat. Uses Review when confidence is low.
 */
export function resolveLabelAndArchive(
  state: EmailLabelingStateType,
  config: Config
): LabelDecision {
  const { routing_thresholds } = config;
  const fallbackLabel = routing_thresholds.fallbackLabel;

  if (state.error) {
    return { labelName: fallbackLabel, labelNames: [fallbackLabel], archive: false };
  }

  // Use label router output if available (single label or multi-label list)
  const label = state.label;
  const labelList = state.labels?.length ? state.labels : (label ? [label] : []);
  if (labelList.length > 0) {
    const primary = labelList[0];
    // Confidence check: use labelConfidence or fall back to legacy confidence fields
    const confidence = state.labelConfidence
      ?? Math.min(state.categoryConfidence ?? 0, state.subcategoryConfidence ?? 0);

    // Use fallback if confidence is below both legacy thresholds
    const minCat = routing_thresholds.minCategoryConfidence;
    const minSub = routing_thresholds.minSubcategoryConfidence;
    const minConfidence = Math.min(minCat, minSub);

    if (confidence < minConfidence && primary !== fallbackLabel) {
      return { labelName: fallbackLabel, labelNames: [fallbackLabel], archive: false };
    }

    const archiveLabelSet = new Set(config.archive_labels ?? []);
    const nonArchivingSet = new Set(config.non_archiving_labels ?? []);
    const shouldArchive = archiveLabelSet.has(primary) && !nonArchivingSet.has(primary);
    return { labelName: primary, labelNames: labelList, archive: shouldArchive };
  }

  // Legacy path: category/subcategory (backward compat)
  const category = state.category ?? "other";
  const subcategory = state.subcategory ?? "other";
  const defaultLabel = buildResolvedLabel(category, subcategory);

  const catConf = state.categoryConfidence ?? 0;
  const subConf = state.subcategoryConfidence ?? 0;
  const minCat = routing_thresholds.minCategoryConfidence;
  const minSub = routing_thresholds.minSubcategoryConfidence;

  if (catConf < minCat && subConf < minSub) {
    return { labelName: fallbackLabel, labelNames: [fallbackLabel], archive: false };
  }

  const archiveLabelSet = new Set(config.archive_labels ?? []);
  const nonArchivingSet = new Set(config.non_archiving_labels ?? []);
  const shouldArchive = archiveLabelSet.has(defaultLabel) && !nonArchivingSet.has(defaultLabel);
  return { labelName: defaultLabel, labelNames: [defaultLabel], archive: shouldArchive };
}
