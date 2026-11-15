/** Runs one per-entry answer rule over every queue entry file in a workspace (the `answer.*` file checks). */
import { runOf, type TargetCheckRun, type TargetFinding } from "../check/pins-resolve.js";
import { listQueueEntryFiles, readQueueEntry } from "./entry.js";
import type { AnswerRule } from "./rules.js";

export function checkQueueEntries(root: string, check: string, issues: AnswerRule): TargetCheckRun {
  const findings: TargetFinding[] = [];
  for (const at of listQueueEntryFiles(root)) {
    const subject = `producer/${at.queue}#${at.id}`;
    const read = readQueueEntry(at);
    if (!read.ok) { findings.push({ check, subject, detail: read.reason }); continue; }
    for (const detail of issues(read.entry, root)) findings.push({ check, subject, detail });
  }
  return runOf(check, findings);
}
