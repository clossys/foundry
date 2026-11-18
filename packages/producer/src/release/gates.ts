/**
 * The release gates (publisher.md 9.4.3 `gates`, flows.md F8 step 4). The six gates below always run: a release
 * slot's contract may add gates but never drop one, and a gate this code does not know fails (fail closed). There is
 * no flag that skips a gate.
 *
 * - `copy.sample-remaining`: no Writer slot or record still resolves to its package default (system.md 8: a release
 *   refuses sample copy).
 * - `pins.resolve`: every consumer slot resolves (check/pins-resolve.ts), release slots aside (release.ready judges them).
 * - `constitution.strict`: the strict tree checks, `loop.reachable` and `refs.dangling` (loop/cli.ts strictFindings).
 * - `copy.locales`: every Writer copy record (`.md` or `.json`) carries a non-empty value for each field it uses in every release locale
 *   and every locale its own contract requires.
 * - `release.locales`: the release locales resolve and the build carries every one.
 * - `slots.stale`: no slot is `needs-refresh` and no pinned candidate is stale or fails its re-verdict on the pinSet
 *   now (R07.5, constitution/cascade.ts): a release never ships a dependant a repin upstream left unjudged. A legacy
 *   pin (no recorded pinSet or verdict, what `clossys migrate recut` writes for a pin/1) fails closed too: nothing says
 *   it holds on the pinSet now, so it fails until the owning agent's loop.choose re-verdicts it (foundry-build-0048 U8).
 *   The slots judged are every IA-placed slot and every slot a pinned release input resolves from (so a pin outside
 *   the IA that the manifest would ship is judged too), release slots aside (release.ready judges those). Every pin
 *   the release ships must match a judged check on its slot, record, candidate and sha256: a shipped pin the model
 *   reader could not read (an alias, an unreadable file) fails closed by name. Producer slots are not judged (sweep N2).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildContext } from "../constitution/context.js";
import { NEEDS_REFRESH, pinChecks, type PinCheck } from "../constitution/cascade.js";
import { allSlots, liveSlotRecords } from "../constitution/checks/shared.js";
import type { CandidateRecord, ConstitutionContext, SlotRecord } from "../constitution/types.js";
import { writerRecords } from "../constitution/certify/env.js";
import { readSubject } from "../loop/slots.js";
import { consumerSlotFolders } from "../records/slot.js";
import { checkPinsResolve, PINS_RESOLVE } from "../check/pins-resolve.js";
import { strictFindings } from "../loop/cli.js";
import type { Finding } from "../loop/route.js";
import { readSlotJson } from "../records/resolve.js";
import { releaseLocales, readReleaseSlot } from "./locales.js";
import { isReleaseSlot, refOf, releaseResolutions } from "./pins.js";
import { releaseSlotId } from "./paths.js";

export const COPY_SAMPLE_REMAINING = "copy.sample-remaining";
export const CONSTITUTION_STRICT = "constitution.strict";
export const COPY_LOCALES = "copy.locales";
export const RELEASE_LOCALES = "release.locales";
export const SLOTS_STALE = "slots.stale";
/** The gates every release runs, in the order the spec lists them. */
export const RELEASE_GATES: readonly string[] = [COPY_SAMPLE_REMAINING, PINS_RESOLVE, CONSTITUTION_STRICT, COPY_LOCALES, RELEASE_LOCALES, SLOTS_STALE];

export type GateStatus = "pass" | "fail";
export interface GateRun { readonly checks: Record<string, GateStatus>; readonly findings: Finding[] }

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** RELEASE_GATES, then any gate the release contract adds. */
export function releaseGates(root: string, publication: string): string[] {
  const extra = readReleaseSlot(root, publication)?.contract?.gates;
  const added = Array.isArray(extra) ? extra.filter((gate): gate is string => typeof gate === "string") : [];
  return [...new Set([...RELEASE_GATES, ...added])];
}

function sampleRemaining(root: string): Finding[] {
  return releaseResolutions(root)
    .filter(resolution => resolution.agent === "writer" && resolution.state === "sample")
    .map(resolution => ({ check: COPY_SAMPLE_REMAINING, subject: refOf(resolution), detail: `still on its package default ${"candidate" in resolution ? resolution.candidate : ""}`.trim() }));
}

/**
 * A Writer copy record's text as `{<key>: {<locale>: text}}`: a `.md` record (frontmatter locales, one `## <locale>`
 * section per locale) or a `.json` record's `content.fields`. A string is why it cannot be read; undefined, a record
 * with no copy fields to check.
 */
