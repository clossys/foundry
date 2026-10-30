import type { FlowInstanceBinding as InstanceBinding, InstanceRegistries } from "../core/instance-binding.js";
import { freeze } from "../layouts/resolve.js";
import { canonicalPlanJson, sha256 } from "./digest.js";
import { createPublisherPlanDraft } from "./plan.js";
import type { PublisherPlanDraft, PublisherPlanItem } from "./plan.js";
import { PUBLISHER_MENU } from "./menu.js";

export interface PublisherPlanVersion extends Omit<PublisherPlanDraft, "status"> {
  readonly status: "aligned";
  readonly digest: string;
}
export interface PublisherPlanChangeSet {
  readonly baseVersion: number;
  readonly baseDigest: string | null;
  readonly proposedPlan: PublisherPlanDraft;
  readonly changes: readonly [{ readonly op: "align-plan"; readonly planId: string; readonly version: number; readonly digest: string }];
}
/** The host explicitly accepts and durably applies the exact immutable snapshot, or refuses. */
export type PublisherPlanApply = (change: PublisherPlanChangeSet, version: PublisherPlanVersion) => boolean | Promise<boolean>;
const digest = (plan: PublisherPlanDraft) => `sha256:${sha256(canonicalPlanJson(plan))}`;
function draftOf(version: PublisherPlanVersion): PublisherPlanDraft {
  const { digest: _digest, ...plan } = version;
  return { ...plan, status: "draft" };
}

/** Per-consumer history. Only apply can append; asynchronous approval cannot race another apply. */
export class PublisherPlanStore {
  #versions: readonly PublisherPlanVersion[] = Object.freeze([]);
  #applying = false;
  #listeners = new Set<() => void>();
  subscribe = (listener: () => void): (() => void) => { this.#listeners.add(listener); return () => { this.#listeners.delete(listener); }; };
  snapshot = (): readonly PublisherPlanVersion[] => this.#versions;
  constructor(readonly registries: InstanceRegistries, versions: readonly PublisherPlanVersion[] = []) {
    for (const version of versions) {
      const proposed = createPublisherPlanDraft(draftOf(version), registries);
      if (version.status !== "aligned" || version.digest !== digest(proposed) || proposed.version !== this.#versions.length + 1 || this.current && this.current.id !== proposed.id) throw new Error("Invalid aligned plan history");
      this.#versions = Object.freeze([...this.#versions, freeze(structuredClone(version))]);
    }
  }
  get versions(): readonly PublisherPlanVersion[] { return this.#versions; }
  get current(): PublisherPlanVersion | undefined { return this.#versions.at(-1); }
  propose(draft: PublisherPlanDraft): PublisherPlanChangeSet {
    const proposedPlan = createPublisherPlanDraft(draft, this.registries);
    if (draft.version !== (this.current?.version ?? 0) + 1 || this.current && draft.id !== this.current.id) throw new Error("Plan must create the next version of this history");
    return freeze({ baseVersion: this.current?.version ?? 0, baseDigest: this.current?.digest ?? null, proposedPlan,
      changes: [{ op: "align-plan", planId: draft.id, version: draft.version, digest: digest(proposedPlan) }] });
  }
  async apply(change: PublisherPlanChangeSet, hostApply: PublisherPlanApply): Promise<PublisherPlanVersion> {
    if (this.#applying) throw new Error("Plan alignment already pending");
    if (change.baseVersion !== (this.current?.version ?? 0) || change.baseDigest !== (this.current?.digest ?? null)) throw new Error("Stale plan ChangeSet base");
    const expected = this.propose(change.proposedPlan);
    if (change.baseVersion !== expected.baseVersion || change.baseDigest !== expected.baseDigest) throw new Error("Stale plan ChangeSet base");
    if (canonicalPlanJson(change) !== canonicalPlanJson(expected)) throw new Error("Edited plan ChangeSet snapshot");
    const next: PublisherPlanVersion = freeze({ ...structuredClone(expected.proposedPlan), status: "aligned", digest: expected.changes[0].digest });
    this.#applying = true;
    try {
      if (typeof hostApply !== "function" || await hostApply(expected, next) !== true) throw new Error("Host refused plan alignment");
      this.#versions = Object.freeze([...this.#versions, next]);
      this.#listeners.forEach(listener => listener());
      return next;
    } finally { this.#applying = false; }
  }
}
export interface AlignedPlanItem { readonly milestone: PublisherPlanVersion["currentMilestone"]; readonly packId: string; readonly item: PublisherPlanItem }
/** Only an aligned version can project production items. Concept wishes stay in the plan view. */
export function alignedPlanItems(plan?: PublisherPlanDraft | PublisherPlanVersion): readonly AlignedPlanItem[] {
  if (plan?.status !== "aligned") return [];
  return plan.milestones.flatMap(m => m.packs.flatMap(pack => pack.items.filter(item => PUBLISHER_MENU.find(menu => menu.id === item.menuRef)?.status === "built").map(item => ({ milestone: m.id, packId: pack.id, item }))));
}
export function projectPlanInstances(plan: PublisherPlanDraft | PublisherPlanVersion | undefined, instances: readonly InstanceBinding[]): readonly InstanceBinding[] {
  const allowed = new Set(alignedPlanItems(plan).map(row => row.item.instanceId).filter(Boolean));
  return instances.filter(instance => allowed.has(instance.instanceId));
}
