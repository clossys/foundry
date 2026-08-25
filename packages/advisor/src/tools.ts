import { assessAdvisorEngagement } from "./assessment.js";
import { advanceAdvisorSession, createAdvisorSession } from "./session.js";
import type { AdvisorFinding, AdvisorToolContract, AdvisorToolRequest, AdvisorToolResponse } from "./types.js";

export const ADVISOR_TOOL_CONTRACTS: readonly AdvisorToolContract[] = [
  { name: "start_advisor_session", description: "Create an in-memory sponsor session from a caller-provided opaque id." },
  { name: "assess_advisor_engagement", description: "Assess supplied fit, readiness, overlap, pre-work, first-wave, and reassessment evidence without network access." },
  { name: "advance_advisor_session", description: "Apply a permitted session event; sponsor approval is gated by current pre-work clearance." },
];
function failed(message: string): AdvisorToolResponse { const finding: AdvisorFinding = { rule: "tool-input", severity: "error", message }; return { state: "indeterminate", output: null, findings: [finding] }; }

/** Pure adapter suitable for a remote or local connector. It never performs authentication or I/O. */
export function handleAdvisorTool(request: AdvisorToolRequest): AdvisorToolResponse {
  if (request.name === "start_advisor_session") {
    try { const output = createAdvisorSession(request.input.id, request.input.nextAction); return { state: "satisfied", output, findings: [] }; }
    catch (cause) { return failed(cause instanceof Error ? cause.message : String(cause)); }
  }
  if (request.name === "assess_advisor_engagement") { const output = assessAdvisorEngagement(request.input); return { state: output.state, output, findings: output.findings }; }
  const advanced = advanceAdvisorSession(request.input.session, request.input.event);
  return { state: advanced.findings.length === 0 ? "satisfied" : "indeterminate", output: advanced.session, findings: advanced.findings };
}
