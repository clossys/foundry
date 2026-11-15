/**
 * The ready-pin and `release.ready` (flows.md F8 step 6, publisher.md 9.4.3). A release version is ready when its
 * slot `publisher/release.<pub>` pins the manifest (pin/2) and every one of these holds, now:
 *
 * - the pin is the owner's answer: `decidedBy owner:queue.approve#<id>`, basis `picked`, the entry answered
 *   `ready` by the owner, about `publisher/release.<pub>`, raised and answered after the manifest was written;
 * - the pin's sha256 is the manifest file's sha256 and the manifest's header is a code-written candidate;
 * - the manifest recorded every release gate, all `pass`, and every gate passes again now;
 * - the manifest's pins are exactly the pins as they resolve now (a later pin change voids the ready-pin);
 * - the build the manifest names is on disk, digests to its id and read the same pins.
 *
 * `readyFindings` judges a pin before it is written (`clossys pin` refuses a release pin with findings); the
 * `release.ready` check judges the pins on disk. Both fail closed: anything unreadable is a finding.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { findQueueEntry, readQueueEntry } from "../queue/entry.js";
import { slotDir } from "../records/candidate.js";
import { OWNER_QUEUE_ANSWER, PIN_FILE } from "../records/pin.js";
import type { PinRecord, QueueEntry } from "../records/types.js";
import type { Finding } from "../loop/route.js";
import { buildIssue, buildPath, readBuildStamp } from "./build.js";
import { releaseGates, runGates } from "./gates.js";
import { readManifest } from "./manifest.js";
import { currentPins, pinDiff } from "./pins.js";
import { RELEASE_SLOT, publicationOf, releaseSlotId } from "./paths.js";

export const RELEASE_READY = "release.ready";

export type ReadyPin = Pick<PinRecord, "candidate" | "decidedBy" | "basis" | "at"> & { readonly sha256?: string };

const time = (iso: string | undefined): number => (iso ? Date.parse(iso) : Number.NaN);

function answerIssues(root: string, slotRef: string, pin: ReadyPin, manifestAt: string | undefined): string[] {
  const match = OWNER_QUEUE_ANSWER.exec(pin.decidedBy);
  if (!match || match[1] !== "queue.approve") return [`decidedBy ${pin.decidedBy} is not an owner answer to queue.approve (owner:queue.approve#<id>)`];
  const found = findQueueEntry(root, `${match[1]}#${match[2]}`);
  if (!found.ok) return [found.reason];
  const read = readQueueEntry(found.at);
  if (!read.ok) return [`${match[1]}#${match[2]}: ${read.reason}`];
  const entry: QueueEntry = read.entry;
  const issues: string[] = [];
  const name = `${entry.queue}#${entry.id}`;
  if (entry.subject?.to !== slotRef) issues.push(`${name} asks about ${String(entry.subject?.to)}, not ${slotRef}`);
  const answered = [...(entry.events ?? [])].reverse().find(event => event.op === "answered");
  if (entry.status !== "answered" || !answered) issues.push(`${name} is ${entry.status}, not answered`);
  else {
    if (answered.by !== "owner") issues.push(`${name} was answered by ${answered.by}, not the owner`);
    if (answered.answer !== "ready") issues.push(`${name} was answered ${String(answered.answer)}, not ready`);
    if (manifestAt && !(time(answered.at) >= time(manifestAt))) issues.push(`${name} was answered at ${answered.at}, before the manifest was written (${manifestAt})`);
  }
  const raised = (entry.events ?? []).find(event => event.op === "raised");
  if (manifestAt && raised && !(time(raised.at) >= time(manifestAt))) issues.push(`${name} was raised at ${raised.at}, before the manifest was written (${manifestAt}): the owner saw another version`);
  for (const option of entry.options ?? []) {
    if (option.candidate !== undefined && option.id === answered?.answer && option.candidate !== pin.candidate) issues.push(`${name} answered ${option.id} for ${option.candidate}, not ${pin.candidate}`);
  }
  for (const ref of entry.refs ?? []) {
    const parts = ref.to.split("/");
    if (`${parts[0]}/${parts[1]}` !== slotRef || parts.length < 3) continue;
    if (parts.slice(2).join("/") !== pin.candidate || (ref.sha256 !== undefined && pin.sha256 !== undefined && ref.sha256 !== pin.sha256)) {
      issues.push(`${name} names ${parts.slice(2).join("/")}${ref.sha256 ? `@${ref.sha256.slice(0, 12)}` : ""}, not ${pin.candidate}${pin.sha256 ? `@${pin.sha256.slice(0, 12)}` : ""}`);
    }
  }
  return issues;
}

/** Every reason the pin `pin` on `publisher/<release slot of publication>` is not a ready-pin now. */
export function readyFindings(root: string, publication: string, pin: ReadyPin): Finding[] {
  const slotId = releaseSlotId(root, publication);
  const subject = `publisher/${slotId}`;
  const out = (detail: string): Finding => ({ check: RELEASE_READY, subject, detail });
  const findings: Finding[] = [];
  if (pin.basis !== "picked") findings.push(out(`basis ${pin.basis}: a ready-pin is the owner's pick (picked)`));
  const manifest = readManifest(root, publication, pin.candidate);
  for (const issue of manifest.issues) findings.push(out(`manifest ${pin.candidate}: ${issue}`));
  findings.push(...answerIssues(root, subject, pin, manifest.header?.createdAt).map(out));
  if (pin.sha256 !== undefined && manifest.sha256 && pin.sha256 !== manifest.sha256) findings.push(out(`the pin's sha256 ${pin.sha256.slice(0, 12)} is not the manifest's ${manifest.sha256.slice(0, 12)}`));
  const content = manifest.content;
  if (!content) return findings;
  if (content.publication !== publication) findings.push(out(`manifest ${pin.candidate} is for ${content.publication}, not ${publication}`));
  for (const gate of releaseGates(root, publication)) {
    const status = content.checks[gate];
    if (status !== "pass") findings.push(out(`manifest ${pin.candidate} records gate ${gate} as ${status ?? "not run"}`));
  }
  const now = currentPins(root);
  for (const row of pinDiff(content.pins, now)) {
    findings.push(out(row.from === null
      ? `manifest ${pin.candidate} is missing ${row.ref} (${row.to})`
      : row.to === null ? `manifest ${pin.candidate} lists ${row.ref}, which no longer resolves as a slot` : `${row.ref} is ${row.to} now, not ${row.from} as manifest ${pin.candidate} lists`));
  }
  for (const [ref, value] of Object.entries(content.pins)) if (!/@[0-9a-f]{64}$/.test(value)) findings.push(out(`manifest ${pin.candidate} lists ${ref} as ${value}, with no sha256`));
  const issue = buildIssue(root, content.build.id);
  if (issue) findings.push(out(issue));
  if (content.build.path !== buildPath(content.build.id)) findings.push(out(`manifest build.path ${content.build.path} is not ${buildPath(content.build.id)}`));
  const stamp = readBuildStamp(root, content.build.id);
  if (!stamp) findings.push(out(`build ${content.build.id.slice(0, 12)} has no stamp: what it read is unknown`));
  else {
    if (stamp.publication !== publication) findings.push(out(`build ${content.build.id.slice(0, 12)} is a build of ${stamp.publication}`));
    for (const row of pinDiff(stamp.pins, content.pins)) findings.push(out(`build ${content.build.id.slice(0, 12)} read ${row.ref} as ${row.from ?? "absent"}, the manifest lists ${row.to ?? "absent"}`));
  }
  const gates = runGates(root, publication, stamp);
  for (const [gate, status] of Object.entries(gates.checks)) if (status !== "pass") findings.push(out(`gate ${gate} fails now`));
  for (const finding of gates.findings) findings.push({ ...finding });
  return findings;
}

