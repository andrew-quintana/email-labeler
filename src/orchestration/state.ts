import { Annotation } from "@langchain/langgraph";
import type { NormalizedEmail } from "../email/parse.js";
import type { SummaryOutput } from "../types/pipeline.js";

/** Replace semantics: take the update (right) as new value. */
const replace = <T>(_: T, right: T): T => right;

/**
 * Graph state for the email labeling pipeline.
 * Each node returns a partial update; LangGraph merges into shared state.
 */
export const EmailLabelingState = Annotation.Root({
  email: Annotation<NormalizedEmail>({
    reducer: replace,
    default: () => ({} as NormalizedEmail),
  }),
  summary: Annotation<SummaryOutput | null>({
    reducer: replace,
    default: () => null,
  }),
  /** Single resolved label from the label router (replaces category/subcategory). */
  label: Annotation<string | null>({
    reducer: replace,
    default: () => null,
  }),
  /** All labels to apply (≥1 when router succeeds). Primary is first; others are "relevant enough". */
  labels: Annotation<string[] | null>({
    reducer: replace,
    default: () => null,
  }),
  /** Router content-based weights (0-100) per label. */
  routerWeights: Annotation<number[] | null>({
    reducer: replace,
    default: () => null,
  }),
  /** NN head weights (0-1) per label. */
  headWeights: Annotation<number[] | null>({
    reducer: replace,
    default: () => null,
  }),
  /** Final scores = routerWeight * headWeight per label. */
  finalScores: Annotation<number[] | null>({
    reducer: replace,
    default: () => null,
  }),
  /** Confidence of the chosen label (max final score / 100). */
  labelConfidence: Annotation<number>({
    reducer: replace,
    default: () => 0,
  }),
  // Keep legacy fields for backward compat during transition
  category: Annotation<string | null>({
    reducer: replace,
    default: () => null,
  }),
  categoryConfidence: Annotation<number>({
    reducer: replace,
    default: () => 0,
  }),
  categoryReason: Annotation<string | null>({
    reducer: replace,
    default: () => null,
  }),
  subcategory: Annotation<string | null>({
    reducer: replace,
    default: () => null,
  }),
  subcategoryConfidence: Annotation<number>({
    reducer: replace,
    default: () => 0,
  }),
  subcategoryReason: Annotation<string | null>({
    reducer: replace,
    default: () => null,
  }),
  error: Annotation<string | null>({
    reducer: replace,
    default: () => null,
  }),
});

export type EmailLabelingStateType = typeof EmailLabelingState.State;
