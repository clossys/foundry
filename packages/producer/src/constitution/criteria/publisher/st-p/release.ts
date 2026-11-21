/**
 * The Publisher release criterion (ST-P): a release candidate `publisher/<release slot>/candidates/<pub>-v<n>.json` is a
 * manifest Producer code computes (`clossys release <pub> --manifest`, release/manifest.ts), never a crafted record.
 * Like every kind rule it judges the candidate's view (records/slot-current.ts candidateView): the manifest content with
 * the header's source as `meta.source`. This is the part of the release certifier's criteria (release/ready.ts
 * `releaseCandidateIssues`) a pure function can decide from the view. What needs the workspace or the header (the build
 * on disk and its stamp, the release gates the publication names, the slot, the version the file name carries, the
 * ready version the slot pins) stays with the certifier (certify/release.ts). Pure.
 */
import { stateRel } from "../../../../engine/state-dir.js";
import { isRecord, strings } from "../../core/lib.js";
import type { Criterion } from "../../core/types.js";

const PUBLICATION = /^[a-z0-9][a-z0-9-]*$/;
const MANIFEST_NAME = /^([a-z0-9][a-z0-9-]*)-v([1-9][0-9]*)\.json$/;
const DIGEST = /^[0-9a-f]{64}$/;
const PIN_VALUE = /@[0-9a-f]{64}$/;
/** The source ref of a manifest derived from `previous`: `publisher/<release slot>/<previous>` (release/manifest.ts). */
const DERIVED_REF = /^publisher\/release\.[a-z0-9][a-z0-9-]*\/(.+)$/;
/** The build output folder a build id sits at (release/build.ts buildPath). */
const buildPath = (id: string): string => `${stateRel("builds", id.slice(0, 8))}/`;

const show = (value: unknown): string => JSON.stringify(value) ?? "undefined";

/** The manifest's lineage as its own view states it: previous, diff and the source agree. */
function lineageFailures(view: Record<string, unknown>, pins: Record<string, unknown>): string[] {
  const failures: string[] = [];
  const previous = view.previous;
  if (previous !== null && (typeof previous !== "string" || !MANIFEST_NAME.test(previous))) failures.push(`previous ${show(previous)} is neither null nor a manifest name (<pub>-v<n>.json)`);
  else if (typeof previous === "string") {
    const [, pub] = MANIFEST_NAME.exec(previous)!;
    if (pub !== view.publication) failures.push(`previous ${previous} is a manifest of ${pub}, not ${String(view.publication)}`);
  }
  const diff = Array.isArray(view.diff) ? view.diff : undefined;
  if (!diff) failures.push("diff is not a list of {ref, from, to} rows");
  else {
    const refs: string[] = [];
    for (const row of diff) {
      if (!isRecord(row) || typeof row.ref !== "string" || (row.from !== null && typeof row.from !== "string") || (row.to !== null && typeof row.to !== "string")) { failures.push(`diff row ${show(row)} is not {ref, from, to}`); continue; }
      refs.push(row.ref);
      if (row.from === row.to) failures.push(`diff row ${row.ref} changes nothing`);
      if (row.to !== (pins[row.ref] ?? null)) failures.push(`diff row ${row.ref} ends at ${show(row.to)}, but the manifest lists ${show(pins[row.ref] ?? null)}`);
      if (previous === null && row.from !== null) failures.push(`diff row ${row.ref} starts at ${show(row.from)}, but the manifest follows no previous version`);
    }
    if (refs.some((ref, index) => index > 0 && refs[index - 1]! >= ref)) failures.push("diff rows are not sorted by ref, once each");
    if (previous === null) for (const ref of Object.keys(pins)) if (!refs.includes(ref)) failures.push(`diff omits ${ref}: with no previous version every pin is new`);
  }
  const meta = isRecord(view.meta) ? view.meta : undefined;
  const source = isRecord(meta?.source) ? meta.source : undefined;
  const refs = strings(source?.ref);
  if (previous === null && (source?.kind !== "original" || refs.length !== 0)) failures.push(`source ${show(source)} is not original: the manifest follows no previous version`);
  if (typeof previous === "string" && (source?.kind !== "derived" || refs.length !== 1 || DERIVED_REF.exec(refs[0]!)?.[1] !== previous)) failures.push(`source ${show(source)} is not derived from publisher/<release slot>/${previous}`);
  return failures;
}

/**
 * release.manifest: a code-written release manifest of one publication, every release gate recorded as pass, every
 * pin with its sha256, a build named by its digest at its build path, and a lineage (previous, diff, source) that
 * agrees with itself.
 */
export const manifest: Criterion = subject => {
  const view = subject.json;
  if (!isRecord(view)) return ["the manifest is not a JSON object"];
  const failures: string[] = [];
  if (typeof view.publication !== "string" || !PUBLICATION.test(view.publication)) failures.push(`publication ${show(view.publication)} is not a publication id`);

  const checks = isRecord(view.checks) ? view.checks : undefined;
  if (!checks || !Object.keys(checks).length) failures.push("the manifest records no release gate");
  else for (const [gate, status] of Object.entries(checks)) if (status !== "pass") failures.push(`the manifest records gate ${gate} as ${show(status)}, not pass`);

  const pins = isRecord(view.pins) ? view.pins : undefined;
  if (!pins || !Object.keys(pins).length) failures.push("the manifest lists no pins");
  else for (const [ref, value] of Object.entries(pins)) if (typeof value !== "string" || !PIN_VALUE.test(value)) failures.push(`the manifest lists ${ref} as ${show(value)}, with no sha256`);

  const build = isRecord(view.build) ? view.build : undefined;
  if (!build) failures.push("the manifest names no build");
  else {
    if (typeof build.id !== "string" || !DIGEST.test(build.id)) failures.push(`build id ${show(build.id)} is not a sha256 digest`);
    else if (build.path !== buildPath(build.id)) failures.push(`build.path ${show(build.path)} is not ${buildPath(build.id)}`);
    if (!Number.isInteger(build.routes) || (build.routes as number) < 1) failures.push(`build.routes ${show(build.routes)} is not a route count`);
    const locales = strings(build.locales);
    if (!Array.isArray(build.locales) || !locales.length || locales.length !== build.locales.length) failures.push("build.locales is not a list of locales");
    else if (new Set(locales).size !== locales.length) failures.push("build.locales lists a locale twice");
    if (!Array.isArray(build.exports) || build.exports.some(row => !isRecord(row) || typeof row.kind !== "string" || typeof row.path !== "string")) failures.push("build.exports is not a list of {kind, path}");
  }

  failures.push(...lineageFailures(view, pins ?? {}));
  return failures;
};
