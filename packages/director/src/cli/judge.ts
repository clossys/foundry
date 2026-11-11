/**
 * `clossys director check judge`: the one writer of a judgement finding. A judge a script cannot
 * replace (the storyline critic `C4`, a judge contradiction pair `C2:X<n>`, a cell check
 * `Q<n>:<cell-id>@<N>`) gives its verdict in its own fresh context; this verb records it as
 * `<consumer>/evidence/director/<id>.md`. The verb, not the caller, lists `judged`: every cell the
 * judge id covers, at its pinned version now, so a verdict can never name a version that is not the
 * one the judge read. It refuses when a covered cell is unpinned, when a cell judgement's version is
 * not the pinned one or its run does not resolve in `.clossys/runs`, and when `--heard` does not name
 * the owner's words routed to a judged cell (a verdict is recorded only after the owner has heard
 * the reading). It never edits an earlier finding: a second verdict gets the next free id. The
 * clossys CLI traces each `director check` run as step `director.store`. Exit 0 done, 2 could not run.
 */
import { dirname } from "node:path";
import { judgedCells } from "../checks/judgements.js";
import { JUDGE_ID_PATTERN, RUN_CITATION_PATTERN } from "../format/finding.js";
import { RECORD_ID_PATTERN } from "../format/ref.js";
import type { Finding, StrategyModel } from "../format/types.js";
import { citedRuns, EVIDENCE_PREFIX, evidenceBase, readStrategyFile, readStrategyRoot } from "../store.js";
import { resolveStrategyRoot } from "../strategy-dir-default.js";
import type { DirectorStore } from "../store-io.js";

export const JUDGE_USAGE = `Usage: clossys director check judge <C4 | C2:X<n> | Q<n>:<cell-id>@<N>> --verdict pass|fail
         --heard <finding-id> --reason <text> [--reason <text>]... [--run <step>#<run id>] [--root <dir>] [--json]
Records a judge's verdict as evidence/director/<id>.md (critic-storyline-<date>, critic-x<n>-<date> or
judge-q<n>-<cell>-v<N>-<date>), with judged set to every covered cell at its pinned version. --heard names
the owner's words (a source: user finding with an Informs: bullet naming a judged cell); a cell judgement
also needs --run, a finished run in .clossys/runs. Each --reason is one bullet of the judge's reading.`;

interface JudgeArgs { judge?: string; verdict?: string; heard?: string; run?: string; root?: string; reasons: string[]; json: boolean; help: boolean }

const VALUE_FLAGS = new Set(["--verdict", "--heard", "--run", "--root", "--reason"]);

function parse(argv: string[]): JudgeArgs {
  const args: JudgeArgs = { reasons: [], json: false, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]!;
    if (token === "--json") args.json = true;
    else if (token === "--help" || token === "-h") args.help = true;
    else if (VALUE_FLAGS.has(token)) {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) throw new Error(`${token} needs a value`);
      if (token === "--reason") args.reasons.push(value);
      else if (token === "--verdict") args.verdict = value;
      else if (token === "--heard") args.heard = value;
      else if (token === "--run") args.run = value;
      else args.root = value;
      i += 1;
    } else if (token.startsWith("-")) throw new Error(`Unknown option ${token}`);
    else if (args.judge === undefined) args.judge = token;
    else throw new Error(`Unexpected argument ${token}`);
  }
  return args;
}

function today(): string { return new Date().toISOString().slice(0, 10); }

/** The finding id stem for a judge id: the storyline critic, a pair, or one cell's Q judgement. */
function stem(judge: string, date: string): string {
  if (judge === "C4") return `critic-storyline-${date}`;
  const pair = /^C2:X([1-9][0-9]*)$/.exec(judge);
  if (pair) return `critic-x${pair[1]}-${date}`;
  const [, rule, cell, version] = /^Q([1-7]):(.+)@([1-9][0-9]*)$/.exec(judge)!;
  return `judge-q${rule}-${cell!.replace(/\./g, "-")}-v${version}-${date}`;
}

/** The owner's words that heard the reading: a source: user finding, not itself a judgement, routed to a judged cell. */
function heardBy(model: StrategyModel, id: string, judged: readonly string[]): Finding {
  const finding = model.findings.find(candidate => candidate.id === id);
  if (!finding) throw new Error(`--heard ${id}: no such finding in ${EVIDENCE_PREFIX}`);
  if (finding.source !== "user" || finding.judge !== undefined) throw new Error(`--heard ${id}: expected the owner's words (source: user, not a judgement)`);
  const informs = finding.bullets.filter(bullet => bullet.key === "Informs").flatMap(bullet => bullet.text.split(",").map(part => part.trim().replace(/\.$/, "")));
  if (!judged.some(cell => informs.includes(cell))) throw new Error(`--heard ${id}: its Informs: bullet names none of the judged cells (${judged.join(", ")})`);
  return finding;
}

