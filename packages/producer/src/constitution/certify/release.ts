/**
 * The release certifier (R05.1, foundry-build-0048 conform K3: a certifier for every held kind, Publisher's `release`
 * among them). A candidate of a release slot `publisher/release.<pub>` is a release manifest
 * (`clossys publisher release <pub> --manifest`), not a publication record, so it is certified by the release criteria
 * (release/ready.ts `releaseCandidateIssues`), not by the publication certifier: the slot is a readable
 * clossys.slot/2 slot, the manifest is readable, code-written and shape-valid, it is for this publication, it recorded
 * every release gate as `pass`, every pin it lists carries a sha256, its build is on disk, digests to its id and sits
 * at its path, the build stamp agrees with it, and its lineage (`previous`, `diff`, header source) recomputes.
 *
 * The slot's standard is judged as for every other kind (certify/index.ts standardReasons): this certifier is the
 * kind fit only. What only the pin decides (the owner's answer, the pins and gates as they are now) is the ready-pin's
 * (`release.ready`), not the candidate's.
 */
import { releaseCandidateIssues } from "../../release/ready.js";
import { publicationOf } from "../../release/paths.js";
import { targetKindOf } from "../../records/standards.js";
import type { CandidateRecord, SlotRecord } from "../types.js";
import { reason, type Reason } from "./types.js";

/** The target kind a release slot carries (clossys.slot/2 `kind`). */
export const RELEASE_KIND = "release";

/** True when the slot's slot.json is a clossys.slot/2 release slot. */
export const isReleaseTargetSlot = (slot: Pick<SlotRecord, "slot">): boolean => targetKindOf(slot.slot?.value) === RELEASE_KIND;

/** Kind fit for a release manifest candidate, against the workspace at `root`. */
export function certifyRelease(slot: SlotRecord, candidate: CandidateRecord, root: string): Reason[] {
  if (slot.agent !== "publisher") return [reason("invalid", `${slot.agent}/${slot.id} is a release slot outside Publisher: a release slot is publisher/release.<publication>`)];
  if (candidate.readError) return [reason("invalid", candidate.readError)];
  return releaseCandidateIssues(root, publicationOf(root, slot.id), candidate.name).issues.map(message => reason("release", message));
}
