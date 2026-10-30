import { createHash } from "node:crypto";
import { expect, it, vi } from "vitest";
import { PublisherPlanStore, alignedPlanItems, projectPlanInstances } from "./change-set.js";
import { canonicalPlanJson } from "./digest.js";
import type { PublisherPlanDraft } from "./plan.js";
import { STANDARD_PACK_INSTANCES, STANDARD_PACK_REGISTRIES } from "../web/publisher/__fixtures__/standard-website.js";
const draft = (version = 1): PublisherPlanDraft => ({ schemaVersion: 1, menuVersion: 2, id: "example", version, status: "draft", currentMilestone: "M1", answerIds: ["answer.first-impression"], milestones: [{ id: "M1", packs: [{ id: "pack.standard-website", items: [{ id: "home", menuRef: "website.home", lane: "Landing", instanceId: "standard.home", answerIds: ["answer.first-impression"], openNeeds: [] }] }] }] });

it("aligns an immutable exact snapshot through the explicit host apply callback once", async () => {
  const store = new PublisherPlanStore(STANDARD_PACK_REGISTRIES), input = draft(), change = store.propose(input), apply = vi.fn(() => true);
  expect(projectPlanInstances(input, STANDARD_PACK_INSTANCES)).toEqual([]);
  expect(store.versions).toEqual([]);
  const next = await store.apply(change, apply);
  expect(apply).toHaveBeenCalledWith(change, next);
  expect(next.digest).toBe(`sha256:${createHash("sha256").update(canonicalPlanJson(change.proposedPlan)).digest("hex")}`);
  expect(Object.isFrozen(next.milestones[0]!.packs[0]!.items[0])).toBe(true);
  expect(projectPlanInstances(next, STANDARD_PACK_INSTANCES).map(item => item.instanceId)).toEqual(["standard.home"]);
  await expect(store.apply(change, apply)).rejects.toThrow("Stale");
  expect(store.versions).toHaveLength(1);
  expect(apply).toHaveBeenCalledTimes(1);
});
it.each(["denied", "rejected"])("creates no aligned version after host %s", async outcome => {
  const store = new PublisherPlanStore(STANDARD_PACK_REGISTRIES), change = store.propose(draft());
  await expect(store.apply(change, () => outcome === "denied" ? false : Promise.reject(new Error("apply failed")))).rejects.toThrow();
  expect(store.versions).toEqual([]);
  expect(alignedPlanItems(store.current)).toEqual([]);
});
it("refuses edited proposals and stale digests before host approval", async () => {
  const store = new PublisherPlanStore(STANDARD_PACK_REGISTRIES), change = store.propose(draft()), apply = vi.fn(() => true);
  const edited = structuredClone(change);
  Object.assign(edited.proposedPlan, { answerIds: ["answer.first-impression", "unapproved-answer"] });
  await expect(store.apply(edited, apply)).rejects.toThrow("Edited");
  await expect(store.apply({ ...change, baseDigest: "wrong" }, apply)).rejects.toThrow("Stale");
  expect(apply).not.toHaveBeenCalled();
});
it("keeps aligned items stable while a later draft awaits approval and refuses concurrent apply", async () => {
  const store = new PublisherPlanStore(STANDARD_PACK_REGISTRIES);
  const first = await store.apply(store.propose(draft()), () => true);
  const secondDraft: PublisherPlanDraft = { ...draft(2), milestones: [{ id: "M1", packs: [] }] };
  const change = store.propose(secondDraft);
  expect(projectPlanInstances(store.current, STANDARD_PACK_INSTANCES)).toHaveLength(1);
  let accept!: (value: boolean) => void;
  const pending = store.apply(change, () => new Promise(resolve => { accept = resolve; }));
  await expect(store.apply(change, () => true)).rejects.toThrow("pending");
  expect(store.current).toBe(first);
  accept(true);
  await pending;
  expect(store.versions).toHaveLength(2);
  expect(projectPlanInstances(first, STANDARD_PACK_INSTANCES)).toHaveLength(1);
  expect(projectPlanInstances(store.current, STANDARD_PACK_INSTANCES)).toEqual([]);
});
it("never projects concept-only items into a renderer even after alignment", async () => {
  const store = new PublisherPlanStore(STANDARD_PACK_REGISTRIES);
  const plan: PublisherPlanDraft = { ...draft(), currentMilestone: "M2", milestones: [{ id: "M2", packs: [{ id: "pack.conversation", items: [{ id: "email", menuRef: "conversation.email", lane: "Email", answerIds: ["answer.first-impression"], openNeeds: [], format: "email.html" }] }] }] };
  const next = await store.apply(store.propose(plan), () => true);
  expect(next.milestones[0]!.packs[0]!.items).toHaveLength(1);
  expect(alignedPlanItems(next)).toEqual([]);
  expect(projectPlanInstances(next, STANDARD_PACK_INSTANCES)).toEqual([]);
});
