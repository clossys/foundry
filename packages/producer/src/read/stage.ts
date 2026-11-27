/**
 * Where the engagement stands, for `clossys status --json` (foundry-build-0048 CP1-FRONTDOOR): `next`, the step a
 * resumed session runs first, and `stage`, the engagement stage. Both are derived from records alone, the same bytes
 * for the same files, with no model involved.
 *
 * `next` is the step `clossys run --dry` stops at (src/pipeline/chain.ts runChain): its step id, the agent whose round
 * runs it, the skill it runs under, its kind, the model tier its subagent uses (plumb none, decide:judgment mid,
 * decide:creative high) and that tier's model from `clossys/seat-policy.json` (null while the policy is missing,
 * invalid, human-only or names no model for the tier: a model id is never guessed). Null when nothing is open.
 *
 * `stage`, the first rule that holds:
 *   setup     next is the Producer's own (the workspace config, seats, seat policy and loops);
 *   strategy  next is the Director's;
 *   fill      next is a Designer or Writer step, or a Publisher step that is not a release;
 *   release   next is a Publisher release step or slot;
 *   review    nothing is open, and a slot waits for the owner's confirm, fails or needs a refresh, or a queue entry is open;
 *   release   nothing is open or in review, and a release is unpinned or stale;
 *   refine    the chain is done: what is left is owner refinement, routed as `clossys request --kind change`.
 */
import type { Step } from "../pipeline/define.js";
import { INTERVIEW_AGENTS, agentOfItem, runChain, type InterviewAgent } from "../pipeline/chain.js";
import { policyModels, readSeatPolicy } from "../pipeline/seat-policy.js";
import type { StatusView } from "../records/types.js";

export const STAGES = ["setup", "strategy", "fill", "review", "release", "refine"] as const;
export type Stage = typeof STAGES[number];
export const STEP_TIERS = ["none", "mid", "high"] as const;
export type StepTier = typeof STEP_TIERS[number];

export interface NextStep {
  readonly step: string;
  readonly agent: string;
  readonly skill: string;
  readonly kind: Step["kind"];
  readonly tier: StepTier;
  readonly model: string | null;
}

/** The model tier a step's subagent uses, from its kind alone. */
export function tierOfKind(kind: Step["kind"]): StepTier {
  if (kind === "decide:creative") return "high";
  if (kind === "decide:judgment") return "mid";
  return "none";
}

/** The tier's model in the workspace seat policy; null for tier none or while the policy names none for it. */
export function modelOfTier(root: string, tier: StepTier): string | null {
  if (tier === "none") return null;
  return policyModels(readSeatPolicy(root))[tier] ?? null;
}

/** The step `clossys run --dry` stops at, with its tier and model; null when the chain has nothing open. */
export function nextStep(root: string, steps: readonly Step[], packageRoot: string): NextStep | null {
  const stop = runChain(root, { steps, packageRoot, dry: true }).stop;
  return stop ? nextOfStop(root, steps, stop) : null;
}

const isRelease = (next: NextStep, item: string): boolean => next.step.startsWith("release") || /^publisher\/release\./.test(item);

/** The engagement stage (the rules in this file's header), from `next`, the item it stopped at and the read model. */
export function stageOf(view: Pick<StatusView, "agents" | "queue" | "releases">, next: NextStep | null, item: string | null): Stage {
  if (next) {
    if (next.agent === "producer") return "setup";
    if (next.agent === "director") return "strategy";
    if (next.agent === "publisher" && isRelease(next, item ?? "")) return "release";
    return "fill";
  }
  const waiting = Object.values(view.agents).some(row => row.byState.confirm + row.byState.failing + row.byState.needsRefresh > 0);
  if (waiting || view.queue.length > 0) return "review";
  if (view.releases.some(release => release.pinned === null || release.stale)) return "release";
  return "refine";
}

/** `stage` and `next` together, from one dry walk. */
export function whereWeStand(root: string, view: Pick<StatusView, "agents" | "queue" | "releases">, steps: readonly Step[], packageRoot: string): { stage: Stage; next: NextStep | null } {
  const stop = runChain(root, { steps, packageRoot, dry: true }).stop;
  const next = stop ? nextOfStop(root, steps, stop) : null;
  return { stage: stageOf(view, next, stop?.packet.item ?? null), next };
}

/**
 * The agent whose round runs the stop: an item that is an agent itself (the IA step stops on `director`, `designer`, ...)
 * is that agent's; any other item resolves as the packet does (src/pipeline/chain.ts agentOfItem). A step with a skill
 * contract runs under it; any other runs in its agent's own round (`clossys-<agent>`).
 */
function nextOfStop(root: string, steps: readonly Step[], stop: NonNullable<ReturnType<typeof runChain>["stop"]>): NextStep {
  const step = steps.find(each => each.id === stop.step);
  if (!step) throw new Error(`run --dry stopped at ${stop.step}, which no step defines`);
  const item = stop.packet.item;
  const agent = (INTERVIEW_AGENTS as readonly string[]).includes(item) ? item as InterviewAgent : agentOfItem(step, item);
  const tier = tierOfKind(step.kind);
  return { step: step.id, agent, skill: stop.packet.skill.path || `clossys-${agent}`, kind: step.kind, tier, model: modelOfTier(root, tier) };
}