function copyFieldsOf(file: string, candidate: string): Record<string, Record<string, unknown>> | string | undefined {
  if (file.endsWith(".md")) {
    let text: string;
    try { text = readFileSync(file, "utf8"); } catch { return `${candidate} cannot be read`; }
    const read = writerRecords({ text } as CandidateRecord);
    if ("error" in read) return `${candidate} is not a Writer copy record: ${read.error}`;
    const fields: Record<string, Record<string, unknown>> = {};
    for (const row of read.rows) (fields[row.id] ??= {})[row.locale] = row.text;
    return fields;
  }
  if (!file.endsWith(".json")) return undefined;
  let content: unknown;
  try { content = (JSON.parse(readFileSync(file, "utf8")) as { content?: unknown }).content; } catch { return `${candidate} is not JSON`; }
  return isObject(content) && isObject(content.fields) ? content.fields as Record<string, Record<string, unknown>> : undefined;
}

function copyLocales(root: string, releaseList: readonly string[]): Finding[] {
  const findings: Finding[] = [];
  for (const resolution of releaseResolutions(root)) {
    if (resolution.agent !== "writer" || resolution.state === "unresolved") continue;
    const subject = refOf(resolution);
    const read = copyFieldsOf(resolution.file, resolution.candidate);
    if (read === undefined) continue;
    if (typeof read === "string") { findings.push({ check: COPY_LOCALES, subject, detail: read }); continue; }
    const content = { fields: read };
    const slot = readSlotJson(root, resolution.agent, resolution.slotId) as { contract?: unknown } | undefined;
    const contract = isObject(slot?.contract) ? slot!.contract : {};
    const declared = isObject(contract.locales) && Array.isArray(contract.locales.required) ? contract.locales.required.filter((l): l is string => typeof l === "string") : [];
    const locales = [...new Set([...releaseList, ...declared])];
    const uses = resolution.record !== undefined && isObject(contract.records) && isObject(contract.records[resolution.record]) && Array.isArray((contract.records[resolution.record] as { uses?: unknown }).uses)
      ? new Set(((contract.records[resolution.record] as { uses: unknown[] }).uses).filter((key): key is string => typeof key === "string")) : undefined;
    const specs = isObject(contract.copy) && Array.isArray(contract.copy.fields) ? contract.copy.fields.filter(isObject) : [];
    const required = specs.filter(spec => spec.required === true && typeof spec.key === "string" && (!uses || uses.has(spec.key as string))).map(spec => spec.key as string);
    const fields = [...new Set([...Object.keys(content.fields), ...required])].sort();
    for (const field of fields) {
      const value = content.fields[field];
      for (const locale of locales) {
        const text = isObject(value) ? value[locale] : undefined;
        if (typeof text !== "string" || !text.trim()) findings.push({ check: COPY_LOCALES, subject, detail: `${field} has no ${locale} value` });
      }
    }
  }
  return findings;
}

function localesGate(root: string, publication: string, build: { readonly locales: readonly string[] } | undefined): Finding[] {
  const subject = `publisher/${releaseSlotId(root, publication)}`;
  const { locales, issues } = releaseLocales(root, publication);
  const findings: Finding[] = issues.map(detail => ({ check: RELEASE_LOCALES, subject, detail }));
  if (!build) findings.push({ check: RELEASE_LOCALES, subject, detail: "no build to check the locales of" });
  else for (const locale of locales) if (!build.locales.includes(locale)) findings.push({ check: RELEASE_LOCALES, subject, detail: `the build does not carry locale ${locale}` });
  return findings;
}

