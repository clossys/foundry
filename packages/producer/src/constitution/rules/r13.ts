/**
 * R13 Strings and pages (slot-constitution.md R13; unit W2-D).
 *
 * R13.1 Every visible string is a Writer key: the check-copy-source rules jsx, prop, record, label,
 * message, lang and row.
 * R13.2 Every page is one frame plus sections: check-assemble-only.
 * R13.3 Every copy key a page names exists in the pinned Writer candidate: the check-copy-source
 * rules keys (a referenced key resolves) and names (a named IA label resolves).
 *
 * Code rules: they run the two scripts (check-copy-source runs on the built Producer package). A
 * root without packages/producer/package.json has no code to judge and gives no row.
 */
import type { ConstitutionContext, Row, RuleModule } from "../types.js";
import { brokenScript, codeRow, hasCode, runScript, type ScriptRun } from "./r11.js";

const COPY_SOURCE = "packages/producer/scripts/check-copy-source.mjs";
const ASSEMBLE_ONLY = "packages/producer/scripts/check-assemble-only.mjs";
const COPY_RULES = ["jsx", "prop", "record", "label", "names", "keys", "message", "lang", "row"] as const;
/** The copy-source rules that resolve keys (R13.3); the rest prove strings are keys (R13.1). */
const KEY_RULES = new Set(["keys", "names"]);
const COPY_LINE = new RegExp(`^(${COPY_RULES.join("|")})\\s+(.+?): (.+)$`);

/** R13.1 and R13.3 rows from a `check-copy-source --all` run. */
export function copySourceRows(run: ScriptRun): { r131: Row[]; r133: Row[] } {
  const r131: Row[] = [], r133: Row[] = [];
  if (run.status !== 0 && run.status !== 1) {
    const broken = brokenScript("R13", "R13.1", COPY_SOURCE, run);
    return { r131: [broken], r133: [{ ...broken, check: "R13.3" }] };
  }
  for (const line of run.stdout.split("\n")) {
    const match = COPY_LINE.exec(line);
    if (!match) continue;
    const [, rule, where, message] = match as unknown as [string, string, string, string];
    if (KEY_RULES.has(rule)) r133.push(codeRow("R13", "R13.3", `copy key does not resolve (${rule}): ${message}`, where));
    else r131.push(codeRow("R13", "R13.1", `visible string is not a Writer key (${rule}): ${message}`, where));
  }
  if (run.status === 1 && !r131.length && !r133.length) {
    const broken = brokenScript("R13", "R13.1", COPY_SOURCE, run);
    return { r131: [broken], r133: [{ ...broken, check: "R13.3" }] };
  }
  return { r131, r133 };
}

export interface AssembleFinding { readonly rule: string; readonly file: string; readonly line?: number; readonly detail: string }

/** R13.2 rows from a `check-assemble-only --json` run. */
export function assembleRows(run: ScriptRun): Row[] {
  try {
    if (run.status !== 0 && run.status !== 1) throw new Error("exit");
    const findings = JSON.parse(run.stdout) as AssembleFinding[];
    if (!Array.isArray(findings) || (run.status === 1 && !findings.length)) throw new Error("shape");
    return findings.map(finding => codeRow("R13", "R13.2", `a page is not one frame plus sections (${finding.rule}): ${finding.detail}`, `${finding.file}${finding.line ? `:${finding.line}` : ""}`));
  } catch {
    return [brokenScript("R13", "R13.2", ASSEMBLE_ONLY, run)];
  }
}

const copyRuns = new WeakMap<ConstitutionContext, { r131: Row[]; r133: Row[] }>();
function copySource(ctx: ConstitutionContext): { r131: Row[]; r133: Row[] } {
  let rows = copyRuns.get(ctx);
  if (!rows) copyRuns.set(ctx, rows = copySourceRows(runScript(COPY_SOURCE, ["--root", ctx.root, "--all"])));
  return rows;
}

export const R13: RuleModule = {
  rule: "R13",
  checks: {
    "R13.1": ctx => (hasCode(ctx.root) ? copySource(ctx).r131 : []),
    "R13.2": ctx => (hasCode(ctx.root) ? assembleRows(runScript(ASSEMBLE_ONLY, ["--root", ctx.root, "--json"])) : []),
    "R13.3": ctx => (hasCode(ctx.root) ? copySource(ctx).r133 : []),
  },
};
