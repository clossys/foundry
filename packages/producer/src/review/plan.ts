/**
 * `clossys review plan`: the review class of a unit's diff and the next review pass the budget allows, from the gate
 * lexicon (./gate-lexicon.ts) and the recorded verdicts. Reviewer owns the rule (R-REVIEW-BUDGET); this is the code
 * that applies it, so no pass beyond the budget runs.
 *
 * The budget: mechanical first; a non-gate diff needs no judgement pass after a mechanical PASS; a gate diff gets one
 * blind pass, and a second blind only when the diff changes a check's pass/fail logic or the first blind finds a P0
 * or P1; no final pass, ever, and never after a CLEAR blind; one closure delta per fix round; at most 2 fix rounds.
 */
import { git } from "./exec.js";
import { GATE_LEXICON, type GateLexicon } from "./gate-lexicon.js";

export type ReviewClass = "gate" | "non-gate";
export type ReviewRole = "blind" | "second-blind" | "closure-delta" | "final";
export type ReviewPass = "mechanical" | "blind" | "second-blind" | "closure-delta" | "none";
export type Severity = "P0" | "P1" | "P2" | "P3";

/** The longest fix-round run the budget allows: a third is refused. */
export const FIX_CAP = 2;

/** One file of a diff: its status letter (A, M, D, R...) and its changed lines, without the leading +/-. */
export interface DiffFile { readonly path: string; readonly status: string; readonly added: readonly string[]; readonly removed: readonly string[] }

export interface Classification {
  readonly class: ReviewClass;
  /** Touched files that are gate surfaces, and why each one is. */
  readonly gateSurfaces: readonly { readonly path: string; readonly why: string }[];
  /** Touched files on a gate path that only a contract surface rule exempts. */
  readonly contractOnly: readonly { readonly path: string; readonly kind: string }[];
  /** Whether the diff changes a check's pass/fail logic, and the first line (or file) that does. */
  readonly passFail: { readonly changed: boolean; readonly where?: string };
}

/** A glob (`**`, `*`) as an anchored regular expression over a repo-relative path. */
export function globRegExp(glob: string): RegExp {
  let out = "";
  for (let index = 0; index < glob.length; index++) {
    const char = glob[index]!;
    if (char === "*" && glob[index + 1] === "*") {
      index++;
      if (glob[index + 1] === "/") { index++; out += "(?:.*/)?"; } else out += ".*";
    } else if (char === "*") out += "[^/]*";
    else out += /[.+?^${}()|[\]\\]/.test(char) ? `\\${char}` : char;
  }
  return new RegExp(`^${out}$`);
}

