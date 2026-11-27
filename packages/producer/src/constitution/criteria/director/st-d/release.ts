/**
 * The next-release brief (Director `execution.roadmap.release`, CP1-PLAN): its Scope states each
 * publication as a row `<kind> (<page>, <page>): <use case>`, rows split by `;`, every use case naming
 * the stated Stage; at an early stage the pages it asks for are capped by the contract. The parse is pure
 * and shared: `clossys plan` reads the pinned brief through it, so the plan only ever places what the
 * certified brief states.
 */
import { isRecord, num, strings, words } from "../../core/lib.js";
import type { Criterion } from "../../core/types.js";
import { lineValue, sectionLines, sourceOf } from "./lib.js";

export interface ScopeRow { readonly kind: string; readonly pages: readonly string[]; readonly use: string; readonly text: string }
export interface ReleaseScope { readonly stage?: string; readonly rows: readonly ScopeRow[]; readonly notInScope: readonly string[]; readonly issues: readonly string[] }
export interface ReleaseScopeParams {
  readonly kinds: readonly string[]; readonly stages: readonly string[]; readonly capStages: readonly string[]; readonly pageCap: number;
  readonly need: string; readonly scopeKey: string; readonly stageKey: string; readonly notKey: string; readonly minUseWords: number;
}

const PAGE = /^[a-z][a-z0-9-]*$/;
const NONE = /^(?:none|nothing|n\/a|-)$/i;

/** The params of `brief.release-scope`, or the first reason they are unusable. */
export function releaseScopeParams(params: Readonly<Record<string, unknown>>): ReleaseScopeParams | string {
  const kinds = strings(params.kinds), stages = strings(params.stages), capStages = strings(params.capStages);
  const pageCap = num(params.pageCap, Number.NaN);
  if (!kinds.length) return "params.kinds must list the publication kinds a Scope row may name";
  if (!stages.length) return "params.stages must list the stages a release may state";
  if (capStages.some(stage => !stages.includes(stage))) return "params.capStages must be stages from params.stages";
  if (!Number.isInteger(pageCap) || pageCap < 1) return "params.pageCap must be a positive whole number";
  const text = (key: string, fallback: string) => typeof params[key] === "string" && params[key] ? params[key] as string : fallback;
  return {
    kinds, stages, capStages, pageCap, need: text("need", "context.customer.need"), scopeKey: text("scopeKey", "Scope"),
    stageKey: text("stageKey", "Stage"), notKey: text("notKey", "Not in scope"), minUseWords: num(params.minUseWords, 4),
  };
}

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const directionValue = (text: string, key: string): string | undefined => {
  const line = (sectionLines(text, "Direction") ?? []).find(item => item.startsWith(`${key}:`));
  return line === undefined ? undefined : lineValue(line).trim();
};

/** The Stage, Scope rows and Not-in-scope items of a release brief body, with every shape issue found. */
export function parseReleaseScope(text: string, params: ReleaseScopeParams): ReleaseScope {
  const issues: string[] = [];
  const rawStage = directionValue(text, params.stageKey);
  const stage = rawStage?.toLowerCase();
  if (stage === undefined) issues.push(`Direction has no "- ${params.stageKey}: ..." line; state one of ${params.stages.join(", ")}`);
  else if (!params.stages.includes(stage)) issues.push(`${params.stageKey} "${rawStage}" is not one of ${params.stages.join(", ")}`);
  const rows: ScopeRow[] = [];
  const scope = directionValue(text, params.scopeKey);
  if (!scope) issues.push(`Direction has no "- ${params.scopeKey}: ..." line with rows`);
  const kindAlternation = [...params.kinds].sort((a, b) => b.length - a.length).map(escape).join("|");
  const shape = new RegExp(`^(${kindAlternation})\\s*\\(([^()]*)\\)\\s*(?::\\s*(.*))?$`, "i");
  for (const part of (scope ?? "").split(";").map(item => item.trim()).filter(Boolean)) {
    const match = shape.exec(part);
    if (!match) { issues.push(`${params.scopeKey} row "${part}" is not "<kind> (<page>, <page>): <use case>" with a kind from ${params.kinds.join(", ")}`); continue; }
    const kind = match[1]!.toLowerCase();
    const pages = match[2]!.split(",").map(item => item.trim().toLowerCase()).filter(Boolean);
    const use = (match[3] ?? "").trim();
    const at = `${params.scopeKey} row "${kind}"`;
    if (rows.some(row => row.kind === kind)) issues.push(`${at} is stated twice; one row per publication kind`);
    if (!pages.length) issues.push(`${at} names no pages`);
    for (const page of pages) if (!PAGE.test(page)) issues.push(`${at} page "${page}" is not a plain page name (lower-case words joined by -)`);
    if (new Set(pages).size !== pages.length) issues.push(`${at} names a page twice`);
    if (words(use).length < params.minUseWords) issues.push(`${at} has no use case; end it with ": <who it serves and why, at this stage>" of at least ${params.minUseWords} words`);
    else if (stage && params.stages.includes(stage) && !new RegExp(`\\b${escape(stage)}\\b`, "i").test(use)) issues.push(`${at} use case does not name the stage "${stage}"`);
    rows.push({ kind, pages, use, text: part });
  }
  if (scope && !rows.length && !issues.length) issues.push(`${params.scopeKey} states no rows`);
  const not = directionValue(text, params.notKey);
  const notInScope = (not ?? "").split(/[;,]/).map(item => item.trim()).filter(item => item && !NONE.test(item));
  if (!notInScope.length) issues.push(`Direction has no "- ${params.notKey}: ..." list; name what waits for a later release`);
  if (stage && params.capStages.includes(stage)) {
    const total = rows.reduce((sum, row) => sum + row.pages.length, 0);
    if (total > params.pageCap) issues.push(`${params.scopeKey} asks for ${total} pages; a ${stage} release holds at most ${params.pageCap}`);
  }
  return { ...(stage !== undefined ? { stage } : {}), rows, notInScope, issues };
}

/**
 * brief.release-scope: the release states its Stage, a Scope of `<kind> (<pages>): <use case>` rows (a kind
 * from `kinds`, each use case naming the stage), a non-empty Not-in-scope list, at most `pageCap` pages in
 * total at a `capStages` stage, and derives from the customer need (`need`, cited by a Because line through
 * brief.because-cited).
 */
export const releaseScope: Criterion = (subject, params) => {
  const resolved = releaseScopeParams(isRecord(params) ? params : {});
  if (typeof resolved === "string") return [resolved];
  const failures = [...parseReleaseScope(subject.text, resolved).issues];
  const source = sourceOf(subject);
  if (typeof source === "string") failures.push(source);
  else if (!source.ref.some(ref => ref === resolved.need || ref === `director:${resolved.need}`)) failures.push(`source does not cite ${resolved.need}; every use case serves the customer need, so derive from it and cite it in Because`);
  return failures;
};
