/**
 * The registered owner decisions, `<consumer>/owner-decisions.json` (clossys.owner-decisions/1): the
 * offline record an `--owner-ref` resolves against. Owner words live in ledger comments; this repo
 * holds no copy of them that a verb can read without GitHub (pins carry free-text `owner:<note>`
 * refs, the rule registry keys owner words by rule id). So an owner-gated verb accepts a ref only
 * when it names a decision registered here: a reviewed commit adds the decision (its ledger
 * comment, date, what it authorizes and a one-line summary), and the verb never calls GitHub.
 *
 *   { "schema": "clossys.owner-decisions/1",
 *     "decisions": [{ "id": "<comment id>", "ref": "<org>/<repo>#<issue> issuecomment-<id> (<note>)",
 *                     "date": "YYYY-MM-DD", "scope": ["ia"], "summary": "<one line>" }] }
 *
 * `--owner-ref` takes the comment id (`6873279813`) or a ledger ref in OWNER_WORDS_REF form naming the
 * same issue and comment; either resolves to the registered decision, whose `ref` the write records.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { OWNER_WORDS_REF, OWNER_WORDS_REF_FORM } from "./slot-model/types.js";

export const OWNER_DECISIONS_SCHEMA = "clossys.owner-decisions/1";
/** The file, relative to the consumer folder (`clossys/`). */
export const OWNER_DECISIONS_FILE = "owner-decisions.json";
/** What a registered decision may authorize: `ia`, the IA regroup operations of `clossys ia`. */
export const OWNER_DECISION_SCOPES = ["ia"] as const;
export type OwnerDecisionScope = (typeof OWNER_DECISION_SCOPES)[number];

export interface OwnerDecision {
  /** The ledger comment id that holds the owner's words. */
  readonly id: string;
  /** The ledger ref (OWNER_WORDS_REF) of that comment; the write records it. */
  readonly ref: string;
  readonly date: string;
  readonly scope: readonly OwnerDecisionScope[];
  readonly summary: string;
}
export interface OwnerDecisionsDoc { readonly schema: typeof OWNER_DECISIONS_SCHEMA; readonly decisions: readonly OwnerDecision[] }

const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const oneLine = (value: unknown): value is string => typeof value === "string" && /\S/.test(value) && !/[\r\n]/.test(value);
const DECISION_KEYS = ["id", "ref", "date", "scope", "summary"];

/** `<org>/<repo>#<issue>` and the comment id of an OWNER_WORDS_REF, in either form; undefined for anything else. */
export function ledgerComment(ref: string): { issue: string; comment: string } | undefined {
  if (!OWNER_WORDS_REF.test(ref)) return undefined;
  const short = /^([\w.-]+\/[\w.-]+)#(\d+) issuecomment-(\d+)/.exec(ref);
  if (short) return { issue: `${short[1]}#${short[2]}`, comment: short[3]! };
  const url = /^https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/issues\/(\d+)#issuecomment-(\d+)/.exec(ref);
  return url ? { issue: `${url[1]}#${url[2]}`, comment: url[3]! } : undefined;
}

/** Issues of an owner-decisions document; empty when it is valid. */
export function validateOwnerDecisions(value: unknown): string[] {
  if (!object(value)) return ["not a JSON object"];
  const issues: string[] = [];
  if (value.schema !== OWNER_DECISIONS_SCHEMA) issues.push(`schema is not ${OWNER_DECISIONS_SCHEMA}`);
  const extra = Object.keys(value).filter(key => key !== "schema" && key !== "decisions");
  if (extra.length) issues.push(`unknown keys ${extra.join(", ")}`);
  if (!Array.isArray(value.decisions)) return [...issues, "decisions is not an array"];
  const seen = new Set<string>();
  value.decisions.forEach((decision: unknown, index: number) => {
    const at = `decisions[${index}]`;
    if (!object(decision)) { issues.push(`${at} is not an object`); return; }
    const unknown = Object.keys(decision).filter(key => !DECISION_KEYS.includes(key));
    if (unknown.length) issues.push(`${at} has unknown keys ${unknown.join(", ")}`);
    if (typeof decision.id !== "string" || !/^\d+$/.test(decision.id)) issues.push(`${at}.id is not a ledger comment id (digits)`);
    else if (seen.has(decision.id)) issues.push(`${at}.id ${decision.id} is registered twice`);
    else seen.add(decision.id);
    const cited = typeof decision.ref === "string" ? ledgerComment(decision.ref) : undefined;
    if (!cited) issues.push(`${at}.ref must cite the ledger comment that holds the owner's words (${OWNER_WORDS_REF_FORM})`);
    else if (cited.comment !== decision.id) issues.push(`${at}.ref cites comment ${cited.comment}, not its id ${String(decision.id)}`);
    if (typeof decision.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(decision.date) || Number.isNaN(Date.parse(decision.date))) issues.push(`${at}.date is not YYYY-MM-DD`);
    if (!Array.isArray(decision.scope) || !decision.scope.length || !decision.scope.every(scope => (OWNER_DECISION_SCOPES as readonly unknown[]).includes(scope))) issues.push(`${at}.scope must list one or more of ${OWNER_DECISION_SCOPES.join(", ")}`);
    if (!oneLine(decision.summary)) issues.push(`${at}.summary must be one non-empty line`);
  });
  return issues;
}

export type OwnerRefResolution = { readonly decision: OwnerDecision } | { readonly error: string };

/**
 * Resolve `--owner-ref <given>` against `<consumer>/owner-decisions.json` for `scope`: the bare comment
 * id, or an OWNER_WORDS_REF naming the same issue and comment as a registered decision. Offline only.
 */
export function resolveOwnerRef(consumer: string, given: string | undefined, scope: OwnerDecisionScope): OwnerRefResolution {
  const value = given?.trim();
  if (!value) return { error: `--owner-ref is required: give the ledger comment id of the owner's words (a decision registered in clossys/${OWNER_DECISIONS_FILE})` };
  const file = join(consumer, OWNER_DECISIONS_FILE);
  if (!existsSync(file)) return { error: `--owner-ref ${value}: clossys/${OWNER_DECISIONS_FILE} does not exist, so no owner decision is registered` };
  let doc: unknown;
  try { doc = JSON.parse(readFileSync(file, "utf8")); } catch { return { error: `clossys/${OWNER_DECISIONS_FILE} is not JSON` }; }
  const issues = validateOwnerDecisions(doc);
  if (issues.length) return { error: `clossys/${OWNER_DECISIONS_FILE} is invalid: ${issues.slice(0, 3).join("; ")}` };
  const decisions = (doc as OwnerDecisionsDoc).decisions;
  let found: OwnerDecision | undefined;
  if (/^\d+$/.test(value)) found = decisions.find(decision => decision.id === value);
  else {
    const cited = ledgerComment(value);
    if (!cited) return { error: `--owner-ref ${value} is neither a ledger comment id nor a ledger ref (${OWNER_WORDS_REF_FORM})` };
    found = decisions.find(decision => { const own = ledgerComment(decision.ref)!; return own.comment === cited.comment && own.issue === cited.issue; });
  }
  if (!found) return { error: `--owner-ref ${value} names no owner decision registered in clossys/${OWNER_DECISIONS_FILE}` };
  if (!found.scope.includes(scope)) return { error: `--owner-ref ${value}: decision ${found.id} does not authorize ${scope} changes (scope ${found.scope.join(", ")})` };
  return { decision: found };
}
