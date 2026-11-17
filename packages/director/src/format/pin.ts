/**
 * The one pin schema (planner R9): `pin.json` = {candidate, sha256, decidedBy, basis, at, confirmed?}.
 * Every pin reader checks it here or mirrors it exactly: the slot-model validator
 * (@clossys/producer validatePin), Director's parseSlotPin, and the no-build decision check
 * (scripts/check-decisions.mjs, whose pin-shape rule a conformance test holds to these verdicts).
 * A pin records a decision only; what its candidate cites is a slot id, resolved through the cited
 * slot's own pin when it is read (format/citation.ts), so a pin carries no citation state.
 */

/** Every key a pin may carry. */
export const PIN_KEYS = ["candidate", "sha256", "decidedBy", "basis", "at", "confirmed"] as const;
/** Every key of a pin's owner confirmation. */
export const PIN_CONFIRMED_KEYS = ["by", "ref", "at"] as const;
/** `<name>-v<n>.<md|json>`: any agent's candidate file name; n is the candidate version. */
export const PIN_CANDIDATE_NAME = /^([a-z0-9][a-z0-9.-]*)-v([1-9][0-9]*)\.(md|json)$/;
/** Who decided: owner, planner or migration (each optionally `:<ref>`), `agent:<seat>`, or `migrated`. */
export const DECIDED_BY = /^(?:(?:owner|planner|migration)(?::\S.*)?|agent:\S+|migrated)$/;
/** How a pin was decided: an owner pick, a blanket owner approval, the planner, or a judge seat (`clossys pick`). */
export const PIN_BASES = ["picked", "bulk", "planner", "agent"] as const;
/** Who may confirm an agent pick: the owner only. */
export const CONFIRMED_BY = /^owner(?::\S.*)?$/;
/** Where a confirmation's owner words are: one ledger comment, optionally followed by a note in parentheses. */
export const OWNER_WORDS_REF = /^(?:[\w.-]+\/[\w.-]+#\d+ issuecomment-\d+|https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/issues\/\d+#issuecomment-\d+)(?: \([^()]*\))?$/;
export const OWNER_WORDS_REF_FORM = "<org>/<repo>#<issue> issuecomment-<id> or https://github.com/<org>/<repo>/issues/<issue>#issuecomment-<id>";

const SHA256 = /^[a-f0-9]{64}$/;
const object = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const iso = (value: unknown) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value) && !Number.isNaN(Date.parse(value));

/** Every way `value` breaks the pin schema, as messages; empty for a valid pin. */
export function pinIssues(value: unknown): string[] {
  const issues: string[] = [];
  if (!object(value)) return ["expected an object"];
  for (const key of Object.keys(value)) if (!(PIN_KEYS as readonly string[]).includes(key)) issues.push(`unknown key ${key}`);
  if (typeof value.candidate !== "string" || !PIN_CANDIDATE_NAME.test(value.candidate)) issues.push("candidate must be a candidate file name");
  if (typeof value.sha256 !== "string" || !SHA256.test(value.sha256)) issues.push("sha256 must be 64 lowercase hex");
  if (typeof value.decidedBy !== "string" || !DECIDED_BY.test(value.decidedBy)) issues.push("decidedBy must be owner[:<ref>], planner[:<ref>], migration[:<ref>], agent:<seat> or migrated");
  if (!(PIN_BASES as readonly unknown[]).includes(value.basis)) issues.push(`basis must be one of ${PIN_BASES.join(", ")}`);
  if ((value.basis === "agent") !== (typeof value.decidedBy === "string" && value.decidedBy.startsWith("agent:"))) issues.push("basis agent and decidedBy agent:<seat> go together (clossys pick)");
  if (!iso(value.at)) issues.push("at must be an ISO timestamp");
  if (value.confirmed !== undefined) {
    const confirmed = value.confirmed;
    if (value.basis !== "agent") issues.push("confirmed is only on an agent pick (basis agent); an owner pin is its own decision");
    if (!object(confirmed)) issues.push("confirmed must be {by, ref, at}");
    else {
      for (const key of Object.keys(confirmed)) if (!(PIN_CONFIRMED_KEYS as readonly string[]).includes(key)) issues.push(`confirmed has unknown key ${key}`);
      if (typeof confirmed.by !== "string" || !CONFIRMED_BY.test(confirmed.by)) issues.push("confirmed.by must be owner[:<ref>]");
      if (typeof confirmed.ref !== "string" || !OWNER_WORDS_REF.test(confirmed.ref)) issues.push(`confirmed.ref must cite the ledger comment that holds the owner's words (${OWNER_WORDS_REF_FORM})`);
      if (!iso(confirmed.at)) issues.push("confirmed.at must be an ISO timestamp");
    }
  }
  return issues;
}

