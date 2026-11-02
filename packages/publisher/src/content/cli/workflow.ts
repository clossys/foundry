import { readLibrary, readSurfacePackageEvidence } from "@clossys/designer/catalog/node";
import { createCopyResolver } from "@clossys/writer";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { checkContentActivation, checkContentApproval, createContentOwnerApproval } from "../approval.js";
import type { ContentFinding } from "../composition.js";
import { computeContentDigest } from "../digest.js";
import { isContentJson } from "../json.js";
import type { CandidateContent, ContentCandidate, ContentRegistry, ContentSlot } from "../model.js";
import { prepareContentRelease } from "../release/prepare.js";
import { appendContentRevision, createContentRevision } from "../revisions.js";
import { reviewCandidate } from "../review/index.js";
import type { ReviewLibrarySnapshot, ReviewReport } from "../review/types.js";
import { computeStageReport, transitionContentCandidate } from "../stage-engine.js";
import type { CandidateStageEvidence, StageKey, StageReport, StageResult } from "../stage-engine.js";
import { writeContentStore } from "../store/index.js";
import { optionalStoreJson, storeRoot, storeSegment, writeStoreJson } from "../store/files.js";
import { writeContentRelease } from "../store/release.js";
import { createSlotId } from "../taxonomy.js";
import { validateCandidateContent, validateContentRegistry, validateContentSlot } from "../validate.js";
import { isRevisionId } from "../vocabulary.js";
import { loadPublisherContext } from "./context.js";
import type { PublisherCommandInput, PublisherCommandResult } from "./types.js";

