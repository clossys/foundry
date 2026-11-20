/**
 * `clossys release <pub> --manifest` (publisher.md 9.4.3, flows.md F8 step 3): the release candidate
 * `publisher/release.<pub>/candidates/<pub>-v<n>.json`, written by code. It lists exactly what went in: the build
 * (id = the output digest), every pin the build read with its full sha256, the gate results, the ready version it
 * follows and the pin diff against it. Candidates are immutable, so a changed release is a new `-v<n>`; a manifest
 * identical to the latest one (same build, pins and gate results) is not written again.
 *
 * Refuses when there is no release slot, no build, a build whose bytes no longer match its id, or pins that changed
 * since the build (build again).
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { buildCandidateHeader, candidatePath, parseCandidateName, readCandidateFile, serializeCandidate } from "../records/candidate.js";
import { sha256Hex } from "../records/hash.js";
import { actionContractPath } from "../records/ledger.js";
import { cliActor, toIsoZ } from "../records/pin.js";
import { resolveSlot } from "../records/resolve.js";
import { writeCandidateBytes } from "../records/slot-write.js";
import { readSlotEntry } from "../records/slots.js";
import type { ModelAgent } from "../records/slot-model/index.js";
import { canonical } from "../records/slot-model/layout.js";
import type { CandidateHeader } from "../records/types.js";
import { buildIssue, latestBuild, type BuildExport } from "./build.js";
import { runGates, type GateStatus } from "./gates.js";
import { readReleaseSlot } from "./locales.js";
import { currentPins, pinDiff, type PinMapOf } from "./pins.js";
import { releaseDir, releaseSlotId } from "./paths.js";

export interface ManifestContent {
  readonly publication: string;
  readonly build: { readonly id: string; readonly path: string; readonly routes: number; readonly locales: readonly string[]; readonly exports: readonly BuildExport[] };
  readonly pins: PinMapOf;
  readonly checks: Record<string, GateStatus>;
  readonly previous: string | null;
  readonly diff: readonly { readonly ref: string; readonly from: string | null; readonly to: string | null }[];
}

export interface ManifestFile {
  readonly name: string;
  readonly file: string;
  readonly sha256: string;
  readonly header?: CandidateHeader;
  readonly content?: ManifestContent;
  readonly issues: readonly string[];
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** Shape issues of a manifest's content (the fields release.ready reads). */
export function manifestContentIssues(content: unknown): string[] {
  if (!isObject(content)) return ["content is not an object"];
  const issues: string[] = [];
  if (typeof content.publication !== "string") issues.push("content.publication is missing");
  const build = content.build;
  if (!isObject(build) || typeof build.id !== "string" || typeof build.path !== "string" || !Array.isArray(build.locales)) issues.push("content.build needs id, path and locales");
  if (!isObject(content.pins) || Object.values(content.pins).some(value => typeof value !== "string")) issues.push("content.pins is not a map of ref to <candidate>@<sha256>");
  if (!isObject(content.checks) || Object.values(content.checks).some(value => value !== "pass" && value !== "fail")) issues.push("content.checks is not a map of gate to pass|fail");
  return issues;
}

/** The publication's manifest file names (`<pub>-v<n>.json`), oldest first. */
export function manifestNames(root: string, publication: string): string[] {
  const dir = join(releaseDir(root, publication), "candidates");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter(name => parseCandidateName(name)?.name === publication && name.endsWith(".json"))
    .sort((a, b) => parseCandidateName(a)!.version - parseCandidateName(b)!.version);
}

export function readManifest(root: string, publication: string, name: string): ManifestFile {
  const slotId = releaseSlotId(root, publication);
  const file = candidatePath(root, "publisher", slotId, name);
  if (parseCandidateName(name)?.name !== publication || !name.endsWith(".json")) return { name, file, sha256: "", issues: [`${name} is not a manifest of ${publication} (${publication}-v<n>.json)`] };
  if (!existsSync(file)) return { name, file, sha256: "", issues: [`publisher/${slotId} has no candidate ${name}`] };
  const read = readCandidateFile(file, { agent: "publisher", slotId });
  const issues = [...read.issues];
  let content: unknown;
  try { content = (JSON.parse(readFileSync(file, "utf8")) as { content?: unknown }).content; } catch (error) { issues.push(`not JSON: ${(error as Error).message}`); }
  issues.push(...manifestContentIssues(content));
  if (read.header && read.header.createdBy.actor !== "code") issues.push(`${name} was not written by code (createdBy ${read.header.createdBy.actor}): a manifest is computed`);
  return { name, file, sha256: read.sha256, ...(read.header ? { header: read.header } : {}), ...(issues.length === 0 ? { content: content as ManifestContent } : {}), issues };
}

