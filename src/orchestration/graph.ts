import { logger } from "@trigger.dev/sdk/v3";
import { StateGraph, START, END } from "@langchain/langgraph";
import { EmailLabelingState } from "./state.js";
import { summarizeNode, labelRouterNode } from "./nodes.js";
import type { NormalizedEmail } from "../email/parse.js";
import type { EmailLabelingStateType } from "./state.js";

/**
 * Compiled LangGraph for the email labeling pipeline:
 *   START → summarize → label_router → END
 *
 * State is updated at each node; final state contains summary, label,
 * router weights, head weights, and final scores for use by the apply logic.
 */
const graphBuilder = new StateGraph(EmailLabelingState)
  .addNode("summarize", summarizeNode)
  .addNode("label_router", labelRouterNode)
  .addEdge(START, "summarize")
  .addEdge("summarize", "label_router")
  .addEdge("label_router", END);

export const emailLabelingGraph = graphBuilder.compile();

/**
 * Run the pipeline for a normalized email. Returns final state with summary and label.
 */
export async function runEmailLabelingGraph(
  email: NormalizedEmail
): Promise<EmailLabelingStateType> {
  const result = await emailLabelingGraph.invoke({
    email: email as EmailLabelingStateType["email"],
  });
  const state = result as EmailLabelingStateType;
  if (state.error) {
    const subject = email.subject?.slice(0, 80) ?? "";
    logger.warn("Pipeline run failed", {
      trace: "email_labeling",
      subject,
      messageId: email.id ?? null,
      label: state.label ?? null,
      category: state.category ?? null,
      subcategory: state.subcategory ?? null,
      error: state.error,
    });
  }
  return state;
}