/**
 * `clossys.pin/2` (@clossys/producer schemas/pin.json): the pin record above plus the COMMON block that
 * `clossys pin` writes after a recut and the recut's pin/1 migration produces. Director has no dependency on
 * Producer, so the key list and value rules are mirrored here exactly. pin/1 (no `schema` key) is unchanged.
 */
export const PIN2_SCHEMA = "clossys.pin/2";
/** The COMMON keys of a pin/2, in schema order. */
export const PIN2_COMMON_KEYS = ["schema", "id", "agent", "kind", "status", "createdBy", "createdAt", "updatedAt", "refs"] as const;
/** Every key a pin/2 may carry. */
export const PIN2_KEYS = [...PIN2_COMMON_KEYS, ...PIN_KEYS] as const;
const PIN2_REQUIRED = ["schema", "id", "agent", "kind", "status", "createdBy", "createdAt", "refs", "candidate", "sha256", "decidedBy", "basis", "at"] as const;
const AGENTS = ["director", "designer", "writer", "publisher", "producer"] as const;
const AGENT = `(?:${AGENTS.join("|")})`;
const SLOT_ID = "[a-z][a-z0-9-]*(?:\\.[a-z0-9][a-z0-9-]*){1,3}";
const PIN2_ID = new RegExp(`^${AGENT}/${SLOT_ID}/pin$`);
const PIN2_DECIDED_BY = new RegExp(`^(?:owner(?::.+)?|planner(?::.+)?|agent:${AGENT}|migrated)$`);
const ISO_Z = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]+)?Z$/;
const REF_TO = new RegExp(`^(?:facts|${AGENT}/${SLOT_ID}(?:/(?:package:)?[a-z0-9][a-z0-9.-]*-v[1-9][0-9]*\\.(?:md|json|svg))?)$`);
const REF_KEYS = ["to", "key", "record", "sha256", "rel"] as const;
const REF_RELS = ["input", "uses", "consumedBy", "places", "cites", "raisedBy", "answers"] as const;
const TIERS = ["low", "mid", "high"] as const;
const text = (value: unknown) => typeof value === "string" && value.length > 0;
/** The actor variants of `createdBy`: required keys and per-key rules; no other key is allowed. */
const ACTORS: Record<string, Record<string, (value: unknown) => boolean>> = {
  package: { package: v => typeof v === "string" && new RegExp(`^@clossys/${AGENT}$`).test(v), version: text },
  agent: { agent: v => (AGENTS as readonly unknown[]).includes(v), skill: text, skillSha256: v => typeof v === "string" && SHA256.test(v), model: text, tier: v => (TIERS as readonly unknown[]).includes(v) },
  owner: { ref: text },
  planner: { ref: text },
  code: { cli: text, version: text },
};

function actorIssues(value: unknown): string[] {
  if (!object(value) || typeof value.actor !== "string" || !Object.hasOwn(ACTORS, value.actor)) return [`createdBy must be one actor (${Object.keys(ACTORS).join(", ")})`];
  const rules = ACTORS[value.actor]!;
  const issues: string[] = [];
  for (const key of Object.keys(value)) if (key !== "actor" && !Object.hasOwn(rules, key)) issues.push(`createdBy has unknown key ${key}`);
  for (const [key, ok] of Object.entries(rules)) if (!ok(value[key])) issues.push(`createdBy.${key} is missing or invalid for actor ${value.actor}`);
  return issues;
}