export function latestManifest(root: string, publication: string): ManifestFile | undefined {
  const names = manifestNames(root, publication);
  return names.length ? readManifest(root, publication, names[names.length - 1]!) : undefined;
}

/** The ready version a new manifest follows: the release slot's pinned candidate, if it resolves. */
function readyVersion(root: string, publication: string): ManifestFile | undefined {
  const resolved = resolveSlot(root, "publisher", releaseSlotId(root, publication));
  return resolved.state === "pinned" ? readManifest(root, publication, resolved.candidate) : undefined;
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

export interface WrittenManifest {
  readonly name: string;
  readonly file: string;
  /** `publisher/<release slot>/candidates/<name>`, as a ledger step's `wrote` names it. */
  readonly rel: string;
  readonly sha256: string;
  readonly content: ManifestContent;
  /** True when the latest manifest already said the same and nothing was written. */
  readonly reused: boolean;
}

/**
 * Reads every shipped pin's slot through the model reader (records/slots.ts readSlotEntry) before the manifest is
 * written: an aliased or unreadable pin.json refuses the manifest, so that pin never ships (U29b). The candidate
 * writer reads only its own slot, so this is the manifest's own read of the slots it ships, not a sibling scan.
 */
function readShippedSlots(root: string, pins: PinMapOf): void {
  const consumer = join(root, "clossys");
  for (const ref of Object.keys(pins)) {
    const [agent, slotId] = ref.split("#")[0]!.split("/") as [ModelAgent, string];
    readSlotEntry(consumer, agent, slotId);
  }
}

export function writeManifest(root: string, publication: string, options: { now?: () => Date } = {}): WrittenManifest {
  const slotId = releaseSlotId(root, publication);
  const slot = readReleaseSlot(root, publication);
  if (!slot) throw new Error(`publisher/${slotId} has no readable slot.json: no release slot for ${publication}`);
  const build = latestBuild(root, publication);
  if (!build) throw new Error(`${publication} has no build: run clossys release ${publication} --build`);
  const issue = buildIssue(root, build.id);
  if (issue) throw new Error(`${issue}: run clossys release ${publication} --build`);
  const pins = currentPins(root);
  const drift = pinDiff(build.pins, pins);
  if (drift.length) throw new Error(`pins changed since build ${build.id.slice(0, 12)} (${drift.map(row => row.ref).join(", ")}): run clossys release ${publication} --build`);
  const gates = runGates(root, publication, build);
  const ready = readyVersion(root, publication);
  const content: ManifestContent = {
    publication,
    build: { id: build.id, path: build.path, routes: build.routes, locales: [...build.locales], exports: build.exports.map(row => ({ ...row })) },
    pins,
    checks: gates.checks,
    previous: ready?.content ? ready.name : null,
    diff: pinDiff(ready?.content?.pins ?? {}, pins),
  };
  const latest = latestManifest(root, publication);
  const rel = (name: string) => `publisher/${slotId}/candidates/${name}`;
  if (latest?.content && same({ ...latest.content, previous: null, diff: [] }, { ...content, previous: null, diff: [] })) {
    return { name: latest.name, file: latest.file, rel: rel(latest.name), sha256: latest.sha256, content: latest.content, reused: true };
  }
  const names = manifestNames(root, publication);
  const next = names.length ? parseCandidateName(names[names.length - 1]!)!.version + 1 : 1;
  const name = `${publication}-v${next}.json`;
  const at = toIsoZ((options.now ?? (() => new Date()))().toISOString())!;
  const header = buildCandidateHeader({
    agent: "publisher", slotId, name, createdBy: cliActor(`clossys release ${publication} --manifest`), createdAt: at,
    briefSha256: sha256Hex(JSON.stringify(canonical(slot.brief ?? null))),
    source: content.previous ? { kind: "derived", ref: [rel(content.previous).replace("/candidates/", "/")] } : { kind: "original", ref: [] },
  });
  const file = candidatePath(root, "publisher", slotId, name);
  readShippedSlots(root, pins);
  // The one candidate writer (records/slot-write.ts): the file and its `submit {name, sha256}` event land under the slot
  // lock, so R14.1 and the pin gate find the manifest's provenance like every other candidate's. The event cites the
  // plumb action that runs the release (publisher.release), by Producer code.
  const { sha256 } = writeCandidateBytes(join(root, "clossys"), "publisher", slotId, name, serializeCandidate(name, header, content), {
    at, fields: { reason: `clossys release ${publication} --manifest: build ${build.id.slice(0, 12)}` },
  }, { verb: "submit", by: "producer", skill: actionContractPath("producer", "publisher.release") });
  return { name, file, rel: rel(name), sha256, content, reused: false };
}
