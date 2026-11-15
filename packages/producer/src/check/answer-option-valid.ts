/** `answer.option-valid` (system.md 12.6): every answer is one of the entry's options or its default (clarify takes free text). The rule lives in queue/rules.ts, shared with `clossys answer`. */
import { checkQueueEntries } from "../queue/scan.js";
import { ANSWER_OPTION_VALID, optionValidIssues } from "../queue/rules.js";
import type { TargetCheckRun } from "./pins-resolve.js";

export { ANSWER_OPTION_VALID };

export const checkAnswerOptionValid = (root: string): TargetCheckRun => checkQueueEntries(root, ANSWER_OPTION_VALID, optionValidIssues);