/** Why a pinned candidate that is not fresh blocks the release, and the fix. */
function staleDetail(check: PinCheck): string {
  const pinned = `pinned ${check.candidate.name}${check.record ? ` (#${check.record})` : ""}`;
  switch (check.state) {
    case "stale": return `${pinned} was judged on a pinSet a repin upstream changed (run clossys run loop.cascade)`;
    case "failed": return `${pinned} fails its re-verdict on the pinSet now`;
    // Fail closed: a pin with no recorded verdict for its bytes (a pin/1 migrated by clossys migrate recut, or a file
    // changed after its verdict) is not known to hold on the pinSet now. Only its owner's CHOOSE gate records one.
    default: {
      const why = check.bytesChanged
        ? "has no verdict for its bytes: the candidate file changed after it was judged"
        : "is a legacy pin with no recorded pinSet or verdict (as clossys migrate recut writes a pin/1)";
      return `${pinned} ${why}: agent:${check.slot.agent} must re-verdict it (run its loop.choose: clossys run loop.choose --slot ${check.slot.agent}/${check.slot.id})`;
    }
  }
}

/**
 * The slots slots.stale judges: every IA-placed slot and every slot a pinned release input resolves from, release
 * slots aside. A release slot's ready-pin is judged by release.ready, and the manifest never lists it.
 */
function gateSlots(root: string, ctx: ConstitutionContext): SlotRecord[] {
  const shipped = new Set(releaseResolutions(root).filter(resolution => resolution.state === "pinned").map(resolution => `${resolution.agent}/${resolution.slotId}`));
  const live = new Set([...liveSlotRecords(ctx)]);
  return [...allSlots(ctx)].filter(slot => !isReleaseSlot(slot.agent, slot.id) && (live.has(slot) || shipped.has(`${slot.agent}/${slot.id}`)));
}

function slotsStale(root: string): Finding[] {
  const findings: Finding[] = [];
  for (const folder of consumerSlotFolders(root)) {
    if (!folder.hasSlot) continue;
    const subject = readSubject(root, folder.agent, folder.id);
    if (subject?.slot.status === NEEDS_REFRESH) findings.push({ check: SLOTS_STALE, subject: `${folder.agent}/${folder.id}`, detail: "is needs-refresh: a repin upstream left it to be judged again (run its loop.choose or loop.create)" });
  }
  const flagged = new Set(findings.map(finding => finding.subject));
  const ctx = buildContext(root, join(root, "clossys"));
  const checks = pinChecks(ctx, undefined, gateSlots(root, ctx));
  for (const check of checks) {
    const subject = `${check.slot.agent}/${check.slot.id}`;
    if (flagged.has(subject) || check.state === "fresh") continue;
    flagged.add(subject);
    findings.push({ check: SLOTS_STALE, subject, detail: staleDetail(check) });
  }
  // Every pin the release ships was judged: a check on the same slot, record, candidate and sha256. A shipped pin
  // the model reader could not read (an alias, an unreadable file) has no check, and fails closed here. Producer
  // slots are not judged by pinChecks and are left out the same way (sweep N2).
  for (const row of releaseResolutions(root)) {
    if (row.state !== "pinned" || row.agent === "producer") continue;
    const subject = `${row.agent}/${row.slotId}`;
    if (flagged.has(subject)) continue;
    const judged = checks.some(check => check.slot.agent === row.agent && check.slot.id === row.slotId && check.record === row.record
      && check.candidate.name === row.candidate && check.candidate.sha256 === row.sha256);
    if (judged) continue;
    flagged.add(subject);
    findings.push({ check: SLOTS_STALE, subject, detail: `ships ${row.candidate}${row.record !== undefined ? ` for record ${row.record}` : ""} unjudged: the model reader could not read it or its slot (an alias or an unreadable file), so no verdict covers the bytes the release ships` });
  }
  return findings;
}

/** Runs every gate of the release now. A gate with any finding is `fail`. */
export function runGates(root: string, publication: string, build: { readonly locales: readonly string[] } | undefined): GateRun {
  const { locales } = releaseLocales(root, publication);
  const byGate: Record<string, () => Finding[]> = {
    [COPY_SAMPLE_REMAINING]: () => sampleRemaining(root),
    // A release slot is judged by release.ready, not here: before its first ready-pin it resolves to nothing.
    [PINS_RESOLVE]: () => checkPinsResolve(root).findings
      .filter(row => !isReleaseSlot(row.subject.split("/")[0]!, (row.subject.split("/")[1] ?? "").split("#")[0]!))
      .map(row => ({ check: PINS_RESOLVE, subject: row.subject, detail: row.detail })),
    [CONSTITUTION_STRICT]: () => strictFindings(root),
    [COPY_LOCALES]: () => copyLocales(root, locales),
    [RELEASE_LOCALES]: () => localesGate(root, publication, build),
    [SLOTS_STALE]: () => slotsStale(root),
  };
  const checks: Record<string, GateStatus> = {};
  const findings: Finding[] = [];
  for (const gate of releaseGates(root, publication)) {
    const run = byGate[gate];
    const found = run ? run() : [{ check: gate, subject: `publisher/${releaseSlotId(root, publication)}`, detail: `gate ${gate} is not a release gate this Producer runs` }];
    checks[gate] = found.length ? "fail" : "pass";
    findings.push(...found);
  }
  return { checks, findings };
}
