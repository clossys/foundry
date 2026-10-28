import { canonicalLocale } from "@clossys/writer/locale";
import { PAGE_META_FIELDS, validateComposition, validateCopyFields } from "./composition.js";
import type { ContentFinding } from "./composition.js";
import { isContentJson, isSourceAnswer } from "./json.js";
import type { ContentCandidate, ContentRegistry, ContentSlot } from "./model.js";
import { CONTENT_TREE, isContentPlacement, isSlotId } from "./taxonomy.js";
import type { ContentTree } from "./taxonomy.js";
import { isCanonicalUrl } from "./metadata.js";
import { CANDIDATE_ORIGINS, CANDIDATE_STATES, LINK_RELATIONS, SLOT_KINDS, isContentLocale, isRevisionId } from "./vocabulary.js";

class Checks {
  findings: ContentFinding[] = [];
  readonly tree: ContentTree;
  constructor(tree: ContentTree = CONTENT_TREE) { this.tree = tree; }
  add(path: string, rule: string): void { this.findings.push({ path, rule, message: `Invalid ${rule}` }); }
  object(v: unknown, path: string): v is Record<string, unknown> {
    if (!v || typeof v !== "object" || Array.isArray(v) || ![null, Object.prototype].includes(Object.getPrototypeOf(v))) {
      this.add(path, "object"); return false;
    } return true;
  }
  array(v: unknown, path: string): v is unknown[] {
    if (!Array.isArray(v)) { this.add(path, "array"); return false; } return true;
  }
  text(v: unknown, path: string, blank = false): void {
    if (typeof v !== "string" || (!blank && !v.trim())) this.add(path, "string");
  }
  strings(v: unknown, path: string): void {
    if (this.array(v, path)) v.forEach((entry, i) => this.text(entry, `${path}[${i}]`));
  }
  locales(v: unknown, path: string): void {
    if (!this.array(v, path)) return;
    if (!v.length) this.add(path, "nonempty-locales");
    v.forEach((entry, i) => this.locale(entry, `${path}[${i}]`));
    if (new Set(v).size !== v.length) this.add(path, "duplicate-locale");
  }
  locale(v: unknown, path: string): void {
    if (isContentLocale(v)) return;
    try {
      canonicalLocale(v);
      this.add(path, "non-canonical-locale");
    } catch { this.add(path, "locale"); }
  }
  integer(v: unknown, path: string): void {
    if (typeof v !== "number" || !Number.isSafeInteger(v) || v < 1) this.add(path, "positive-integer");
  }
  date(v: unknown, path: string): void {
    if (typeof v !== "string" || !v.trim() || !Number.isFinite(Date.parse(v))) this.add(path, "timestamp");
  }
  revision(v: unknown, path: string): void { if (!isRevisionId(v)) this.add(path, "pinned-revision"); }
  enum(v: unknown, values: readonly unknown[], path: string): void { if (!values.includes(v)) this.add(path, "enum"); }
  jsonObject(v: unknown, path: string): void {
    if (!this.object(v, path)) return;
    if (!isContentJson(v)) this.add(path, "json");
  }
  brief(v: unknown, path: string): void {
    if (!this.object(v, path)) return;
    for (const key of ["audience", "goal", "keyMessage", "callToAction", "tone"]) this.text(v[key], `${path}.${key}`, true);
    this.strings(v.constraints, `${path}.constraints`);
    this.integer(v.version, `${path}.version`);
    if (this.array(v.sourceAnswers, `${path}.sourceAnswers`)) v.sourceAnswers.forEach((answer, i) => {
      if (!isSourceAnswer(answer)) this.add(`${path}.sourceAnswers[${i}]`, "source-answer");
    });
  }
  content(v: Record<string, unknown>, path: string): void {
    this.text(v.name, `${path}.name`);
    this.brief(v.brief, `${path}.brief`);
    if (v.composition !== undefined) this.findings.push(...validateComposition(v.composition).map(f => ({ ...f, path: `${path}.${f.path}` })));
    if (v.redirectTarget !== undefined) this.text(v.redirectTarget, `${path}.redirectTarget`);
    if (v.pageMeta !== undefined) this.findings.push(...validateCopyFields(v.pageMeta, `${path}.pageMeta`, PAGE_META_FIELDS));
    if (v.pageMetaAssets !== undefined && this.object(v.pageMetaAssets, `${path}.pageMetaAssets`)) {
      for (const [key, asset] of Object.entries(v.pageMetaAssets)) {
        const p = `${path}.pageMetaAssets.${key}`;
        if (!["og-image", "icon"].includes(key)) this.add(p, "unknown-field");
        if (typeof asset !== "string" || !/^assets\.[a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)*$/.test(asset)) this.add(p, "designer-asset-id");
      }
    }
    if ((v.composition === undefined) === (v.redirectTarget === undefined)) this.add(path, "composition-or-redirect");
    this.jsonObject(v.typeSettings, `${path}.typeSettings`);
    if (this.array(v.openQuestions, `${path}.openQuestions`)) v.openQuestions.forEach((question, i) => {
      const p = `${path}.openQuestions[${i}]`;
      if (!this.object(question, p)) return;
      this.text(question.field, `${p}.field`);
      this.text(question.question, `${p}.question`);
      if (typeof question.blocking !== "boolean") this.add(`${p}.blocking`, "blocking-boolean");
    });
    if (this.array(v.links, `${path}.links`)) v.links.forEach((link, i) => {
      const p = `${path}.links[${i}]`;
      if (!this.object(link, p)) return;
      this.text(link.toSlotId, `${p}.toSlotId`);
      this.text(link.intent, `${p}.intent`);
      this.enum(link.relation, LINK_RELATIONS, `${p}.relation`);
      if (link.condition !== undefined) this.text(link.condition, `${p}.condition`);
      if (link.offset !== undefined && !isContentJson(link.offset)) this.add(`${p}.offset`, "json");
    });
  }
  candidate(v: unknown, path: string): void {
    if (!this.object(v, path)) return;
    this.content(v, path);
    for (const key of ["id", "slotId"]) this.text(v[key], `${path}.${key}`);
    this.enum(v.origin, CANDIDATE_ORIGINS, `${path}.origin`);
    this.enum(v.state, CANDIDATE_STATES, `${path}.state`);
    this.revision(v.revision, `${path}.revision`);
    this.date(v.updatedAt, `${path}.updatedAt`);
    this.strings(v.tags, `${path}.tags`);
    if (v.derivedFrom !== undefined && this.object(v.derivedFrom, `${path}.derivedFrom`)) {
      this.text(v.derivedFrom.candidateId, `${path}.derivedFrom.candidateId`);
      this.revision(v.derivedFrom.revision, `${path}.derivedFrom.revision`);
    }
    if (v.approval !== undefined && this.object(v.approval, `${path}.approval`)) {
      this.text(v.approval.by, `${path}.approval.by`);
      this.date(v.approval.at, `${path}.approval.at`);
      this.revision(v.approval.revision, `${path}.approval.revision`);
      this.text(v.approval.digest, `${path}.approval.digest`);
      this.enum(v.approval.source, ["owner", "imported-baseline"], `${path}.approval.source`);
    }
    if (this.array(v.history, `${path}.history`)) {
      v.history.forEach((snapshot, i) => {
        const p = `${path}.history[${i}]`;
        if (!this.object(snapshot, p)) return;
        if (snapshot.revision !== `r${i + 1}`) this.add(`${p}.revision`, "revision-sequence");
        this.text(snapshot.digest, `${p}.digest`);
        this.date(snapshot.createdAt, `${p}.createdAt`);
        if (this.object(snapshot.content, `${p}.content`)) this.content(snapshot.content, `${p}.content`);
      });
      if (v.revision !== `r${v.history.length}`) this.add(`${path}.revision`, "current-revision");

    }
  }
  slot(v: unknown, path: string): void {
    if (!this.object(v, path)) return;
    if (!isSlotId(v.id)) this.add(`${path}.id`, "slot-id");
    this.strings(v.aliases, `${path}.aliases`);
    if (Array.isArray(v.aliases) && new Set(v.aliases).size !== v.aliases.length) this.add(`${path}.aliases`, "duplicate-alias");
    this.locales(v.locales, `${path}.locales`);
    if (!isContentPlacement(v.l1, v.l2, this.tree)) this.add(path, "placement");
    for (const key of ["name"]) this.text(v[key], `${path}.${key}`);
    if (this.object(v.position, `${path}.position`)) {
      this.text(v.position.name, `${path}.position.name`);
      if (typeof v.position.order !== "number" || !Number.isFinite(v.position.order)) this.add(`${path}.position.order`, "finite-order");
    }
    this.enum(v.kind, SLOT_KINDS, `${path}.kind`);
    if (typeof v.devOnly !== "boolean") this.add(`${path}.devOnly`, "dev-only");
    for (const key of ["route", "deployTarget", "destination", "activeCandidateId"]) if (v[key] !== undefined) this.text(v[key], `${path}.${key}`);
    for (const key of ["outputPath", "fileName"]) if (Object.hasOwn(v, key)) this.add(`${path}.${key}`, "derived-output-path");
    if (v.meta !== undefined && this.object(v.meta, `${path}.meta`)) {
      for (const key of Object.keys(v.meta)) if (!["robots", "canonical"].includes(key)) this.add(`${path}.meta.${key}`, "unknown-field");
      if (v.meta.robots !== undefined) this.enum(v.meta.robots, ["index", "noindex"], `${path}.meta.robots`);
      if (v.meta.canonical !== undefined && !isCanonicalUrl(v.meta.canonical)) this.add(`${path}.meta.canonical`, "canonical-url");
    }
    if (v.dynamicParams !== undefined) this.jsonObject(v.dynamicParams, `${path}.dynamicParams`);
    this.strings(v.tags, `${path}.tags`);
    this.date(v.createdAt, `${path}.createdAt`);
    if (this.array(v.releases, `${path}.releases`)) v.releases.forEach((release, i) => {
      const p = `${path}.releases[${i}]`;
      if (!this.object(release, p)) return;
      if (release.n !== i + 1) this.add(`${p}.n`, "release-sequence");
      this.text(release.candidateId, `${p}.candidateId`);
      this.revision(release.revision, `${p}.revision`);
      this.date(release.at, `${p}.at`);
    });
  }
  workspace(v: unknown, path: string): void {
    if (!this.object(v, path)) return;
    this.text(v.consumerId, `${path}.consumerId`);
    this.locales(v.locales, `${path}.locales`);
    this.locale(v.defaultLocale, `${path}.defaultLocale`);
    if (Array.isArray(v.locales) && !v.locales.includes(v.defaultLocale)) this.add(`${path}.defaultLocale`, "default-locale-membership");
    if (v.currentMilestoneTag !== undefined) this.text(v.currentMilestoneTag, `${path}.currentMilestoneTag`);
    if (this.array(v.deployTargets, `${path}.deployTargets`)) v.deployTargets.forEach((target, i) => {
      const p = `${path}.deployTargets[${i}]`;
      if (!this.object(target, p)) return;
      for (const key of ["id", "repo", "app"]) this.text(target[key], `${p}.${key}`);
      if (target.builderSurfaceId !== undefined) this.text(target.builderSurfaceId, `${p}.builderSurfaceId`);
    });
    if (this.array(v.destinations, `${path}.destinations`)) v.destinations.forEach((target, i) => {
      const p = `${path}.destinations[${i}]`;
      if (!this.object(target, p)) return;
      for (const key of ["id", "ref"]) this.text(target[key], `${p}.${key}`);
      this.enum(target.kind, ["builder", "messenger", "influencer"], `${p}.kind`);
    });
  }
}

