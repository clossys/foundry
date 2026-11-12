/**
 * owner.wiring (`clossys pipeline check`): every owner option `clossys next --owner` emits is a live answer.
 * Each option runs, call by call, on a scratch copy of the workspace records (`clossys/` and `.clossys/`),
 * with every `fill` placeholder filled. It must:
 *   - exit 0 on every call;
 *   - change the record each call targets (its slot folder when the call names `<agent>/<slot>`, otherwise
 *     something under `clossys/`);
 *   - change what `clossys gaps --agent <id>` reports for the asking agent;
 *   - leave no Writer key recorded by two pinned `strings.*` slots that was not already (one slot owns a key).
 * An argv that only prints a brief, names a verb that does not record, or targets the wrong record fails.
 * A question that waits on others (`after`) runs after their recommended answers, on the same scratch copy.
 * Read-only on the workspace: the scratch copy lives under the OS temp folder and is removed after each option.
 */
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RULES_FILE } from "../cli/owner.js";
import { writerCopyDuplicates } from "../records/writer-copy.js";
import { gapsOf, interviewOf, INTERVIEW_AGENTS, type Gaps, type Interview, type InterviewAgent, type QuestionOption } from "./interview.js";

export type RunCall = (argv: readonly string[], cwd: string) => Promise<{ exitCode: number; message?: string }>;
export interface OwnerWiringOptions {
  /** Runs one `clossys` argv (without the leading `clossys`) in a directory: the CLI's own `runCli`. */
  readonly run: RunCall;
  readonly agents?: readonly InterviewAgent[];
  /** For mutation proofs: the interview and gaps views (default the real ones). */
  readonly interviewOf?: (root: string, options: { agent: InterviewAgent }) => Pick<Interview, "rounds">;
  readonly gapsOf?: (root: string, options: { agent: InterviewAgent }) => Pick<Gaps, "gaps" | "counts">;
}
export interface OwnerWiringIssue { readonly rule: "owner.wiring"; readonly message: string }
export interface OwnerWiringResult { readonly options: number; readonly calls: number; readonly issues: readonly OwnerWiringIssue[] }

/** The workspace records an owner answer may write: the slot model, the run store and the rule registry's folder. */
const RULES_DIR = RULES_FILE.split("/").slice(0, -1).join("/");
const COPIED = ["clossys", ".clossys", RULES_DIR] as const;
const SLOT_TARGET = /^(producer|director|designer|writer|publisher)\/([a-z0-9][a-z0-9.-]*)$/;

/** A content digest of every file under a folder (empty when it does not exist). */
function digest(dir: string): string {
  const hash = createHash("sha256");
  const walk = (at: string, rel: string) => {
    let names: string[];
    try { names = readdirSync(at).sort(); } catch { return; }
    for (const name of names) {
      const path = join(at, name);
      let bytes: Buffer | null = null;
      try { bytes = readFileSync(path); } catch { walk(path, `${rel}/${name}`); continue; }
      hash.update(`${rel}/${name}\0`).update(bytes).update("\0");
    }
  };
  walk(dir, "");
  return hash.digest("hex");
}

/** The option's calls with each fill placeholder replaced (a `.md` placeholder becomes a file in the scratch root). */
function filled(option: QuestionOption, scratch: string): string[][] {
  const values = new Map<string, string>();
  for (const key of Object.keys(option.fill)) {
    if (/\.md>$/.test(key)) {
      const file = join(scratch, "owner-wiring-answer.md");
      writeFileSync(file, "Owner words for the owner.wiring check.\n");
      values.set(key, file);
    } else values.set(key, /^<model:/.test(key) ? "owner-wiring-model" : key === "<R-ID>" ? "R-OWNER-WIRING-CHECK" : "owner-wiring-check");
  }
  return option.calls.map(argv => argv.map(word => { let out = word; for (const [key, value] of values) out = out.split(key).join(value); return out; }));
}

const gapsKey = (gaps: Pick<Gaps, "gaps" | "counts">) => JSON.stringify({ gaps: gaps.gaps, counts: gaps.counts });

