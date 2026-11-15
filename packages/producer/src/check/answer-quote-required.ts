/** `answer.quote-required` (system.md 12.6): every owner answer records the owner's words in quote. The rule lives in queue/rules.ts, shared with `clossys answer`. */
import { checkQueueEntries } from "../queue/scan.js";
import { ANSWER_QUOTE_REQUIRED, quoteRequiredIssues } from "../queue/rules.js";
import type { TargetCheckRun } from "./pins-resolve.js";

export { ANSWER_QUOTE_REQUIRED };

export const checkAnswerQuoteRequired = (root: string): TargetCheckRun => checkQueueEntries(root, ANSWER_QUOTE_REQUIRED, quoteRequiredIssues);
