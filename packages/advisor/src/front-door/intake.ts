/**
 * `advisor intake --answers <file> [--observed <date>]`: the owner's one-time answers, recorded as Director
 * context inputs through Director's own path, `clossys evidence owner-intake-<topic>-<date> --source user`.
 * Advisor never writes a Director slot: the plan is checked by intakePlanIssues before anything runs, and
 * Advisor's only own write is clossys/advisor/intake.json.
 * Every answer is tried and reported as recorded, skipped (no answer) or failed. An intake with any question not
 * recorded is partial and resumes: a rerun tries only the missing and failed answers and never re-records or
 * overwrites one already recorded (nor an evidence file already on disk). Once every question is recorded the
 * intake is complete and runs once: later answers go to Director in chat, which records them as new evidence.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { intakePlanIssues, isSecretPath, type PlannedCommand } from "./guard.js";
import { ok, refused, tail, type Host, type VerbResult } from "./host.js";
import { clossysBin } from "./init.js";
import { INSTALL_RECORD } from "./install.js";
import { directorCells, slotsByVerb, type AdvisorTree } from "./tree.js";

export const INTAKE_RECORD = "clossys/advisor/intake.json";
export const ANSWERS_SCHEMA = "clossys.advisor-intake-answers/1";
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export interface IntakeEntry { readonly question: string; readonly evidence: string; readonly informs: readonly string[] }
export interface IntakeRecord {
  readonly schema: "clossys.advisor-intake/1"; readonly observed: string; readonly at: string; readonly status: "complete" | "partial";
  readonly recorded: readonly IntakeEntry[]; readonly skipped: readonly string[]; readonly failed: readonly { readonly question: string; readonly reason: string }[];
}

/** The intake record, undefined when there is none, "unreadable" when the file is not one. */
export function readIntakeRecord(root: string): IntakeRecord | undefined | "unreadable" {
  const file = join(root, INTAKE_RECORD);
  if (!existsSync(file)) return undefined;
  try {
    const doc = JSON.parse(readFileSync(file, "utf8")) as IntakeRecord;
    if (doc.schema !== "clossys.advisor-intake/1" || (doc.status !== "complete" && doc.status !== "partial") || !Array.isArray(doc.recorded)) return "unreadable";
    if (!doc.recorded.every(entry => typeof entry?.question === "string" && typeof entry.evidence === "string" && Array.isArray(entry.informs))) return "unreadable";
    return doc;
  } catch { return "unreadable"; }
}

export interface IntakeOptions { readonly answers?: string; readonly observed?: string; readonly directorRoots?: readonly string[] }

function topicOf(leaf: string): string { return leaf.split(".").pop()!; }
export function evidenceId(leaf: string, date: string): string { return `owner-intake-${topicOf(leaf)}-${date}`; }

