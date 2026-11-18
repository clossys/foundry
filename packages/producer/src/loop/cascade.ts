/**
 * The CASCADE step (`clossys check <dependants>`, foundry-build-0048 U6): after a repin, every pinned candidate whose
 * pinSet changed is judged again on the pinSet now (constitution/cascade.ts, R07.5), through the one certifier.
 *
 * - A re-verdict is written to `.clossys/checks/<agent>/<slot>/cascade.json` (`clossys.reverdict/1`).
 * - A pass leaves the slot as it is (a `needs-refresh` slot whose every pin passes goes back to `live`).
 * - A failure marks the slot `needs-refresh` and is a finding (`cascade.reverdict`) for the slot's owner: CHOOSE when
 *   another submitted candidate certifies on the pinSet now, else CREATE. The loop routes it as a kind fix with its cause.
 * - Rounds repeat until no pin is stale (a fixed point); past `maxRounds` the cascade is not clean and the caller
 *   raises a `queue.clarify`.
 * - A dependant with no recorded verdict (a legacy pin, or no pin) named by the cause's `consumedBy` refs is marked
 *   `needs-refresh` when the cause repinned, as before (flows.md F7 step 1).
 */
import { join, relative } from "node:path";
import { buildContext } from "../constitution/context.js";
import { certifyEnv } from "../constitution/certify/index.js";
import { certifiedAlternatives, NEEDS_REFRESH, pinChecks, pinnedEntries, recordedVerdict, reverdictOf, slotStatus, writeReverdict, type PinCheck, type PinVerdict, CASCADE_REVERDICT } from "../constitution/cascade.js";
import { liveSlotRecords } from "../constitution/checks/shared.js";
import type { ConstitutionContext } from "../constitution/types.js";
import { writeSlot } from "../records/slot.js";
import type { AgentId, Iso } from "../records/types.js";
import type { Finding } from "./route.js";
import { dependantsOf, readSubject, refOf, type SlotSubject } from "./slots.js";

export interface CascadeRun {
  /** Rounds run (the last one found nothing stale, unless `converged` is false). */
  readonly rounds: number;
  readonly converged: boolean;
  /** Every slot re-verdicted, with its verdicts. */
  readonly reverdicted: readonly { readonly slot: string; readonly verdicts: readonly PinVerdict[] }[];
  /** One per failing slot: routed to its owner as a kind fix. */
  readonly findings: readonly Finding[];
  /** Workspace-relative files the step wrote (agent-tree files as `<agent>/<slot>/...`, checks under `.clossys/`). */
  readonly wrote: readonly string[];
  /** Slots still stale after the last round (when not converged). */
  readonly stale: readonly string[];
}

const consumerOf = (root: string) => join(root, "clossys");
const contextOf = (root: string): ConstitutionContext => buildContext(root, consumerOf(root));
const ref = (check: Pick<PinCheck, "slot">) => `${check.slot.agent}/${check.slot.id}`;

/** Sets a slot/2's status; returns the agent-tree path written, if it changed. */
function setStatus(root: string, agent: string, slotId: string, status: "live" | typeof NEEDS_REFRESH, at: Iso): string | undefined {
  const subject = readSubject(root, agent as AgentId, slotId);
  if (!subject || subject.slot.status === status) return undefined;
  if (status === "live" && subject.slot.status !== NEEDS_REFRESH) return undefined;
  const file = join(consumerOf(root), "agents", agent, slotId, "slot.json");
  return writeSlot(file, { ...subject.slot, status, updatedAt: at }) ? `${agent}/${slotId}/slot.json` : undefined;
}

