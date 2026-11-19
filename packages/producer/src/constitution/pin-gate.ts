/**
 * The CHOOSE gate of a target pin (foundry-build-0048 U3): `clossys pin` on a clossys.slot/2 slot
 * pins only a candidate that
 * - came in through a verb: the slot ledger holds a `submit` event naming it whose sha256 is the
 *   candidate's bytes now (a file placed by hand, or edited after its submit, has no submit record),
 * - and passes certification (certify/index.ts: schema, contract fixture, the kind certifier and the
 *   slot standard's requirements merged with `contract.requirements`).
 * A release slot's verdict is release.ready instead (flows.md F8): `clossys pin` runs it first and it binds
 * the owner's queue.approve answer to the manifest's sha256, which is a stronger record than a submit, so
 * the caller passes `{ verdict: "release.ready" }` only after that check passed for the pick.
 * Every pin writes the slot's ranked scorecard, `.clossys/checks/<agent>/<slot>/scorecard.json`: each
 * candidate with its submit record, its verdict and the reasons, ranked (certified and submitted
 * first, then fewest reasons), and the pin cites it (`refs` `producer/checks.scorecard`, rel cites,
 * with the scorecard's sha256).
 */
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildContext } from "./context.js";
import { certify, certifyEnv, pinSetOf } from "./certify/index.js";
import { submitOf } from "./rules/r03.js";
import type { Reason } from "./certify/types.js";
import type { Ref } from "../records/types.js";
import { judgeSlotOptions } from "../records/slot-options.js";
import { OPTION_TABLE, type SlotAgent } from "../records/slot-model/index.js";
import { readSlotEntry } from "../records/slots.js";
import { expectedCandidateSha, ledgerEventsOf } from "../records/ledger.js";

export const SCORECARD_SCHEMA = "clossys.scorecard/1";
export const SCORECARD_REF_TO = "producer/checks.scorecard" as const;

export interface ScorecardRow {
  readonly rank: number;
  readonly candidate: string;
  readonly sha256: string;
  /** The submit event's sha256 equals the bytes now. */
  readonly submitted: boolean;
  readonly certified: boolean;
  /** What judged the row: certify (the slot's certifier and standard) or release.ready (a release slot). */
  readonly verdict: "certify" | "release.ready";
  readonly reasons: readonly Reason[];
  /**
   * The pinSet the verdict was given on (certify/index.ts pinSetOf: the pins of everything the candidate reads).
   * R07.5 re-verdicts a pinned candidate whose pinSet changed since (constitution/cascade.ts). Absent on a
   * release.ready row.
   */
  readonly pinSet?: string;
}
export interface Scorecard {
  readonly schema: typeof SCORECARD_SCHEMA;
  readonly slot: string;
  readonly at: string;
  readonly pick: string;
  readonly candidates: readonly ScorecardRow[];
}
export interface PinGate {
  /** Why the pick may not be pinned (empty = it may). */
  readonly refusals: readonly string[];
  readonly scorecard: Scorecard;
}

const sha = (text: string) => createHash("sha256").update(text).digest("hex");

/** Judges every candidate of `<agent>/<slot>` and the pick among them. */
export function pinGate(root: string, consumer: string, agent: string, slotId: string, pick: string, at: string, options: { readonly verdict?: "release.ready" } = {}): PinGate {
  const ctx = buildContext(root, consumer, { focus: [{ agent, slot: slotId }] });
  const slot = ctx.agents.find(each => each.agent === agent)?.slots.get(slotId);
  const empty: Scorecard = { schema: SCORECARD_SCHEMA, slot: `${agent}/${slotId}`, at, pick, candidates: [] };
  if (!slot) return { refusals: [`${agent}/${slotId} is no live slot`], scorecard: empty };
  if (options.verdict === "release.ready") {
    const candidate = slot.candidates.find(each => each.name === pick);
    if (!candidate) return { refusals: [`${agent}/${slotId} has no candidate ${pick}`], scorecard: empty };
    return { refusals: [], scorecard: { ...empty, candidates: [{ rank: 1, candidate: pick, sha256: candidate.sha256, submitted: false, certified: true, verdict: "release.ready", reasons: [] }] } };
  }
  const env = certifyEnv(ctx);
  const rows = slot.candidates.map(candidate => {
    const { submit } = submitOf(slot, candidate.name);
    // The submit's sha256 carried through each later migrate event that rewrote those bytes (records/ledger.ts, the one carry-forward rule).
    const expected = expectedCandidateSha(ledgerEventsOf(slot.ledger?.value) ?? [], candidate.name);
    const submitted = !!submit && expected.submitted && expected.sha256 === candidate.sha256;
    const pinSet = pinSetOf({ slot, candidate }, env);
    const { certified, reasons } = certify({ slot, candidate }, env, pinSet);
    return { candidate: candidate.name, sha256: candidate.sha256, submitted, certified, verdict: "certify" as const, reasons, pinSet, submit };
  });
  const ranked = [...rows].sort((a, b) => Number(b.certified && b.submitted) - Number(a.certified && a.submitted) || a.reasons.length - b.reasons.length || a.candidate.localeCompare(b.candidate));
  const scorecard: Scorecard = { ...empty, candidates: ranked.map(({ submit: _submit, ...row }, index) => ({ rank: index + 1, ...row })) };
  const row = rows.find(each => each.candidate === pick);
  const refusals: string[] = [];
  if (!row) refusals.push(`${agent}/${slotId} has no candidate ${pick}`);
  else {
    if (!row.submit) refusals.push(`${pick} has no submit record in ${agent}/${slotId}/ledger.json: a candidate placed by hand is never pinned (submit it through the candidates verb)`);
    else if (!row.submitted) refusals.push(`${pick} changed since its submit (bytes ${row.sha256.slice(0, 12)}, submitted ${String(row.submit.sha256).slice(0, 12)}): resubmit it as a new version`);
    if (!row.certified) refusals.push(`${pick} has no passing verdict: ${row.reasons.map(reason => `[${reason.code}] ${reason.message}`).join("; ")}`);
  }
  return { refusals, scorecard };
}

