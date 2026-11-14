/**
 * R-DIRECTOR-DERIVED (constitution R20; foundry-feedback-0016, foundry-audit-0005): every pinned
 * Designer `themes.*` / `assets.*` candidate and every pinned Writer candidate says, in its reason,
 * which pinned Director slot it realises. The reason is `meta.element.reason` on a Designer (.json)
 * candidate and the frontmatter `reason` line on a Writer (.md) candidate. A citation is
 * `director:<slot-id>[#<key>]`; keeping an upstream default is `default:<ref>` plus a Director
 * citation saying why the default stays. `source.ref` alone is not a trace: it names where the bytes
 * came from, not the Director decision they realise.
 *
 * One predicate, shared by the constitution check (R20), `clossys design --check` and
 * `clossys write --check`, so the three never disagree on what a trace is. Pure.
 */
import { parseFrontmatter } from "./slot-model/index.js";

/** The Designer layers whose pinned candidates must cite a Director slot. */
export const DIRECTOR_TRACE_DESIGNER_LAYERS: readonly string[] = ["themes", "assets"];

/** Whether a slot's pinned candidate owes a Director trace: Designer themes.* / assets.*, every Writer slot. */
export function owesDirectorTrace(agent: string, slot: string): boolean {
  if (agent === "writer") return true;
  return agent === "designer" && DIRECTOR_TRACE_DESIGNER_LAYERS.includes(slot.split(".")[0]!);
}

const isObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);

/** Where a candidate's reason lives, for messages. */
export function reasonField(name: string): string {
  return name.endsWith(".md") ? "frontmatter reason" : "meta.element.reason";
}

/**
 * A candidate's reason text: the frontmatter `reason` of a .md candidate, `meta.element.reason` of a
 * .json one. Undefined when absent or not a string (also when the bytes do not parse).
 */
export function candidateReason(name: string, bytes: string): string | undefined {
  if (name.endsWith(".md")) {
    const parsed = parseFrontmatter(bytes);
    if (!parsed.ok) return undefined;
    const reason = (parsed.value.fields as Record<string, unknown>).reason;
    return typeof reason === "string" ? reason : undefined;
  }
  let doc: unknown;
  try { doc = JSON.parse(bytes); } catch { return undefined; }
  const element = isObject(doc) && isObject(doc.meta) && isObject(doc.meta.element) ? doc.meta.element : undefined;
  return element && typeof element.reason === "string" ? element.reason : undefined;
}

/** `director:<slot-id>[#<key>]` in free text; the id is the slot-id grammar (2-4 dotted segments). */
const DIRECTOR_CITE = /(?<![A-Za-z0-9.:/-])director:([a-z][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*){1,3})(?![a-z0-9-])/g;
/** `default:<ref>`: keeping an upstream default; the ref is everything up to whitespace. */
const DEFAULT_FORM = /(?<![A-Za-z0-9])default:(\S*)/g;

/** The Director slot ids a reason cites. */
export function directorCites(reason: string): string[] {
  return [...new Set([...reason.matchAll(DIRECTOR_CITE)].map(match => match[1]!))];
}

/**
 * Why a reason is not a Director trace, or undefined when it is: it must cite at least one pinned
 * Director slot, and every `default:` form in it must name its ref.
 */
export function directorTraceProblem(name: string, reason: string | undefined, pinnedDirector: { has(id: string): boolean }): string | undefined {
  const field = reasonField(name);
  if (reason === undefined || !reason.trim()) return `${field} is missing: it must cite the pinned Director slot it realises (director:<slot-id>), or default:<ref> plus a Director reason`;
  for (const match of reason.matchAll(DEFAULT_FORM)) {
    const ref = match[1]!.replace(/[.,;:)]+$/, "");
    if (!ref) return `${field} uses default: without naming the default's ref (default:<ref>)`;
  }
  const cites = directorCites(reason);
  if (!cites.length) return `${field} cites no Director slot: name the pinned Director slot it realises (director:<slot-id>)`;
  if (!cites.some(id => pinnedDirector.has(id))) return `${field} cites ${cites.map(id => `director:${id}`).join(", ")}, which ${cites.length === 1 ? "is not a pinned Director slot" : "are not pinned Director slots"}`;
  return undefined;
}