export function validateCandidateContent(value: unknown): readonly ContentFinding[] {
  const checks = new Checks(); if (checks.object(value, "content")) checks.content(value, "content"); return checks.findings;
}

export function validateContentCandidate(value: unknown): readonly ContentFinding[] {
  const checks = new Checks(); checks.candidate(value, "candidate"); return checks.findings;
}
export function validateContentSlot(value: unknown, tree: ContentTree = CONTENT_TREE): readonly ContentFinding[] {
  const checks = new Checks(tree); checks.slot(value, "slot"); return checks.findings;
}
export function validateContentWorkspace(value: unknown): readonly ContentFinding[] {
  const checks = new Checks(); checks.workspace(value, "workspace"); return checks.findings;
}

/** Structural and registry joins only; this does not grant approval or publishing readiness. */
export function validateContentRegistry(value: unknown, tree: ContentTree = CONTENT_TREE): readonly ContentFinding[] {
  const checks = new Checks(tree);
  if (!checks.object(value, "registry")) return checks.findings;
  checks.workspace(value.workspace, "registry.workspace");
  const slotsValid = checks.array(value.slots, "registry.slots");
  const candidatesValid = checks.array(value.candidates, "registry.candidates");
  if (slotsValid) (value.slots as unknown[]).forEach((slot, i) => checks.slot(slot, `registry.slots[${i}]`));
  if (candidatesValid) (value.candidates as unknown[]).forEach((candidate, i) => checks.candidate(candidate, `registry.candidates[${i}]`));
  // Only join typed records after shape checks, so malformed nested values never throw.
  if (checks.findings.length) return checks.findings;
  const registry = value as unknown as ContentRegistry;
  const slots = new Map<string, ContentSlot>();
  const candidates = new Map<string, ContentCandidate>();
  registry.slots.forEach((slot, i) => {
    if (slots.has(slot.id)) checks.add(`registry.slots[${i}].id`, "duplicate-slot-id");
    slots.set(slot.id, slot);
    slot.locales.forEach((locale, j) => {
      if (!registry.workspace.locales.includes(locale)) checks.add(`registry.slots[${i}].locales[${j}]`, "workspace-locale");
    });
  });
  const aliases = new Set<string>();
  registry.slots.forEach((slot, i) => {
    slot.aliases.forEach((alias, j) => {
      if (slots.has(alias) || aliases.has(alias)) checks.add(`registry.slots[${i}].aliases[${j}]`, "alias-collision");
      aliases.add(alias);
    });
  });
  registry.candidates.forEach((candidate, i) => {
    const p = `registry.candidates[${i}]`;
    if (candidates.has(candidate.id)) checks.add(`${p}.id`, "duplicate-candidate-id");
    candidates.set(candidate.id, candidate);
    const slot = slots.get(candidate.slotId);
    if (!slot) checks.add(`${p}.slotId`, "missing-slot");
    else if ((slot.kind === "redirect") !== (candidate.redirectTarget !== undefined)) checks.add(p, "slot-content-kind");
    candidate.links.forEach((link, j) => { if (!slots.has(link.toSlotId)) checks.add(`${p}.links[${j}]`, "missing-link-slot"); });
  });
  registry.slots.forEach((slot, i) => {
    const p = `registry.slots[${i}]`;
    const active = registry.candidates.filter(candidate => candidate.slotId === slot.id && candidate.state === "active");
    if (active.length > 1) checks.add(p, "one-active-candidate");
    if (slot.activeCandidateId !== active[0]?.id || active.length > 1) checks.add(`${p}.activeCandidateId`, "active-candidate-pointer");
    slot.releases.forEach((release, j) => {
      const candidate = candidates.get(release.candidateId);
      if (!candidate || candidate.slotId !== slot.id || !candidate.history.some(snapshot => snapshot.revision === release.revision)) checks.add(`${p}.releases[${j}]`, "release-candidate-revision");
    });
  });
  return checks.findings;
}

export function parseContentRegistry(value: unknown, tree: ContentTree = CONTENT_TREE): ContentRegistry {
  const findings = validateContentRegistry(value, tree);
  if (findings.length) throw new TypeError(findings.map(f => `${f.path}: ${f.rule}`).join("; "));
  return value as ContentRegistry;
}
