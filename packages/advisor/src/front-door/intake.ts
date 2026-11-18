/**
 * `advisor intake --answers <file> [--observed <date>]`: the owner's one-time answers, recorded as Director
 * context inputs through Director's own path, `clossys evidence owner-intake-<topic>-<date> --source user`.
 * Advisor never writes a Director slot: the plan is checked by intakePlanIssues before anything runs, and
 * Advisor's only own write is clossys/advisor/intake.json. A second intake is refused: later answers go to
 * Director in chat, which records them as new evidence.
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

export interface IntakeOptions { readonly answers?: string; readonly observed?: string; readonly directorRoots?: readonly string[] }

function topicOf(leaf: string): string { return leaf.split(".").pop()!; }
export function evidenceId(leaf: string, date: string): string { return `owner-intake-${topicOf(leaf)}-${date}`; }

export function runIntake(tree: AdvisorTree, root: string, options: IntakeOptions, host: Host): VerbResult {
  if (!options.answers) return { exitCode: 2, lines: ["intake needs --answers <file>"] };
  if (isSecretPath(options.answers)) return refused(["intake: refused: --answers names a secret or environment file"]);
  const observed = options.observed ?? host.today();
  if (!DATE.test(observed)) return { exitCode: 2, lines: ["--observed must be YYYY-MM-DD"] };
  if (existsSync(join(root, INTAKE_RECORD))) return refused([`intake: ${INTAKE_RECORD} exists; intake runs once. Tell @clossys-director in chat; it records later answers as new evidence.`]);
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

  const answered = questions.filter(([id]) => typeof answers[id] === "string");
  const skipped = questions.filter(([id]) => typeof answers[id] !== "string").map(([id]) => id);
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

  const recorded: { question: string; evidence: string; informs: readonly string[] }[] = [];
  const failed: { question: string; reason: string }[] = [];
  try {
    for (const entry of planned) {
      const words = (answers[entry.id] as string).trim();
      writeFileSync(entry.body, `- Words: "${words}"\n- Question: ${entry.slot.question}\n- Informs: ${(entry.slot.feeds ?? []).join(", ")}\n`);
      const result = host.run(bin, entry.command.args, { cwd: root });
      if (existsSync(entry.body)) unlinkSync(entry.body);
      if (result.status !== 0) { failed.push({ question: entry.id, reason: tail(result.stderr || result.stdout) }); break; }
      recorded.push({ question: entry.id, evidence: `clossys/evidence/director/${entry.evidence}.md`, informs: entry.slot.feeds ?? [] });
    }
  } finally { rmdirSync(scratch); }

  const record = { schema: "clossys.advisor-intake/1", observed, at: host.now(), status: failed.length ? "partial" : "complete", recorded, skipped, failed };
  mkdirSync(join(root, "clossys", "advisor"), { recursive: true });
  writeFileSync(join(root, INTAKE_RECORD), `${JSON.stringify(record, null, 2)}\n`);
  const lines = [
    ...recorded.map(entry => `recorded ${entry.evidence} (informs ${entry.informs.join(", ")})`),
    ...skipped.map(id => `skipped ${id}: no answer (nothing invented)`),
    ...failed.map(entry => `failed ${entry.question}: ${entry.reason}`),
    `intake: wrote ${INTAKE_RECORD}`,
  ];
  return failed.length ? refused(lines, record) : ok([...lines, "next: talk to @clossys-director; it reads this evidence"], record);
}