const contentKeys = ["name", "brief", "composition", "redirectTarget", "pageMeta", "pageMetaAssets", "links", "typeSettings", "openQuestions"];
const slotKeys = ["aliases", "locales", "l1", "l2", "position", "name", "kind", "route", "deployTarget", "destination", "meta", "dynamicParams", "devOnly", "tags"];
const commandKeys = {
  "slot-create": ["slot"], "candidate-add": ["slotId", "content"], "candidate-revise": ["candidateId", "content"],
  review: ["candidateId"], approve: ["candidateId", "by", "revision", "digest"], activate: ["candidateId"], release: ["candidateId", "approvedBy"],
} as const;
const finding = (path: string, rule: string, message: string): ContentFinding => ({ path, rule, message });
const failure = (findings: readonly ContentFinding[], data?: unknown): PublisherCommandResult => ({ exitCode: 1, findings: unique(findings), ...(data === undefined ? {} : { data }) });
const success = (data: unknown): PublisherCommandResult => ({ exitCode: 0, findings: [], data });
function unique(findings: readonly ContentFinding[]): ContentFinding[] {
  return [...new Map(findings.map(value => [JSON.stringify(value), value])).values()];
}
function object(value: unknown): value is Record<string, unknown> { return !!value && typeof value === "object" && !Array.isArray(value); }
function allowed(value: unknown, keys: readonly string[], path: string): ContentFinding[] {
  if (!object(value)) return [finding(path, "object", "Expected a JSON object")];
  return Object.keys(value).filter(key => !keys.includes(key)).map(key => finding(`${path}.${key}`, "unknown-field", "This field is not accepted by the command"));
}
function text(value: unknown): value is string { return typeof value === "string" && !!value.trim() && value === value.trim(); }
function stageResult(findings: readonly ContentFinding[]): StageResult { return { status: findings.length ? "Failing" : "Done", findings }; }
function requiredFindings(report: StageReport, keys: readonly StageKey[]): ContentFinding[] {
  return keys.flatMap(key => {
    const stage = report.stages[key];
    if (stage.status === "Done" || stage.status === "Not applicable") return [];
    return [...stage.findings, finding(`stages.${key}`, "stage-prerequisite", `The ${key} stage must be complete`)];
  });
}
function replaceCandidate(registry: ContentRegistry, candidate: ContentCandidate): ContentRegistry {
  return { ...registry, candidates: registry.candidates.map(value => value.id === candidate.id ? candidate : value) };
}
function contentInput(value: unknown): ContentFinding[] {
  const findings = allowed(value, contentKeys, "input.content");
  if (findings.length) return findings;
  return [...validateCandidateContent(value)];
}
function copyLocaleFindings(content: CandidateContent, slot: ContentSlot): ContentFinding[] {
  const fields = [
    ...(content.pageMeta ?? []).map((field, index) => ({ field, path: `input.content.pageMeta[${index}].locale` })),
    ...(content.composition?.sections ?? []).flatMap((section, index) => section.fields.map((field, ordinal) => ({ field, path: `input.content.composition.sections[${index}].fields[${ordinal}].locale` }))),
  ];
  return fields.filter(({ field }) => !slot.locales.includes(field.locale)).map(({ path }) => finding(path, "slot-copy-locale", "Writer copy locale must be declared by the selected slot"));
}
function libraryDigest(libraries: readonly ReviewLibrarySnapshot[]): string {
  const canonical = (value: unknown): string => {
    if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
    if (object(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
    return JSON.stringify(value);
  };
  return createHash("sha256").update(canonical(libraries)).digest("hex");
}
interface RequestedReview {
  readonly requestedAt: string;
  readonly report: ReviewReport;
  readonly libraryDigest: string;
  /** Structural registrations and frames do not prove browser rendering. */
  readonly assemblyScope: "structural-only";
}
const reviewPath = (candidateId: string): string => `.generated/reviews/${storeSegment(candidateId)}.json`;
function reviewEvidence(candidate: ContentCandidate, report: ReviewReport): CandidateStageEvidence {
  const words = report.findings.filter(value => value.check === "copy-schema" || value.check === "locale-coverage");
  const structural = report.findings.filter(value => value.check === "closed-world" || value.check === "frame-per-l2");
  return {
    candidateId: candidate.id, revision: candidate.revision, digest: computeContentDigest(candidate),
    words: stageResult(words), visuals: stageResult(structural), assembly: stageResult(structural), review: stageResult(report.findings),
    approval: candidate.approval ? stageResult(checkContentApproval(candidate, "activation"))
      : { status: "Waiting", findings: [finding("candidate.approval", "approval-required", "Record current revision approval")] },
  };
}
async function previousReviewFindings(root: string, candidate: ContentCandidate, fresh: ReviewReport, libraries: readonly ReviewLibrarySnapshot[]): Promise<ContentFinding[]> {
  const stored = await optionalStoreJson(await storeRoot(root), reviewPath(candidate.id));
  if (stored === undefined) return [finding("review", "review-request-required", "Run review for the current revision before this command")];
  if (!object(stored) || allowed(stored, ["requestedAt", "report", "libraryDigest", "assemblyScope"], "review").length
    || !text(stored.requestedAt) || !Number.isFinite(Date.parse(stored.requestedAt)) || stored.assemblyScope !== "structural-only"
    || stored.libraryDigest !== libraryDigest(libraries) || !isDeepStrictEqual(stored.report, fresh)) {
    return [finding("review", "review-stale", "Stored review must exactly match fresh checks of the current revision, Designer library, and locales; run review again")];
  }
  return [];
}

/** Execute one explicit local command; authored input never supplies stage proof or workflow metadata. */
export async function executePublisherCommand(request: PublisherCommandInput): Promise<PublisherCommandResult> {
  try {
    const keys = commandKeys[request.command];
    if (!keys) return failure([finding("command", "publisher-command", "Unknown Publisher command")]);
    if (!isContentJson(request.input)) return failure([finding("input", "content-json", "Expected finite, acyclic JSON input")]);
    const inputFindings = allowed(request.input, keys, "input");
    if (inputFindings.length) return failure(inputFindings);
    if (!text(request.at) || !Number.isFinite(Date.parse(request.at))) return failure([finding("at", "timestamp", "A valid explicit command timestamp is required")]);
    const input = request.input as Record<string, unknown>;
    const missing = keys.filter(key => !Object.hasOwn(input, key)).map(key => finding(`input.${key}`, "required-field", "This command requires the field"));
    if (missing.length) return failure(missing);
    if (request.command === "slot-create") {
      const findings = allowed(input.slot, slotKeys, "input.slot");
      if (findings.length) return failure(findings);
    }
    if (request.command === "candidate-add" || request.command === "candidate-revise") {
      const findings = contentInput(input.content);
      if (findings.length) return failure(findings);
    }
    const { registry, libraries } = await loadPublisherContext(request.root, request.designerRoot, request.catalog);
    if (request.command === "slot-create") {
      const slot = { ...(input.slot as object), id: createSlotId(new Set([...registry.slots.map(value => value.id), ...registry.slots.flatMap(value => value.aliases)])), releases: [], createdAt: request.at } as unknown as ContentSlot;
      const next = { ...registry, slots: [...registry.slots, slot] };
      const findings = [...validateContentSlot(slot), ...validateContentRegistry(next)];
      if (findings.length) return failure(findings);
      await writeContentStore(request.root, next);
      return success({ slot });
    }
    if (request.command === "candidate-add") {
      const slot = registry.slots.find(value => value.id === input.slotId);
      if (!slot) return failure([finding("input.slotId", "missing-slot", "Select an existing slot")]);
      let n = 0;
      for (const value of registry.candidates) {
        const match = /^c([1-9][0-9]*)$/.exec(value.id);
        if (match) n = Math.max(n, Number(match[1]));
      }
      if (!Number.isSafeInteger(n + 1)) return failure([finding("candidate.id", "candidate-id-exhausted", "No safe sequential candidate identity remains")]);
      const content = structuredClone(input.content as unknown as CandidateContent);
      const localeFindings = copyLocaleFindings(content, slot);
      if (localeFindings.length) return failure(localeFindings);
      const snapshot = createContentRevision(content, "r1", request.at);
      const candidate: ContentCandidate = { ...content, id: `c${n + 1}`, slotId: slot.id, origin: "agent-draft", state: "draft", revision: "r1", tags: [], history: [snapshot], updatedAt: request.at };
      const next = { ...registry, candidates: [...registry.candidates, candidate] };
      const findings = validateContentRegistry(next);
      if (findings.length) return failure(findings);
      await writeContentStore(request.root, next);
      return success({ candidate });
    }
    if (!text(input.candidateId)) return failure([finding("input.candidateId", "candidate-identity", "Select an existing candidate identity")]);
    const candidate = registry.candidates.find(value => value.id === input.candidateId);
    if (!candidate) return failure([finding("input.candidateId", "missing-candidate", "Selected candidate does not exist")]);
    if (request.command === "candidate-revise") {
      if (candidate.state === "active" || candidate.state === "retired") return failure([finding("candidate.state", "candidate-state-transition", "Active and retired content cannot be revised; create an alternative candidate")]);
      const draft = transitionContentCandidate(candidate, "draft", undefined, request.at);
      const content = structuredClone(input.content as unknown as CandidateContent);
      const localeFindings = copyLocaleFindings(content, registry.slots.find(value => value.id === candidate.slotId)!);
      if (localeFindings.length) return failure(localeFindings);
      const history = appendContentRevision(draft.history, content, request.at);
      const { approval: _approval, composition: _composition, redirectTarget: _redirect, pageMeta: _meta, pageMetaAssets: _assets, ...metadata } = draft;
      const nextCandidate: ContentCandidate = { ...metadata, ...content, revision: history.at(-1)!.revision, history, updatedAt: request.at };
      const next = replaceCandidate(registry, nextCandidate);
      const findings = validateContentRegistry(next);
      if (findings.length) return failure(findings);
      await writeContentStore(request.root, next);
      return success({ candidate: nextCandidate });
    }
    const writer = request.writer;
    if (writer !== undefined && (!isContentJson(writer) || !object(writer) || !object(writer.registry)
      || Object.keys(writer).some(key => !["registry", "registries", "manifest", "timeZone"].includes(key)))) {
      return failure([finding("writer", "writer-context", "Supply a finite Writer registry context")]);
    }
    const copyResolver = request.copyResolver ?? (writer === undefined ? undefined : createCopyResolver(writer.registry, {
      ...(writer.registries === undefined ? {} : { registries: writer.registries }),
      ...(writer.manifest === undefined ? {} : { manifest: writer.manifest }),
      timeZone: writer.timeZone ?? "UTC", now: new Date(request.at),
    }));
    const report = reviewCandidate({ registry, candidateId: candidate.id, libraries, digest: computeContentDigest(candidate), raisedAt: request.at, copyResolver });
    let evidence = reviewEvidence(candidate, report);
    let stages = computeStageReport(candidate, evidence);
    if (request.command === "review") {
      const record: RequestedReview = { requestedAt: request.at, report, libraryDigest: libraryDigest(libraries), assemblyScope: "structural-only" };
      await writeStoreJson(await storeRoot(request.root), reviewPath(candidate.id), record, false);
      const blockers = requiredFindings(stages, ["define", "assemble"]);
      if (candidate.state === "retired") blockers.push(finding("candidate.state", "candidate-state-transition", "Retired candidates cannot enter review"));
      if (blockers.length) return failure([...report.findings, ...blockers], { candidate, report, stages });
      const reviewed = candidate.state === "draft" ? transitionContentCandidate(candidate, "in-review", evidence, request.at) : candidate;
      if (reviewed !== candidate) await writeContentStore(request.root, replaceCandidate(registry, reviewed));
      return report.findings.length ? failure(report.findings, { candidate: reviewed, report, stages }) : success({ candidate: reviewed, report, stages });
    }
    const previous = await previousReviewFindings(request.root, candidate, report, libraries);
    if (previous.length) evidence = { ...evidence, review: stageResult([...report.findings, ...previous]) };
    stages = computeStageReport(candidate, evidence);
    if (request.command === "approve") {
      const findings = [...previous, ...report.findings, ...requiredFindings(stages, ["define", "assemble", "review"])];
      if (candidate.state !== "in-review") findings.push(finding("candidate.state", "candidate-state-transition", "Owner approval requires an in-review candidate"));
      if (!text(input.by)) findings.push(finding("input.by", "approval-evidence", "An explicit owner identity is required"));
      if (!isRevisionId(input.revision) || input.revision !== candidate.revision) findings.push(finding("input.revision", "approval-revision", "Owner evidence must cover the current revision"));
      if (input.digest !== computeContentDigest(candidate)) findings.push(finding("input.digest", "approval-digest", "Owner evidence must cover the current content digest"));
      if (findings.length) return failure(findings, { candidate, report, stages });
      const approval = createContentOwnerApproval(candidate, { by: input.by as string, at: request.at, revision: candidate.revision, digest: input.digest as string });
      const approved = { ...candidate, approval };
      evidence = { ...evidence, approval: stageResult(checkContentApproval(approved, "activation")) };
      const next = transitionContentCandidate(approved, "approved", evidence, request.at);
      await writeContentStore(request.root, replaceCandidate(registry, next));
      return success({ candidate: next, report, stages: computeStageReport(next, evidence) });
    }
    if (request.command === "activate") {
      const findings = [...previous, ...report.findings, ...requiredFindings(stages, ["define", "assemble", "review", "approve"])];
      if (candidate.state !== "approved") findings.push(finding("candidate.state", "candidate-state-transition", "Activation requires an approved candidate"));
      const slot = registry.slots.find(value => value.id === candidate.slotId)!;
      if (slot.activeCandidateId !== undefined && slot.activeCandidateId !== candidate.id) findings.push(finding("slot.activeCandidateId", "one-active-candidate", "Slot already has an active candidate; explicit retirement is required"));
      if (findings.length) return failure(findings, { candidate, report, stages });
      const active = transitionContentCandidate(candidate, "active", evidence, request.at);
      const next: ContentRegistry = { ...replaceCandidate(registry, active), slots: registry.slots.map(value => value.id === slot.id ? { ...value, activeCandidateId: active.id } : value) };
      const activation = checkContentActivation(next);
      if (activation.length) return failure(activation, { candidate, report, stages });
      await writeContentStore(request.root, next);
      return success({ candidate: active, report, stages: computeStageReport(active, evidence) });
    }
    const publicationLibrary = Object.hasOwn(candidate.typeSettings, "publication") ? {
      catalog: request.catalog, library: await readLibrary(request.designerRoot, request.catalog),
      surfaceOptions: { packages: await readSurfacePackageEvidence(request.catalog.surfaces?.fills ?? []), measurements: [] },
    } : undefined;
    const releaseInput = { registry, selections: [{ candidateId: candidate.id, review: report }], approvedBy: input.approvedBy as string, at: request.at,
      ...(writer === undefined ? {} : { writer }), ...(publicationLibrary === undefined ? {} : { publicationLibrary }) };
    const prepared = prepareContentRelease(releaseInput);
    // A successful preflight permits the write; it is not evidence of a completed release.
    evidence = { ...evidence, release: prepared.ok ? { status: "Waiting", findings: [] } : stageResult(prepared.findings) };
    stages = computeStageReport(candidate, evidence);
    const findings = [...previous, ...report.findings, ...requiredFindings(stages, ["define", "assemble", "review", "approve"]), ...stages.stages.publish.findings, ...prepared.findings];
    if (findings.length) return failure(findings, { candidate, report, stages });
    const released = await writeContentRelease(request.root, releaseInput);
    evidence = { ...evidence, release: stageResult(released.findings) };
    stages = computeStageReport(candidate, evidence);
    return released.ok ? success({ candidate, report, stages, releases: released.releases }) : failure(released.findings, { candidate, report, stages });
  } catch (error) {
    return { exitCode: 2, findings: [finding("command", "publisher-operation", error instanceof Error ? error.message : "Publisher command could not complete")] };
  }
}
