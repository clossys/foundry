/**
 * The requirements verdict (R16.4): a pure function of the candidate bytes, the standard (by its
 * sha), the slot contract (by its sha) and the dependency pin-set hash. Nothing else enters: the
 * certify cache key has exactly these four fields and no recipe field, and no recipe is read.
 */
import { createHash } from "node:crypto";
import { criterionById } from "./catalog.js";
import { isRecord } from "./lib.js";
import type { Criterion, Params, Subject } from "./types.js";

/** The certify cache key's fields, in order (R16.4). */
export const CERTIFY_KEY_FIELDS = Object.freeze(["candidate", "standard", "contract", "pinSet"] as const);
export type CertifyKey = Readonly<Record<(typeof CERTIFY_KEY_FIELDS)[number], string>>;

/** One requirement: a registered criterion id and its params. */
export interface Requirement { readonly check: string; readonly params: Params }
/** The standard as the verdict sees it: its id, content sha and requirements. */
export interface VerdictStandard { readonly id: string; readonly sha256: string; readonly requirements: readonly Requirement[] }
export interface VerdictInputs {
  readonly candidate: { readonly name: string; readonly bytes: string | Uint8Array };
  readonly kind: string;
  readonly standard: VerdictStandard;
  /** The slot's `contract` object (may carry `requirements` that parameterise or extend the standard's). */
  readonly contract: unknown;
  readonly pinSet: string;
}
export interface RequirementResult { readonly check: string; readonly pass: boolean; readonly failures: readonly string[] }
export interface Verdict { readonly schema: "clossys.requirements-verdict/1"; readonly key: CertifyKey; readonly pass: boolean; readonly results: readonly RequirementResult[] }

const sha = (bytes: string | Uint8Array) => createHash("sha256").update(bytes).digest("hex");
/** Canonical JSON: keys sorted at every depth. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isRecord(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value ?? null);
}

/** The certify cache key: the four R16.4 inputs, hashed. */
export function certifyKey(inputs: VerdictInputs): CertifyKey {
  return { candidate: sha(inputs.candidate.bytes), standard: inputs.standard.sha256, contract: sha(canonicalJson(inputs.contract ?? null)), pinSet: inputs.pinSet };
}

/**
 * The slot contract's requirements over the standard's (R15.3: "parameterised and extended by the
 * slot contract"): a contract entry for a listed check merges its params over the standard's; a
 * contract entry for another check is appended. Contract form: `[{check, params}]` or `{<check>: params}`.
 */
export function resolveRequirements(standard: readonly Requirement[], contract: unknown): Requirement[] {
  const raw = isRecord(contract) ? contract.requirements : undefined;
  const extra: Requirement[] = Array.isArray(raw)
    ? raw.filter(isRecord).filter(item => typeof item.check === "string").map(item => ({ check: item.check as string, params: isRecord(item.params) ? item.params : {} }))
    : isRecord(raw) ? Object.entries(raw).map(([check, params]) => ({ check, params: isRecord(params) ? params : {} })) : [];
  const out = standard.map(item => ({ check: item.check, params: { ...item.params } as Params }));
  for (const item of extra) {
    const at = out.findIndex(existing => existing.check === item.check);
    if (at >= 0) out[at] = { check: item.check, params: { ...out[at]!.params, ...item.params } };
    else out.push(item);
  }
  return out;
}

/** The subject of a candidate: a Markdown body without frontmatter (frontmatter as flat fields), or parsed JSON. */
export function subjectOf(name: string, bytes: string | Uint8Array, kind: string): Subject {
  const text = typeof bytes === "string" ? bytes : Buffer.from(bytes).toString("utf8");
  if (name.endsWith(".json")) {
    try { return { kind, text, json: JSON.parse(text) as unknown }; } catch { return { kind, text }; }
  }
  const front = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!front) return { kind, text };
  const fields: Record<string, string> = {};
  for (const line of front[1]!.split(/\r?\n/)) {
    const match = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line);
    if (match) fields[match[1]!] = match[2]!.replace(/^["']|["']$/g, "");
  }
  return { kind, text: text.slice(front[0].length), json: fields };
}

/**
 * The verdict of a candidate's requirements. `resolve` maps a criterion id to its function (the
 * catalog by default); an unregistered id fails its requirement rather than passing silently.
 */
export async function requirementsVerdict(inputs: VerdictInputs, resolve: (id: string) => Promise<Criterion> = id => criterionById(id)): Promise<Verdict> {
  const subject = subjectOf(inputs.candidate.name, inputs.candidate.bytes, inputs.kind);
  const results: RequirementResult[] = [];
  for (const requirement of resolveRequirements(inputs.standard.requirements, inputs.contract)) {
    let failures: string[];
    try { failures = (await resolve(requirement.check))(subject, requirement.params); }
    catch (error) { failures = [(error as Error).message]; }
    results.push({ check: requirement.check, pass: failures.length === 0, failures });
  }
  return { schema: "clossys.requirements-verdict/1", key: certifyKey(inputs), pass: results.every(result => result.pass), results };
}
