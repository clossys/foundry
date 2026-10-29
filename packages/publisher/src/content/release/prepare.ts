import { compilePublication, stampPublication } from "./publication.js";
import type { CompiledPublication, PublicationSnapshot } from "./publication.js";
import { createHash } from "node:crypto";
import { createCopyResolver } from "@clossys/writer";
import { checkContentActivation, checkContentApproval } from "../approval.js";
import { resolveCopy, type CompositionSection, type ContentFinding, type CopyField, type CopyFinding, type ResolveCopyOptions } from "../composition.js";
import { computeContentDigest } from "../digest.js";
import { isContentJson } from "../json.js";
import type { ContentCandidate, ContentRegistry, ContentSlot } from "../model.js";
import type { HandoverReceipt, ReleaseBundle, ReleaseInput, ReleaseManifest, ReleaseResult } from "./types.js";

const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === "string" && !!value.trim();
const compare = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
const sameLocales = (value: unknown, locales: readonly string[]): boolean => Array.isArray(value)
  && value.length === locales.length && new Set(value).size === locales.length && locales.every(locale => value.includes(locale));

/** Canonical JSON preserves array order and sorts object keys recursively. */
export function computeReleaseDigest(manifest: Omit<ReleaseManifest, "digest">): string {
  const { targetId, n, at, entries, approvedBy, publications } = manifest;
  const body = { targetId, n, at, entries, approvedBy, ...(publications === undefined ? {} : { publications }) };
  if (!isContentJson(body)) throw new TypeError("Release manifests require finite, acyclic JSON");
  function canonical(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
    if (object(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
    return JSON.stringify(value);
  }
  return createHash("sha256").update(canonical(body)).digest("hex");
}

/** Resolve exact historical occurrences before checking each locale's copy keys. */
function checkCopyLocales(registry: ContentRegistry, candidate: ContentCandidate, slot: ContentSlot, path: string, options: ResolveCopyOptions): { findings: ContentFinding[]; copyFindings: CopyFinding[] } {
  const findings: ContentFinding[] = [];
  const copyFindings: CopyFinding[] = [];
  const add = (at: string, message: string) => findings.push({ path: at, rule: "release-copy-locale", message });
  const fields = (values: readonly CopyField[], at: string) => {
    values.forEach((field, index) => {
      if (!slot.locales.includes(field.locale)) add(`${at}[${index}].locale`, `Copy locale ${field.locale} is not declared for slot ${slot.id}`);
    });
  };
  function resolve(section: CompositionSection, at: string, visiting: ReadonlySet<string>): CompositionSection | undefined {
    fields(section.fields, `${at}.fields`);
    if (!section.ref) return section;
    const ref = section.ref;
    const identity = JSON.stringify([ref.candidateId, ref.revision, ref.sectionKey]);
    if (visiting.has(identity)) { add(`${at}.ref`, "Pinned section reference is cyclic"); return undefined; }
    const pinned = registry.candidates.find(row => row.id === ref.candidateId)?.history.find(row => row.revision === ref.revision);
    const target = pinned?.content.composition?.sections.find(row => row.key === ref.sectionKey);
    if (!target) { add(`${at}.ref`, "Pinned section reference cannot be resolved"); return undefined; }
    return resolve(target, `${at}.ref`, new Set([...visiting, identity]));
  }
  const resolved: CompositionSection[] = [];
  candidate.composition?.sections.forEach((section, index) => {
    const target = resolve(section, `${path}.composition.sections[${index}]`, new Set());
    if (target) resolved.push({ ...target, key: section.key });
  });
  if (candidate.pageMeta) fields(candidate.pageMeta, `${path}.pageMeta`);
  if (findings.length) return { findings, copyFindings };
  const content = {
    ...(candidate.composition ? { composition: { ...candidate.composition, sections: resolved } } : {}),
    ...(candidate.pageMeta === undefined ? {} : { pageMeta: candidate.pageMeta }),
  };
  const copies = slot.locales.map(locale => {
    const report = resolveCopy(content, locale, { ...options, requirePageMeta: slot.kind !== "redirect" });
    for (const finding of report.findings) {
      const located = { ...finding, path: `${path}.${finding.path}` };
      copyFindings.push(located);
      if (finding.severity === "error") findings.push(located);
    }
    return { locale, copy: report.copy };
  });
  const sections = new Set(copies.flatMap(row => Object.keys(row.copy)));
  for (const key of sections) {
    const keys = new Set(copies.flatMap(row => Object.keys(row.copy[key] ?? {})));
    for (const { locale, copy } of copies) {
      for (const field of keys) if (!Object.hasOwn(copy[key] ?? {}, field)) {
        add(path, `Slot ${slot.id} section ${key} copy field ${field} is missing locale ${locale}`);
      }
    }
  }
  return { findings, copyFindings };
}

/** Prepare immutable local artifacts only; selection never asserts receiver observation. */
export function prepareContentRelease(input: ReleaseInput, numbers: Readonly<Record<string, number>> = {}): ReleaseResult {
  const findings: ContentFinding[] = [];
  const copyFindings: CopyFinding[] = [];
  const add = (path: string, rule: string, message: string) => findings.push({ path, rule, message });
  const fail = (): ReleaseResult => ({ ok: false, releases: [], findings, copyFindings });
  if (!object(input)) {
    add("input", "release-input", "Release preparation requires an explicit input record"); return fail();
  }
  if (!text(input.approvedBy)) add("input.approvedBy", "release-approver", "An explicit nonblank approving owner is required");
  if (!text(input.at) || !Number.isFinite(Date.parse(input.at))) add("input.at", "release-timestamp", "A valid explicit release timestamp is required");
  if (!Array.isArray(input.selections) || !input.selections.length) add("input.selections", "release-selection", "Select at least one explicit active candidate");
  if (!isContentJson(input.registry)) {
    add("input.registry", "content-json", "Expected a finite, acyclic JSON registry"); return fail();
  }
  findings.push(...checkContentActivation(input.registry));
  if (findings.length) return fail();
  const registry = input.registry;
  const writer = input.writer;
  if (writer !== undefined && (!isContentJson(writer) || !object(writer)
    || !Object.keys(writer).every(key => ["registry", "registries", "manifest", "timeZone"].includes(key)) || !Object.hasOwn(writer, "registry"))) {
    add("input.writer", "release-writer-context", "Writer context requires finite registry, registries, manifest, and timeZone values");
    return fail();
  }
  const copyOptions: ResolveCopyOptions = writer === undefined ? {} : {
    resolver: createCopyResolver(writer.registry, {
      ...(writer.registries === undefined ? {} : { registries: writer.registries }),
      ...(writer.manifest === undefined ? {} : { manifest: writer.manifest }),
      timeZone: writer.timeZone ?? "UTC", now: new Date(input.at),
    }),
  };
  const seen = new Set<string>();
  type Selected = { candidate: ContentCandidate; slot: ContentSlot; digest: string; publication?: CompiledPublication; receiver: HandoverReceipt["receiver"] };
  const groups = new Map<string, Selected[]>();
  Array.from(input.selections).forEach((selection, index) => {
    const path = `input.selections[${index}]`;
    if (!object(selection) || !text(selection.candidateId)) {
      add(path, "release-selection", "Each selection must name a candidate"); return;
    }
    if (seen.has(selection.candidateId)) {
      add(`${path}.candidateId`, "release-selection", `Candidate ${selection.candidateId} was selected more than once`); return;
    }
    seen.add(selection.candidateId);
    const candidate = registry.candidates.find(row => row.id === selection.candidateId);
    if (!candidate) { add(path, "release-selection", `Selected candidate ${selection.candidateId} does not exist`); return; }
    const slot = registry.slots.find(row => row.id === candidate.slotId)!;
    findings.push(...checkContentApproval(candidate, "publish").map(finding => ({ ...finding, path: `${path}.${finding.path}` })));
    if (candidate.state !== "active" || slot.activeCandidateId !== candidate.id) add(path, "release-selection", "Selected candidate must be the slot's current active pointer");
    if (candidate.approval?.by !== input.approvedBy) add(path, "release-approver", `Candidate ${candidate.id} owner approval does not match approvedBy`);
    const digest = computeContentDigest(candidate);
    const review: unknown = selection.review;
    if (!object(review) || !object(review.checkedAgainst)
      || review.candidateId !== candidate.id || review.revision !== candidate.revision || review.digest !== digest
      || review.checkedAgainst.libraryVersion !== (candidate.composition?.libraryVersion ?? null)
      || !sameLocales(review.checkedAgainst.locales, slot.locales)
      || !Array.isArray(review.findings) || review.findings.length !== 0
      || !Array.isArray(review.needs) || review.needs.length !== 0) {
      add(`${path}.review`, "release-review", `Candidate ${candidate.id} requires a matching, complete, finding-free Review report for every declared locale`);
    }
    const copyReport = checkCopyLocales(registry, candidate, slot, `${path}.candidate`, copyOptions);
    findings.push(...copyReport.findings);
    copyFindings.push(...copyReport.copyFindings);
    let publication: CompiledPublication | undefined;
    if (Object.hasOwn(candidate.typeSettings, "publication")) {
      try {
        if (!input.publicationLibrary || !writer) throw new TypeError("Current Designer library and Writer context required");
        publication = compilePublication(candidate.typeSettings.publication as unknown as PublicationSnapshot, input.publicationLibrary, { ...writer, at: input.at });
        if (!publication.products.routes.routes.some(route => route.path === slot.route)) throw new TypeError("Publication does not include the selected slot route");
        // One revision owns the whole publication. Split release snapshots refuse.
        if ([...groups.values()].flat().some(row => row.publication?.publicationId === publication!.publicationId)) throw new TypeError("Publication must have one revision owner per release");
      } catch (error) { add(`${path}.publication`, "release-publication", (error as Error).message); }
    }
    const target = slot.deployTarget;
    if (!target || !/^[a-zA-Z0-9_-]+$/.test(target) || registry.workspace.deployTargets.filter(row => row.id === target).length !== 1) {
      add(path, "release-target", `Slot ${slot.id} requires one declared deploy target with a safe target id`);
      return;
    }
    let receiver: HandoverReceipt["receiver"] = "builder";
    if (slot.destination !== undefined) {
      const destinations = registry.workspace.destinations.filter(row => row.id === slot.destination);
      if (destinations.length !== 1) { add(path, "release-destination", `Slot ${slot.id} destination must resolve uniquely`); return; }
      receiver = destinations[0]!.kind;
    }
    const group = groups.get(target) ?? [];
    group.push({ candidate, slot, digest, receiver, ...(publication ? { publication } : {}) });
    groups.set(target, group);
  });
  if (!object(numbers)) add("numbers", "release-number", "Release numbers must be a target-to-positive-integer record");
  for (const [target, selected] of groups) {
    if (new Set(selected.map(row => row.receiver)).size !== 1) add(`targets.${target}`, "release-receiver", `Deploy target ${target} has conflicting handover receivers`);
    const n = object(numbers) && Object.hasOwn(numbers, target) ? numbers[target] : 1;
    if (!Number.isSafeInteger(n) || (n as number) < 1) add(`numbers.${target}`, "release-number", `Deploy target ${target} requires a positive safe release number`);
  }
  if (findings.length) return fail();
  const releases: ReleaseBundle[] = [...groups].sort(([a], [b]) => compare(a, b)).map(([targetId, selected]) => {
    selected.sort((a, b) => compare(a.slot.id, b.slot.id) || compare(a.candidate.id, b.candidate.id));
    const n = Object.hasOwn(numbers, targetId) ? numbers[targetId]! : 1;
    const body: Omit<ReleaseManifest, "digest"> = {
      targetId, n, at: input.at, approvedBy: input.approvedBy,
      ...(selected.some(row => row.publication) ? { publications: selected.flatMap(row => row.publication ? [row.publication] : []) } : {}),
      entries: selected.map(({ candidate, slot, digest }) => ({ slotId: slot.id, candidateId: candidate.id, revision: candidate.revision, digest, ...(slot.route === undefined ? {} : { route: slot.route }) })),
    };
    const releaseDigest = computeReleaseDigest(body);
    return {
      manifest: { ...body, digest: releaseDigest },
      build: { targetId, releaseN: n, ...(body.publications ? { publications: body.publications.map(value => stampPublication(value, releaseDigest)) } : {}), routes: selected.map(({ candidate, slot, digest }) => ({ slotId: slot.id, ...(slot.route === undefined ? {} : { path: slot.route }), kind: slot.kind, locales: [...slot.locales], revision: candidate.revision, digest })) },
      handover: { targetId, releaseN: n, receiver: selected[0]!.receiver, matches: false, status: "pending", observedAt: null },
    };
  });
  return { ok: true, releases, findings: [], copyFindings };
}