export function judgeRecord(fields: { id: string; date: string; judge: string; verdict: string; judged: readonly string[]; run?: string }, reasons: readonly string[], heard: string): string {
  const run = fields.run === undefined ? "" : `run: ${fields.run}\n`;
  return `---\nid: ${fields.id}\nsource: user\nobserved: ${fields.date}\nby: critic\njudge: ${fields.judge}\nverdict: ${fields.verdict}\njudged: ${JSON.stringify(fields.judged)}\n${run}---\n`
    + reasons.map(reason => `- ${reason}\n`).join("")
    + `- The owner heard the reading (finding:${heard})\n`;
}

export function runJudgeCli(argv: string[], store: DirectorStore, print: (text: string) => void = console.log, now: () => string = today): number {
  const json = argv.includes("--json");
  const out = (code: number, result: Record<string, unknown>, text: string) => { print(json ? JSON.stringify({ command: "judge", code, ...result }) : text); return code; };
  try {
    const args = parse(argv);
    if (args.help) return out(0, { help: JUDGE_USAGE }, JUDGE_USAGE);
    const judge = args.judge;
    if (judge === undefined || !JUDGE_ID_PATTERN.test(judge)) throw new Error("Expected a judge id: C4, C2:X<n> or Q<n>:<cell-id>@<N>");
    if (args.verdict !== "pass" && args.verdict !== "fail") throw new Error("--verdict pass|fail is required");
    if (args.heard === undefined) throw new Error("--heard <finding-id> is required: a verdict is recorded only after the owner has heard the reading");
    if (!args.reasons.length) throw new Error("--reason is required: record the judge's reading, not only its verdict");
    for (const reason of args.reasons) if (!reason.trim() || /[\r\n]/.test(reason)) throw new Error("Each --reason is one non-empty line");
    const root = resolveStrategyRoot(args.root);
    const base = evidenceBase(root);
    if (base === undefined) throw new Error("The judgement record needs the flat store root <consumer>/agents/director");
    const verdict = args.verdict, reasons = args.reasons;
    return store.writer.locked(root, () => {
      const model = readStrategyRoot(root, store.reader);
      if (model.issues.length) throw new Error(model.issues.map(issue => `${issue.path}:${issue.line}: ${issue.message}`).join("; "));
      const cells = judgedCells(model, judge);
      if (!cells) throw new Error(`${judge} is not a judge the checks count (a C2 pair must be of kind judge)`);
      const unpinned = cells.filter(cell => typeof model.tree?.active[cell] !== "number");
      if (unpinned.length) throw new Error(`Not pinned, so there is nothing to judge: ${unpinned.join(", ")}`);
      const judged = cells.map(cell => `${cell}@${model.tree!.active[cell]}`);
      const cellJudgement = /^Q[1-7]:/.test(judge);
      if (cellJudgement && !judged.includes(judge.slice(judge.indexOf(":") + 1))) throw new Error(`${judge} does not name the pinned version (${judged[0]})`);
      if (args.run !== undefined) {
        if (!RUN_CITATION_PATTERN.test(args.run)) throw new Error("--run expects <step>#<16-hex run id>");
        const run = citedRuns(dirname(base), store.reader, [{ run: args.run }])[args.run];
        if (!run || (run.exit !== 0 && run.exit !== 1)) throw new Error(`--run ${args.run} is not a finished run in .clossys/runs`);
      } else if (cellJudgement) throw new Error("--run <step>#<run id> is required for a cell judgement: cite the judge's traced run");
      const heard = heardBy(model, args.heard!, cells).id;
      const date = now();
      let id = stem(judge, date);
      for (let n = 2; model.findings.some(finding => finding.id === id) || readStrategyFile(root, store.reader, `${EVIDENCE_PREFIX}/${id}.md`) !== undefined; n += 1) id = `${stem(judge, date)}-${n}`;
      if (!RECORD_ID_PATTERN.test(id)) throw new Error(`Cannot form a finding id from ${judge}`);
      const after = judgeRecord({ id, date, judge, verdict, judged, ...(args.run === undefined ? {} : { run: args.run }) }, reasons, heard);
      const path = `${EVIDENCE_PREFIX}/${id}.md`;
      store.writer.commit(base, [{ path: `evidence/director/${id}.md`, after }]);
      return out(0, { result: { judge, verdict, judged, heard, recorded: { path, id } } }, `Judgement ${judge}: ${verdict} on ${judged.join(", ")}, recorded in ${path}.`);
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return out(2, { error: message }, `clossys director check judge: ${message}`);
  }
}