/** Re-verdicts stale pins to a fixed point. `cause` is the slot whose repin started it, when one did. */
export function runCascade(root: string, at: Iso, options: { readonly maxRounds: number; readonly cause?: SlotSubject; readonly repinned?: boolean }): CascadeRun {
  const wrote: string[] = [];
  const findings: Finding[] = [];
  const reverdicted: { slot: string; verdicts: PinVerdict[] }[] = [];
  const failed = new Map<string, Finding>();
  let rounds = 0;
  let stale: string[] = [];
  const maxRounds = Math.max(1, options.maxRounds);
  // One round past maxRounds only looks: a pin still stale there means the cascade did not reach a fixed point.
  for (let round = 1; round <= maxRounds + 1; round++) {
    const ctx = contextOf(root);
    const env = certifyEnv(ctx);
    const checks = pinChecks(ctx, env, liveSlotRecords(ctx));
    const targets = checks.filter(check => check.state === "stale");
    stale = [...new Set(targets.map(ref))];
    if (!targets.length || round > maxRounds) break;
    rounds = round;
    const bySlot = new Map<string, PinCheck[]>();
    for (const check of targets) bySlot.set(ref(check), [...(bySlot.get(ref(check)) ?? []), check]);
    for (const [slot, list] of bySlot) {
      const record = list[0]!.slot;
      // Every pin of the slot is judged again, so the re-verdict file holds the whole slot's verdicts.
      const all = checks.filter(check => ref(check) === slot);
      const verdicts = all.map(check => reverdictOf(check, env));
      const file = writeReverdict(root, record.agent, record.id, { schema: "clossys.reverdict/1", slot, at, ...(options.cause ? { cause: refOf(options.cause) } : {}), verdicts });
      wrote.push(relative(root, file));
      reverdicted.push({ slot, verdicts });
      const failing = verdicts.filter(verdict => !verdict.certified);
      if (failing.length) {
        const written = setStatus(root, record.agent, record.id, NEEDS_REFRESH, at);
        if (written) wrote.push(written);
        const alternatives = certifiedAlternatives(record, pinnedEntries(record).map(entry => entry.candidate.name), env);
        const handTo = alternatives.length ? `run loop.choose (submitted, certified on the pinSet now: ${alternatives.join(", ")})` : "run loop.create (no other submitted candidate certifies on the pinSet now)";
        const why = failing.map(verdict => `${verdict.candidate}${verdict.record ? ` (#${verdict.record})` : ""}: ${verdict.reasons.map(reason => `[${reason.code}] ${reason.message}`).join("; ") || "uncertified"}`).join("; ");
        failed.set(slot, { check: CASCADE_REVERDICT, subject: slot, detail: `pinned candidate fails its re-verdict after ${options.cause ? `${refOf(options.cause)} repinned` : "a repin upstream"}: ${why}; ${handTo}` });
      } else {
        failed.delete(slot);
        const written = slotStatus(record) === NEEDS_REFRESH ? setStatus(root, record.agent, record.id, "live", at) : undefined;
        if (written) wrote.push(written);
      }
    }
  }
  findings.push(...failed.values());
  const converged = stale.length === 0;

  const cause = options.cause;
  if (cause) {
    // Legacy dependants (no recorded verdict) of the cause's consumedBy refs: marked as before when the cause repinned.
    if (options.repinned) {
      for (const dependant of dependantsOf(root, cause)) {
        if (dependant.slot.status === "retired" || dependant.slot.status === "parked" || dependant.slot.status === NEEDS_REFRESH) continue;
        const ctx = contextOf(root);
        const record = ctx.agents.find(agent => agent.agent === (dependant.agent as string))?.slots.get(dependant.slotId);
        const scored = record ? pinnedEntries(record).some(entry => recordedVerdict(root, record, entry.candidate) !== undefined) : false;
        if (scored) continue;
        const written = setStatus(root, dependant.agent, dependant.slotId, NEEDS_REFRESH, at);
        if (written) wrote.push(written);
      }
    }
    // flows.md F7 step 2: a needs-refresh slot whose run ends with every pin passing (or no recorded verdict) goes back to live.
    const now = readSubject(root, cause.agent, cause.slotId);
    if (now?.slot.status === NEEDS_REFRESH) {
      const ctx = contextOf(root);
      const record = ctx.agents.find(agent => agent.agent === (cause.agent as string))?.slots.get(cause.slotId);
      const own = record ? pinChecks(ctx, certifyEnv(ctx), [record]) : [];
      if (own.every(check => check.state === "fresh" || check.state === "legacy")) {
        const written = setStatus(root, cause.agent, cause.slotId, "live", at);
        if (written) wrote.push(written);
      }
    }
  }
  return { rounds, converged, reverdicted, findings, wrote: [...new Set(wrote)], stale };
}

/** `cascade.clean`, computed from the files: no stale pin and no failing pin anywhere in the workspace. */
export function cascadeClean(root: string): { ok: true } | { ok: false; why: string } {
  const ctx = contextOf(root);
  const bad = pinChecks(ctx, certifyEnv(ctx), liveSlotRecords(ctx)).filter(check => check.state === "stale" || check.state === "failed");
  if (!bad.length) return { ok: true };
  return { ok: false, why: `cascade.clean: ${bad.map(check => `${ref(check)} ${check.candidate.name} is ${check.state}`).join("; ")}` };
}