const matches = (globs: readonly string[], path: string) => globs.some(glob => globRegExp(glob).test(path));
/** A comment line, or a package.json `"//..."` comment key. */
const COMMENT = /^\s*(\/\/|\/\*|\*|#|<!--|"\/\/)/;

/** Classifies a diff by the lexicon: gate or non-gate, and whether a check's pass/fail logic changed. */
export function classify(files: readonly DiffFile[], lexicon: GateLexicon = GATE_LEXICON): Classification {
  const gateSurfaces: { path: string; why: string }[] = [];
  const contractOnly: { path: string; kind: string }[] = [];
  let where: string | undefined;
  for (const file of files) {
    const lines = [...file.added, ...file.removed];
    const byPath = matches(lexicon.gatePaths, file.path);
    const byLine = lexicon.gateLines.find(rule => globRegExp(rule.path).test(file.path) && lines.some(line => new RegExp(rule.pattern).test(line)));
    if (!byPath && !byLine) continue;
    const contract = lexicon.contractSurfaces.find(surface => globRegExp(surface.path).test(file.path)
      && (surface.lines === undefined || lines.filter(line => line.trim()).every(line => new RegExp(surface.lines!).test(line))));
    if (contract) { contractOnly.push({ path: file.path, kind: contract.kind }); continue; }
    gateSurfaces.push({ path: file.path, why: byPath ? "gate path" : `gate line (${byLine!.pattern})` });
    if (where !== undefined || !matches(lexicon.passFail.paths, file.path) || matches(lexicon.passFail.ignore, file.path)) continue;
    if (file.status === "A" || file.status === "D") { where = `${file.path} (${file.status === "A" ? "new" : "deleted"} check source)`; continue; }
    const terms = lexicon.passFail.terms.map(term => new RegExp(term));
    const hit = lines.find(line => !COMMENT.test(line) && terms.some(term => term.test(line)));
    if (hit !== undefined) where = `${file.path}: ${hit.trim().slice(0, 120)}`;
  }
  return {
    class: gateSurfaces.length > 0 ? "gate" : "non-gate",
    gateSurfaces,
    contractOnly,
    passFail: where === undefined ? { changed: false } : { changed: true, where },
  };
}

/** The diff of base...head as DiffFiles (`git diff -U0`, renames resolved). */
export function diffFiles(repo: string, base: string, head: string): DiffFile[] {
  const out = git(repo, ["diff", "-U0", "-M", "--no-color", "--no-ext-diff", `${base}...${head}`]);
  const files: { path: string; status: string; added: string[]; removed: string[] }[] = [];
  let current: (typeof files)[number] | undefined;
  for (const line of out.split("\n")) {
    if (line.startsWith("diff --git ")) {
      const match = / b\/(.*)$/.exec(line);
      current = { path: match ? match[1]! : line, status: "M", added: [], removed: [] };
      files.push(current);
    } else if (!current) continue;
    else if (line.startsWith("new file mode")) current.status = "A";
    else if (line.startsWith("deleted file mode")) current.status = "D";
    else if (line.startsWith("rename to ")) { current.status = "R"; current.path = line.slice("rename to ".length); }
    else if (line.startsWith("+++ ") || line.startsWith("--- ")) continue;
    else if (line.startsWith("+")) current.added.push(line.slice(1));
    else if (line.startsWith("-")) current.removed.push(line.slice(1));
  }
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

/** One recorded review verdict (clossys.review-verdict/1), one JSON line of a unit's verdict log. */
export interface VerdictRecord {
  readonly schema: "clossys.review-verdict/1";
  readonly unit: string;
  readonly role: ReviewRole;
  readonly head: string;
  readonly verdict: "CLEAR" | "NOT CLEAR";
  /** NOT CLEAR only: why, and the highest severity found. */
  readonly reason?: string;
  readonly severity?: Severity;
  /** The blind attestation: no other review file was read for this unit. Required true for blind and second-blind. */
  readonly blind: boolean;
  /** `CLEAR <sha>` or `NOT CLEAR <sha>: <reason>`. */
  readonly line: string;
}

export const BLIND_ATTESTATION = "no other review file was read for this unit";
const SHA = /^[0-9a-f]{7,64}$/;
const ROLES: readonly ReviewRole[] = ["blind", "second-blind", "closure-delta", "final"];
const SEVERITIES: readonly Severity[] = ["P0", "P1", "P2", "P3"];

/** The verdict line of a record. */
export const verdictLine = (verdict: "CLEAR" | "NOT CLEAR", head: string, reason?: string) => verdict === "CLEAR" ? `CLEAR ${head}` : `NOT CLEAR ${head}: ${reason ?? ""}`;

/** Builds a verdict record, or throws with why it cannot be recorded. */
export function makeVerdict(input: { unit: string; role: string; head: string; clear: boolean; reason?: string; severity?: string; blind: boolean }): VerdictRecord {
  if (!input.unit) throw new Error("a verdict names its unit");
  if (!ROLES.includes(input.role as ReviewRole)) throw new Error(`role must be one of ${ROLES.join(", ")}`);
  if (input.role === "final") throw new Error("a final pass is not in the review budget: no verdict is recorded for one");
  if (!SHA.test(input.head)) throw new Error(`head must be a commit sha, not ${JSON.stringify(input.head)}`);
  if ((input.role === "blind" || input.role === "second-blind") && !input.blind) throw new Error(`a ${input.role} verdict needs the blind attestation: ${BLIND_ATTESTATION}`);
  if (input.clear) {
    if (input.reason !== undefined || input.severity !== undefined) throw new Error("a CLEAR verdict carries no reason or severity");
    return { schema: "clossys.review-verdict/1", unit: input.unit, role: input.role as ReviewRole, head: input.head, verdict: "CLEAR", blind: input.blind, line: verdictLine("CLEAR", input.head) };
  }
  const reason = input.reason?.trim();
  if (!reason || /[\r\n]/.test(reason)) throw new Error("a NOT CLEAR verdict needs a one-line reason");
  if (!SEVERITIES.includes(input.severity as Severity)) throw new Error(`a NOT CLEAR verdict needs its highest severity: ${SEVERITIES.join(", ")}`);
  return { schema: "clossys.review-verdict/1", unit: input.unit, role: input.role as ReviewRole, head: input.head, verdict: "NOT CLEAR", reason, severity: input.severity as Severity, blind: input.blind, line: verdictLine("NOT CLEAR", input.head, reason) };
}

/** Parses a verdict log (JSON lines), refusing a malformed or unattested record. */
export function parseVerdictLog(text: string, source = "verdict log"): VerdictRecord[] {
  return text.split("\n").map(line => line.trim()).filter(Boolean).map((line, index) => {
    let value: Partial<VerdictRecord>;
    try { value = JSON.parse(line) as Partial<VerdictRecord>; } catch { throw new Error(`${source}:${index + 1} is not JSON`); }
    if (value.schema !== "clossys.review-verdict/1") throw new Error(`${source}:${index + 1} is not a clossys.review-verdict/1 record`);
    let made: VerdictRecord;
    try {
      made = makeVerdict({ unit: String(value.unit ?? ""), role: String(value.role), head: String(value.head), clear: value.verdict === "CLEAR", blind: value.blind === true, ...(value.reason !== undefined ? { reason: value.reason } : {}), ...(value.severity !== undefined ? { severity: value.severity } : {}) });
    } catch (error) { throw new Error(`${source}:${index + 1}: ${(error as Error).message}`); }
    if (value.verdict !== "CLEAR" && value.verdict !== "NOT CLEAR") throw new Error(`${source}:${index + 1}: verdict must be CLEAR or NOT CLEAR`);
    if (value.line !== made.line) throw new Error(`${source}:${index + 1}: its line is not ${JSON.stringify(made.line)}`);
    return made;
  });
}

export interface PlanInput {
  readonly unit: string;
  readonly head: string;
  readonly classification: Classification;
  /** The mechanical review's verdict at this exact head, or null when none was given (or it is for another head). */
  readonly mechanical: "PASS" | "FAIL" | null;
  /** This unit's verdicts, oldest first. */
  readonly verdicts: readonly VerdictRecord[];
  /** Whether a clearance at `from` carries to the current head (clossys review carry); asked only when the head moved. */
  readonly carries: (from: string) => { readonly carry: boolean; readonly reason: string };
}

export interface Plan {
  readonly unit: string;
  readonly head: string;
  readonly class: ReviewClass;
  /** Blind passes the budget requires: 0 (non-gate), 1, or 2. */
  readonly blinds: number;
  readonly fixRounds: number;
  readonly next: ReviewPass;
  /** CLEARED: nothing more to run; WAITING: a fix must be pushed first; REFUSED: the budget is spent. */
  readonly status: "NEXT" | "CLEARED" | "WAITING" | "REFUSED";
  readonly reason: string;
}

const isHigh = (verdict: VerdictRecord | undefined) => verdict?.verdict === "NOT CLEAR" && (verdict.severity === "P0" || verdict.severity === "P1");

/** The next review pass the budget allows for a unit, from its class and recorded verdicts. */
export function planReview(input: PlanInput): Plan {
  const { classification, verdicts, head } = input;
  const base = { unit: input.unit, head, class: classification.class };
  const firstBlind = verdicts.find(verdict => verdict.role === "blind");
  const blinds = classification.class === "non-gate" ? 0 : classification.passFail.changed || isHigh(firstBlind) ? 2 : 1;
  const notClear = verdicts.filter(verdict => verdict.verdict === "NOT CLEAR").length;
  const plan = (next: ReviewPass, status: Plan["status"], reason: string, fixRounds = notClear): Plan => ({ ...base, blinds, fixRounds, next, status, reason });
  if (input.mechanical !== "PASS") return plan("mechanical", "NEXT", input.mechanical === "FAIL" ? "the mechanical review at this head is FAIL: fix and re-run it" : "mechanical first: no mechanical PASS record at this exact head");
  if (classification.class === "non-gate") return plan("none", "CLEARED", "non-gate diff: the mechanical PASS is the whole review");
  if (!firstBlind) return plan("blind", "NEXT", classification.passFail.changed ? `gate diff that changes pass/fail logic (${classification.passFail.where}): blind pass 1 of 2` : "gate diff: one blind pass");
  if (notClear > FIX_CAP) return plan("none", "REFUSED", `fix cap ${FIX_CAP}: a ${ordinal(notClear)} fix round is refused; escalate to the owner`);
  const last = verdicts[verdicts.length - 1]!;
  if (last.verdict === "NOT CLEAR") {
    if (last.head === head) return plan("none", "WAITING", `fix round ${notClear} is open (${last.line}): push the fix, then plan again`);
    return plan("closure-delta", "NEXT", `fix round ${notClear}: one closure delta over the fix`);
  }
  if (last.head !== head) {
    const carry = input.carries(last.head);
    if (!carry.carry) {
      if (notClear + 1 > FIX_CAP) return plan("none", "REFUSED", `the clearance at ${last.head.slice(0, 12)} is VOID (${carry.reason}) and fix cap ${FIX_CAP} is spent: a ${ordinal(notClear + 1)} fix round is refused; escalate to the owner`);
      return plan("closure-delta", "NEXT", `the clearance at ${last.head.slice(0, 12)} is VOID (${carry.reason}): fix round ${notClear + 1}, one closure delta`, notClear + 1);
    }
  }
  if (blinds === 2 && !verdicts.some(verdict => verdict.role === "second-blind")) {
    return plan("second-blind", "NEXT", classification.passFail.changed ? `the diff changes pass/fail logic (${classification.passFail.where}): blind pass 2 of 2` : `the first blind found a ${firstBlind.severity}: blind pass 2 of 2`);
  }
  return plan("none", "CLEARED", `${last.line}${last.head !== head ? ` carried to ${head}` : ""}: no final after a CLEAR`);
}

const ordinal = (n: number) => n === 1 ? "first" : n === 2 ? "second" : n === 3 ? "third" : `${n}th`;

/** Whether a requested pass is the one the plan allows; a final is never allowed. */
export function allowPass(plan: Plan, requested: string): { readonly allowed: boolean; readonly reason: string } {
  if (requested === "final") {
    return { allowed: false, reason: plan.status === "CLEARED" || plan.next === "second-blind" ? "no final after a CLEAR blind" : "a final pass is not in the review budget" };
  }
  if (plan.status === "REFUSED") return { allowed: false, reason: plan.reason };
  if (requested !== plan.next) return { allowed: false, reason: `the budget allows ${plan.next === "none" ? "no further pass" : plan.next} here, not ${requested}: ${plan.reason}` };
  return { allowed: true, reason: plan.reason };
}

/** The plan as printed: a few lines ending `NEXT: <pass> <head>`, `CLEARED <head>`, `WAITING <head>` or `REFUSED <head>: ...`. */
export function formatPlan(plan: Plan, classification: Classification): string {
  const lines = [
    `review plan ${plan.unit} at ${plan.head}`,
    `  class: ${plan.class}${plan.class === "gate" ? ` (${classification.gateSurfaces.length} gate surface(s): ${classification.gateSurfaces.slice(0, 4).map(surface => surface.path).join(", ")}${classification.gateSurfaces.length > 4 ? ", ..." : ""})` : ""}`,
    ...(classification.contractOnly.length ? [`  contract-only: ${classification.contractOnly.map(surface => `${surface.path} (${surface.kind})`).join(", ")}`] : []),
    `  pass/fail logic: ${classification.passFail.changed ? `changed, ${classification.passFail.where}` : "unchanged"}`,
    `  budget: ${plan.blinds} blind pass(es), fix rounds ${plan.fixRounds} of ${FIX_CAP}`,
    `  ${plan.reason}`,
  ];
  if (plan.status === "NEXT") lines.push(`NEXT: ${plan.next} ${plan.head}`);
  else if (plan.status === "REFUSED") lines.push(`REFUSED ${plan.head}: ${plan.reason}`);
  else lines.push(`${plan.status} ${plan.head}`);
  return lines.join("\n");
}
