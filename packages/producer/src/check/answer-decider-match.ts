/** `answer.decider-match` (system.md 12.6): every answer comes from the decider the entry names (code closes only fix or clarify). The rule lives in queue/rules.ts, shared with `clossys answer`. */
import { checkQueueEntries } from "../queue/scan.js";
import { ANSWER_DECIDER_MATCH, deciderMatchIssues } from "../queue/rules.js";
import type { TargetCheckRun } from "./pins-resolve.js";

export { ANSWER_DECIDER_MATCH };

export const checkAnswerDeciderMatch = (root: string): TargetCheckRun => checkQueueEntries(root, ANSWER_DECIDER_MATCH, deciderMatchIssues);