/** Every release slot folder that carries a pin, as `{publication, slotId}`. */
function pinnedReleaseSlots(root: string): { publication: string; slotId: string }[] {
  const dir = join(root, "clossys", "agents", "publisher");
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter(name => RELEASE_SLOT.test(name) && existsSync(join(slotDir(root, "publisher", name), PIN_FILE)))
    .sort().map(slotId => ({ publication: publicationOf(root, slotId), slotId }));
}

/** `release.ready`: every release pin on disk is a ready-pin now. A tree with no release pin passes. */
export function checkReleaseReady(root: string, publication?: string): { check: typeof RELEASE_READY; status: "pass" | "fail"; findings: Finding[] } {
  const findings: Finding[] = [];
  for (const { publication: pub, slotId } of pinnedReleaseSlots(root)) {
    if (publication !== undefined && pub !== publication) continue;
    const subject = `publisher/${slotId}`;
    let doc: Record<string, unknown>;
    try { doc = JSON.parse(readFileSync(join(slotDir(root, "publisher", slotId), PIN_FILE), "utf8")) as Record<string, unknown>; } catch (error) {
      findings.push({ check: RELEASE_READY, subject, detail: `pin.json is not JSON: ${(error as Error).message}` });
      continue;
    }
    if (doc.schema !== "clossys.pin/2" || typeof doc.candidate !== "string" || typeof doc.decidedBy !== "string" || typeof doc.basis !== "string" || typeof doc.sha256 !== "string") {
      findings.push({ check: RELEASE_READY, subject, detail: `pin.json is not a clossys.pin/2 pin (${String(doc.schema)})` });
      continue;
    }
    findings.push(...readyFindings(root, pub, { candidate: doc.candidate as PinRecord["candidate"], sha256: doc.sha256, decidedBy: doc.decidedBy, basis: doc.basis as PinRecord["basis"], at: String(doc.at) as PinRecord["at"] }));
  }
  if (publication !== undefined && !pinnedReleaseSlots(root).some(row => row.publication === publication)) {
    findings.push({ check: RELEASE_READY, subject: `publisher/${releaseSlotId(root, publication)}`, detail: `${publication} has no ready-pin` });
  }
  return { check: RELEASE_READY, status: findings.length ? "fail" : "pass", findings };
}
