/** `answer.open-only` (system.md 12.6): an entry takes one answer, and its status agrees with its events. The rule lives in queue/rules.ts, shared with `clossys answer`. */
import { checkQueueEntries } from "../queue/scan.js";
import { ANSWER_OPEN_ONLY, openOnlyIssues } from "../queue/rules.js";
import type { TargetCheckRun } from "./pins-resolve.js";

export { ANSWER_OPEN_ONLY };

export const checkAnswerOpenOnly = (root: string): TargetCheckRun => checkQueueEntries(root, ANSWER_OPEN_ONLY, openOnlyIssues);
