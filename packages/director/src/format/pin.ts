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
