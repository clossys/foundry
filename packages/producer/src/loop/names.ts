/**
 * The four Producer loops, their triggers and the checks their exits rest on (producer.md 2-3, flows.md 2 and 4).
 * Pure tables: the loader (version.ts), the runner (runner.ts) and `loop.reachable` read them.
 */
import type { AgentId } from "../records/types.js";

export const LOOP_NAMES = ["loop.fill", "loop.refine", "loop.release", "loop.audit"] as const;
export type LoopName = (typeof LOOP_NAMES)[number];
export const isLoopName = (value: string): value is LoopName => (LOOP_NAMES as readonly string[]).includes(value);

/** `loop.fill` -> `fill`: the candidate name stem and the ledger folder suffix. */
export const loopStem = (loop: LoopName): string => loop.slice("loop.".length);
/** The ledger folder a loop's runs are written to (`ledger.<stem>`). */
export const ledgerOf = (loop: LoopName): string => `ledger.${loopStem(loop)}`;

/** flows.md 2: the trigger kinds, as the ledger entry's `trigger.kind` names them. */
export const TRIGGER_KINDS: Readonly<Record<string, string>> = {
  T1: "init",
  T2: "starter-fill",
  T3: "tighten-brief",
  T4: "add-l3",
  T5: "owner-feedback",
  T6: "failed-check",
  T7: "upstream-cascade",
  T8: "new-release",
};

/** flows.md 2 and 4: the triggers each loop may start from. A version's `trigger` must be a non-empty subset. */
export const LOOP_TRIGGERS: Readonly<Record<LoopName, readonly string[]>> = {
  "loop.fill": ["T1", "T2", "T4"],
  "loop.refine": ["T3", "T5", "T6", "T7"],
  "loop.release": ["T8"],
  "loop.audit": ["T6"],
};

/** Each loop's run needs a slot (fill, refine), a publication (release) or neither (audit). */
export const LOOP_SUBJECT: Readonly<Record<LoopName, "slot" | "publication" | "none">> = {
  "loop.fill": "slot",
  "loop.refine": "slot",
  "loop.release": "publication",
  "loop.audit": "none",
};

/**
 * The checks a loop's exit rests on. Each must sit on a step that runs whatever the slot (no `when`), or the
 * exit can be reached without it: fill and refine end on a resolving pin, release on the ready-pin, audit on
 * the orphan and dangling-ref checks.
 */
export const EXIT_CHECKS: Readonly<Record<LoopName, readonly string[]>> = {
  "loop.fill": ["pins.resolve"],
  "loop.refine": ["pins.resolve"],
  "loop.release": ["release.ready"],
  "loop.audit": ["ia.orphans", "refs.dangling"],
};

/** The release ready-pin check: the last step of `loop.release`, after an owner sign-off. */
export const RELEASE_READY = "release.ready";

/** The five live agents a step's decider may name (plus the owner, and the per-slot placeholder). */
export const LIVE_AGENTS: readonly AgentId[] = ["director", "designer", "writer", "publisher", "producer"];
export const OWNER_OF_SLOT = "<owner of slot>";

/** flows.md N3: chain order. Director first, then Designer and Writer, then Publisher (Producer last). */
export const CHAIN_ORDER: Readonly<Record<AgentId, number>> = { director: 0, designer: 1, writer: 1, publisher: 2, producer: 3 };

/**
 * The owner picks some slots directly (flows.md F2: Director slots and legal prose). A human `queue.pick` step is the
 * pinning step for every slot its `when` matches: it comes before the agent `pick` step, checks `pins.resolve`
 * itself, and the agent `pick` step does not run for those slots, so no agent pin is written before the owner's pick.
 */
export const OWNER_PICK_RAISE = "queue.pick";
export const AGENT_PICK_VERB = "pick";

/**
 * Checks `clossys run` computes itself instead of taking a step's exit for them: `pins.resolve` (the slot's pin, or
 * every consumer pin for a run with no slot, resolves to its candidate bytes) and `release.ready` (the publication's
 * pin is the owner's and names the manifest this run wrote). An agent's `--step-exit 0` never passes them.
 */
export const VERIFIED_CHECKS: readonly string[] = ["pins.resolve", RELEASE_READY];

/** The release steps that must run, for every publication, before the owner's sign-off (cli prefix match). */
export const RELEASE_BEFORE_SIGNOFF: readonly { readonly id: string; readonly cli: RegExp }[] = [
  { id: "compile", cli: /^clossys compile(\s|$)/ },
  { id: "build", cli: /^clossys release <pub> --build(\s|$)/ },
  { id: "gates", cli: /^clossys release <pub> --gates(\s|$)/ },
];

/** Ids a run takes from its caller, checked before any is used in a path or an argv (B8). */
export const RUN_ID = /^[0-9]{8}T[0-9]{4}Z-[a-z0-9][a-z0-9-]*$/;
export const PUBLICATION_ID = /^[a-z][a-z0-9-]*$/;
export const SLOT_REF = /^(director|designer|writer|publisher|producer)\/[a-z][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*){1,3}$/;
export const ENTRY_NAME = /^queue\.(pick|approve|clarify|fix)#[0-9]{8}T[0-9]{4}Z-[a-z0-9][a-z0-9-]*$/;
export const CANDIDATE_NAME = /^[a-z0-9][a-z0-9.-]*-v[1-9][0-9]*\.(md|json|svg)$/;
export const TRIGGER_CODE = /^T[1-8]$/;
