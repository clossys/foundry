/**
 * The release gates (publisher.md 9.4.3 `gates`, flows.md F8 step 4). The six gates below always run: a release
 * slot's contract may add gates but never drop one, and a gate this code does not know fails (fail closed). There is
 * no flag that skips a gate.
 *
 * - `copy.sample-remaining`: no Writer slot or record still resolves to its package default (system.md 8: a release
 *   refuses sample copy).
 * - `pins.resolve`: every consumer slot resolves (check/pins-resolve.ts), release slots aside (release.ready judges them).
 * - `constitution.strict`: the strict tree checks, `loop.reachable` and `refs.dangling` (loop/cli.ts strictFindings).
 * - `copy.locales`: every Writer copy record carries a non-empty value for each field it uses in every release locale
 *   and every locale its own contract requires.
 * - `release.locales`: the release locales resolve and the build carries every one.
 * - `slots.stale`: no slot is `needs-refresh` and no pinned candidate is stale or fails its re-verdict on the pinSet
 *   now (R07.5, constitution/cascade.ts): a release never ships a dependant a repin upstream left unjudged.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildContext } from "../constitution/context.js";
import { NEEDS_REFRESH, pinChecks } from "../constitution/cascade.js";
import { liveSlotRecords } from "../constitution/checks/shared.js";
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

function copyLocales(root: string, releaseList: readonly string[]): Finding[] {
  const findings: Finding[] = [];
  for (const resolution of releaseResolutions(root)) {
    if (resolution.agent !== "writer" || resolution.state === "unresolved" || !resolution.file.endsWith(".json")) continue;
    const subject = refOf(resolution);
    let content: unknown;
    try { content = (JSON.parse(readFileSync(resolution.file, "utf8")) as { content?: unknown }).content; } catch { findings.push({ check: COPY_LOCALES, subject, detail: `${resolution.candidate} is not JSON` }); continue; }
    if (!isObject(content) || !isObject(content.fields)) continue;
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

function slotsStale(root: string): Finding[] {
  const findings: Finding[] = [];
  for (const folder of consumerSlotFolders(root)) {
    if (!folder.hasSlot) continue;
    const subject = readSubject(root, folder.agent, folder.id);
    if (subject?.slot.status === NEEDS_REFRESH) findings.push({ check: SLOTS_STALE, subject: `${folder.agent}/${folder.id}`, detail: "is needs-refresh: a repin upstream left it to be judged again (run its loop.choose or loop.create)" });
  }
  const flagged = new Set(findings.map(finding => finding.subject));
  const ctx = buildContext(root, join(root, "clossys"));
  for (const check of pinChecks(ctx, undefined, liveSlotRecords(ctx))) {
    const subject = `${check.slot.agent}/${check.slot.id}`;
    if (flagged.has(subject) || (check.state !== "stale" && check.state !== "failed")) continue;
    flagged.add(subject);
    findings.push({ check: SLOTS_STALE, subject, detail: check.state === "stale" ? `pinned ${check.candidate.name} was judged on a pinSet a repin upstream changed (run clossys run loop.cascade)` : `pinned ${check.candidate.name} fails its re-verdict on the pinSet now` });
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