export function runIntake(tree: AdvisorTree, root: string, options: IntakeOptions, host: Host): VerbResult {
  if (!options.answers) return { exitCode: 2, lines: ["intake needs --answers <file>"] };
  if (isSecretPath(options.answers)) return refused(["intake: refused: --answers names a secret or environment file"]);
  const observed = options.observed ?? host.today();
  if (!DATE.test(observed)) return { exitCode: 2, lines: ["--observed must be YYYY-MM-DD"] };
  const previous = readIntakeRecord(root);
  if (previous === "unreadable") return refused([`intake: ${INTAKE_RECORD} is not a clossys.advisor-intake/1 record; it is left as it is`]);
  if (previous?.status === "complete") return refused([`intake: ${INTAKE_RECORD} is complete; intake runs once. Tell @clossys-director in chat; it records later answers as new evidence.`]);
  if (!existsSync(join(root, INSTALL_RECORD))) return refused([`intake: no ${INSTALL_RECORD}; run advisor install --from <pack-dir> first`]);
  const bin = clossysBin(root);
  if (!existsSync(bin)) return refused(["intake: node_modules/.bin/clossys is missing; run advisor update --from <pack-dir> to reinstall"]);

  let doc: { schema?: unknown; answers?: unknown };
  try { doc = JSON.parse(readFileSync(options.answers, "utf8")); } catch { return refused([`intake: cannot read ${options.answers} as JSON`]); }
  if (doc.schema !== ANSWERS_SCHEMA || typeof doc.answers !== "object" || doc.answers === null || Array.isArray(doc.answers)) return refused([`intake: answers file must be {"schema":"${ANSWERS_SCHEMA}","answers":{<question id>: <owner words>}}`]);
  const questions = slotsByVerb(tree, "intake");
  const known = new Set(questions.map(([id]) => id));
  const answers = doc.answers as Record<string, unknown>;
  const issues: string[] = [];
  for (const [id, value] of Object.entries(answers)) {
    if (!known.has(id)) issues.push(`unknown question ${id}`);
    else if (typeof value !== "string" || !value.trim()) issues.push(`${id} must be the owner's words as text`);
    else if (/[\r\n]/.test(value)) issues.push(`${id} must be one line`);
    else if (value.length > 500) issues.push(`${id} is longer than 500 characters`);
  }
  const cells = directorCells(options.directorRoots ?? [join(root, "node_modules", "@clossys", "director")]);
  if (!cells) issues.push("no installed @clossys/director tree; cannot check which cells the answers inform");
  else for (const [id, slot] of questions) for (const cell of slot.feeds ?? []) if (!cells.has(cell)) issues.push(`${id} feeds ${cell}, which the installed Director does not have`);
  if (issues.length) return refused(issues.map(issue => `intake: refused: ${issue}`));

  const kept = previous?.recorded ?? [];
  const done = new Set(kept.map(entry => entry.question));
  const open = questions.filter(([id]) => !done.has(id));
  const answered = open.filter(([id]) => typeof answers[id] === "string");
  const skipped = open.filter(([id]) => typeof answers[id] !== "string").map(([id]) => id);
  const repeated = questions.filter(([id]) => done.has(id) && typeof answers[id] === "string").map(([id]) => id);
  const scratch = mkdtempSync(join(tmpdir(), "advisor-intake-"));
  const planned = answered.map(([id, slot]) => {
    const evidence = evidenceId(id, observed);
    const body = join(scratch, `${evidence}.md`);
    const target = slot.contract.record.split("<date>").join(observed);
    const command: PlannedCommand = { target, args: ["evidence", evidence, "--source", "user", "--observed", observed, "--by", "advisor", "--body", body, "--root", root] };
    return { id, slot, evidence, body, command };
  });
  const plan = { root, writes: [INTAKE_RECORD], commands: planned.map(entry => entry.command) };
  const planIssues = intakePlanIssues(plan);
  if (planIssues.length) { rmdirSync(scratch); return refused(planIssues.map(issue => `intake: refused: ${issue}`)); }

  const recorded: IntakeEntry[] = [];
  const failed: { question: string; reason: string }[] = [];
  try {
    for (const entry of planned) {
      // Evidence is never rewritten: a file already at the target fails this answer and runs nothing for it.
      if (existsSync(join(root, entry.command.target))) { failed.push({ question: entry.id, reason: `${entry.command.target} already exists; not overwritten (rerun with another --observed date, or tell @clossys-director)` }); continue; }
      const words = (answers[entry.id] as string).trim();
      writeFileSync(entry.body, `- Words: "${words}"\n- Question: ${entry.slot.question}\n- Informs: ${(entry.slot.feeds ?? []).join(", ")}\n`);
      const result = host.run(bin, entry.command.args, { cwd: root });
      if (existsSync(entry.body)) unlinkSync(entry.body);
      if (result.status !== 0) { failed.push({ question: entry.id, reason: tail(result.stderr || result.stdout) }); continue; }
      recorded.push({ question: entry.id, evidence: entry.command.target, informs: entry.slot.feeds ?? [] });
    }
  } finally { rmdirSync(scratch); }

  const all = [...kept, ...recorded];
  const complete = questions.every(([id]) => all.some(entry => entry.question === id));
  const record: IntakeRecord = { schema: "clossys.advisor-intake/1", observed, at: host.now(), status: complete ? "complete" : "partial", recorded: all, skipped, failed };
  mkdirSync(join(root, "clossys", "advisor"), { recursive: true });
  writeFileSync(join(root, INTAKE_RECORD), `${JSON.stringify(record, null, 2)}\n`);
  const lines = [
    ...kept.map(entry => `kept ${entry.evidence} (already recorded${repeated.includes(entry.question) ? "; the new answer was not recorded" : ""})`),
    ...recorded.map(entry => `recorded ${entry.evidence} (informs ${entry.informs.join(", ")})`),
    ...skipped.map(id => `skipped ${id}: no answer (nothing invented)`),
    ...failed.map(entry => `failed ${entry.question}: ${entry.reason}`),
    `intake: wrote ${INTAKE_RECORD} (${record.status})`,
    ...(complete ? [] : ["intake: partial; rerun advisor intake with the missing answers to resume (recorded answers are kept)"]),
  ];
  return failed.length ? refused(lines, record) : ok([...lines, "next: talk to @clossys-director; it reads this evidence"], record);
}