function refIssues(value: unknown, at: number): string[] {
  if (!object(value)) return [`refs[${at}] must be an object`];
  const issues: string[] = [];
  for (const key of Object.keys(value)) if (!(REF_KEYS as readonly string[]).includes(key)) issues.push(`refs[${at}] has unknown key ${key}`);
  if (typeof value.to !== "string" || !REF_TO.test(value.to)) issues.push(`refs[${at}].to must be facts or <agent>/<slot-id>[/<candidate>]`);
  if (!(REF_RELS as readonly unknown[]).includes(value.rel)) issues.push(`refs[${at}].rel must be one of ${REF_RELS.join(", ")}`);
  if (value.key !== undefined && !text(value.key)) issues.push(`refs[${at}].key must be a non-empty string`);
  if (value.record !== undefined && !text(value.record)) issues.push(`refs[${at}].record must be a non-empty string`);
  if (value.sha256 !== undefined && (typeof value.sha256 !== "string" || !SHA256.test(value.sha256))) issues.push(`refs[${at}].sha256 must be 64 lowercase hex`);
  return issues;
}

/**
 * Every way `value` breaks the `clossys.pin/2` schema, as messages; empty for a valid pin/2. The record fields
 * keep the one pin schema's rules (pinIssues), narrowed where pin/2 is stricter; `slot`, when given, is the slot
 * folder the pin was read from, which a pin/2's `id` must name.
 */
export function pin2Issues(value: unknown, slot?: { agent: string; id: string }): string[] {
  if (!object(value)) return ["expected an object"];
  const issues: string[] = [];
  for (const key of Object.keys(value)) if (!(PIN2_KEYS as readonly string[]).includes(key)) issues.push(`unknown key ${key}`);
  for (const key of PIN2_REQUIRED) if (value[key] === undefined) issues.push(`missing key ${key}`);
  if (value.schema !== PIN2_SCHEMA) issues.push(`schema must be ${PIN2_SCHEMA}`);
  if (typeof value.id !== "string" || !PIN2_ID.test(value.id)) issues.push("id must be <agent>/<slot-id>/pin");
  if (!(AGENTS as readonly unknown[]).includes(value.agent)) issues.push(`agent must be one of ${AGENTS.join(", ")}`);
  if (value.kind !== "pin") issues.push("kind must be pin");
  if (value.status !== "pinned" && value.status !== "confirm") issues.push("status must be pinned or confirm");
  if (value.createdBy !== undefined) issues.push(...actorIssues(value.createdBy));
  if (value.createdAt !== undefined && (typeof value.createdAt !== "string" || !ISO_Z.test(value.createdAt))) issues.push("createdAt must be an ISO timestamp ending in Z");
  if (value.updatedAt !== undefined && (typeof value.updatedAt !== "string" || !ISO_Z.test(value.updatedAt))) issues.push("updatedAt must be an ISO timestamp ending in Z");
  if (value.refs !== undefined) {
    if (!Array.isArray(value.refs)) issues.push("refs must be an array");
    else value.refs.forEach((ref, at) => issues.push(...refIssues(ref, at)));
  }
  if (typeof value.at === "string" && !ISO_Z.test(value.at)) issues.push("at must be an ISO timestamp ending in Z");
  if (typeof value.decidedBy === "string" && !PIN2_DECIDED_BY.test(value.decidedBy)) issues.push("decidedBy must be owner[:<ref>], planner[:<ref>], agent:<agent> or migrated");
  if (object(value.confirmed) && value.confirmed.by !== undefined && value.confirmed.by !== "owner") issues.push("confirmed.by must be owner");
  if (slot && issues.length === 0) {
    if (value.agent !== slot.agent) issues.push(`agent ${String(value.agent)} is not ${slot.agent}`);
    if (value.id !== `${slot.agent}/${slot.id}/pin`) issues.push(`id ${String(value.id)} is not ${slot.agent}/${slot.id}/pin`);
  }
  const record = Object.fromEntries(PIN_KEYS.filter(key => value[key] !== undefined).map(key => [key, value[key]]));
  for (const issue of pinIssues(record)) if (!issues.includes(issue)) issues.push(issue);
  return issues;
}