/** Writes the scorecard and returns the pin ref citing it. */
export function writeScorecard(root: string, agent: string, slotId: string, scorecard: Scorecard): Ref {
  const dir = join(root, ".clossys", "checks", agent, slotId);
  mkdirSync(dir, { recursive: true });
  const bytes = `${JSON.stringify(scorecard, null, 2)}\n`;
  writeFileSync(join(dir, "scorecard.json"), bytes);
  return { to: SCORECARD_REF_TO, rel: "cites", record: `${agent}/${slotId}`, sha256: sha(bytes) };
}

export const CERTIFY_REPORT_SCHEMA = "clossys.certify/1";
export interface CertifiedOptions {
  /** The slot holds the options its family owes among its submitted, certified candidates. */
  readonly ok: boolean;
  /** Why not (empty when ok). */
  readonly why: readonly string[];
  readonly scorecard: Scorecard;
  /** The options held among the passing candidates, and the options the slot owes. */
  readonly distinct: number;
  readonly options: number;
}

/**
 * loop.create's exit, `candidates.certified` (and loop.choose's rank): every candidate certified as the pin gate
 * judges it, then the submitted, certified ones judged by the CANDIDATE-OPTIONS rules (records/slot-options.ts
 * judgeSlotOptions, the function check:slot-options runs) so the two never drift. `clossys options <ref> --check`
 * runs it; the loop runner verifies it again from the files.
 */
export function certifiedOptions(root: string, consumer: string, agent: string, slotId: string, at: string): CertifiedOptions {
  const { scorecard } = pinGate(root, consumer, agent, slotId, "", at);
  const passing = scorecard.candidates.filter(row => row.submitted && row.certified).map(row => row.candidate);
  const entry = readSlotEntry(consumer, agent as SlotAgent, slotId);
  const judged = entry ? judgeSlotOptions(consumer, entry, OPTION_TABLE, new Set(passing)) : undefined;
  // A slot the options check skips (an unmapped agent with no family) owes one passing candidate.
  const options = judged?.view?.options ?? 1;
  const distinct = judged ? judged.view?.distinct ?? 0 : Math.min(passing.length, 1);
  const why = [
    ...(!entry ? [`${agent}/${slotId} is no live slot`] : []),
    ...(judged?.findings ?? []).map(finding => `[${finding.code}] ${finding.message}`),
    ...(distinct < options && !(judged?.findings ?? []).some(finding => finding.code === "options-short") ? [`holds ${distinct} of ${options} option(s)`] : []),
  ];
  if (why.length) {
    const failing = scorecard.candidates.filter(row => !(row.submitted && row.certified))
      .map(row => `${row.candidate} (${!row.submitted ? "no matching submit record" : row.reasons.map(reason => `[${reason.code}] ${reason.message}`).join("; ")})`);
    why.push(`${passing.length} submitted, certified candidate(s)${passing.length ? ` (${passing.join(", ")})` : ""}`);
    if (failing.length) why.push(`not passing: ${failing.join("; ")}`);
  }
  return { ok: why.length === 0, why, scorecard, distinct, options };
}
