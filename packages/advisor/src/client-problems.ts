import { CLIENT_PROBLEMS_DATA } from "./generated/offering.generated.js";

/**
 * One entry in the client problem vocabulary (issue #1176, owner comment
 * "De-risking dynamic composition", 2026-09-22): matches
 * this repository's client problem vocabulary (issue #1176). Advisor offers these as
 * confirmation cards (see context-questions.ts's card pattern, extended by
 * problem-questions.ts) -- the client confirms a problem, never picks a
 * package. `groundedInRole` only names the seed role a fallback statement
 * was derived from; it is not consulted at composition time.
 */
export interface ClientProblem {
  id: string;
  statement: string;
  groundedInRole: string;
}

/** The client problem vocabulary frozen at advisor's own build time. */
export const CLIENT_PROBLEMS: readonly ClientProblem[] = CLIENT_PROBLEMS_DATA;