/** Run every emitted owner option on a scratch copy of `root`'s records; one issue per option that is not live. */
export async function ownerWiringIssues(root: string, options: OwnerWiringOptions): Promise<OwnerWiringResult> {
  const interview = options.interviewOf ?? interviewOf;
  const gaps = options.gapsOf ?? gapsOf;
  const issues: OwnerWiringIssue[] = [];
  let count = 0, calls = 0;
  const base = mkdtempSync(join(tmpdir(), "clossys-owner-wiring-"));
  try {
    for (const agent of options.agents ?? INTERVIEW_AGENTS) {
      const questions = interview(root, { agent }).rounds.flat();
      const byId = new Map(questions.map(question => [question.id, question]));
      // A question that waits on others (`after`) is answered after them: their recommended options run first.
      const prerequisites = (question: Interview["rounds"][number][number], seen = new Set<string>()): QuestionOption[] => question.after.flatMap(id => {
        const prior = byId.get(id);
        if (!prior || seen.has(id)) return [];
        seen.add(id);
        const recommended = prior.options.find(option => option.recommended) ?? prior.options[0];
        return [...prerequisites(prior, seen), ...(recommended ? [recommended] : [])];
      });
      for (const question of questions) {
        for (const option of question.options) {
          count++;
          const label = `${agent} ${question.id} ${option.id}`;
          const scratch = mkdtempSync(join(base, "option-"));
          try {
            for (const name of COPIED) if (existsSync(join(root, name))) cpSync(join(root, name), join(scratch, name), { recursive: true });
            let failed = false;
            for (const prior of prerequisites(question)) for (const argv of filled(prior, scratch)) {
              if (failed) break;
              const result = argv[0] === "clossys" ? await options.run(argv.slice(1), scratch) : { exitCode: 127, message: "not a clossys argv" };
              if (result.exitCode !== 0) { issues.push({ rule: "owner.wiring", message: `${label}: the answer it waits on (${question.after.join(", ")}) ran ${argv.join(" ")}, which exited ${result.exitCode}${result.message ? ` (${result.message.split("\n")[0]})` : ""}` }); failed = true; }
            }
            if (failed) continue;
            const before = gapsKey(gaps(scratch, { agent }));
            const held = new Set(writerCopyDuplicates(join(scratch, "clossys")).map(row => row.id));
            for (const argv of filled(option, scratch)) {
              calls++;
              const target = SLOT_TARGET.exec(argv[2] ?? "");
              const where = target ? [join(scratch, "clossys", "agents", target[1]!, target[2]!)] : [join(scratch, "clossys"), join(scratch, RULES_DIR)];
              const was = where.map(digest).join();
              const result = argv[0] === "clossys" ? await options.run(argv.slice(1), scratch) : { exitCode: 127, message: "not a clossys argv" };
              if (result.exitCode !== 0) { issues.push({ rule: "owner.wiring", message: `${label}: ${argv.join(" ")} exited ${result.exitCode}${result.message ? ` (${result.message.split("\n")[0]})` : ""}` }); failed = true; break; }
              if (where.map(digest).join() === was) { issues.push({ rule: "owner.wiring", message: `${label}: ${argv.join(" ")} exited 0 but changed no record${target ? ` in ${target[0]}` : " under clossys/"}` }); failed = true; break; }
            }
            if (!failed) for (const row of writerCopyDuplicates(join(scratch, "clossys"))) if (!held.has(row.id)) {
              issues.push({ rule: "owner.wiring", message: `${label}: the answer records Writer key ${row.id} in ${row.slots.join(" and ")}; one Writer slot owns a key` }); failed = true;
            }
            if (!failed && gapsKey(gaps(scratch, { agent })) === before) issues.push({ rule: "owner.wiring", message: `${label}: the answer ran, but clossys gaps --agent ${agent} reports the same gaps` });
          } finally { rmSync(scratch, { recursive: true, force: true }); }
        }
      }
    }
  } finally { rmSync(base, { recursive: true, force: true }); }
  return { options: count, calls, issues };
}
