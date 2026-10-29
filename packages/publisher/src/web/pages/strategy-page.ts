import { runtimeHash, runtimeSnapshot, type RuntimeContent, type RuntimeJson } from "@clossys/designer/catalog";
import type { StringRecord } from "@clossys/writer";
import { adminPageContent, createAdminPageCopy, writerCopy, type AdminPageCopy, type AdminPageCopyEnvelope, type AdminPageCopyProof, type AdminPageCopyRef } from "./admin-copy.js";
import { prepareAdminPageCopyEnvelopes } from "./admin-copy-source.js";
import { selectContentRoute } from "../content-route-binding.js";
import { prepareConsumerPageRegistry, type ConsumerPageContentInput } from "./consumer-page-content.js";

/** Structural ST2 read capability. The consumer opens the immutable snapshot;
 * Publisher neither imports Strategist's filesystem reader nor writes strategy. */
export interface StrategyPageBullet { readonly key?: string; readonly text: string; readonly refs: readonly StrategyPageRef[]; readonly line: number }
export type StrategyPageRef = { readonly kind: "cell"; readonly ref: { readonly cell: string; readonly version: number } }
  | { readonly kind: "msg"; readonly session: string; readonly line: string } | { readonly kind: "finding"; readonly id: string };
export interface StrategyPageCell {
  readonly id: string; readonly version: number; readonly status: "draft" | "active" | "retired"; readonly updated: string;
  readonly cites: readonly StrategyPageRef[]; readonly feeds: readonly string[]; readonly functions: readonly string[];
  readonly confirmed?: StrategyPageRef; readonly note?: string; readonly path: string;
  readonly direction: readonly StrategyPageBullet[]; readonly because: readonly StrategyPageBullet[]; readonly watch: readonly StrategyPageBullet[];
}
export interface StrategyPageCheckFinding {
  readonly rule: string; readonly severity: "hard" | "judge" | "warning"; readonly message: string;
  readonly cell?: string; readonly cells?: readonly string[]; readonly path?: string; readonly line?: number;
  readonly code?: string; readonly judgeId?: string; readonly verdict?: "pass" | "fail"; readonly action?: unknown;
}
export interface StrategyPageStatus {
  readonly scope: "core" | "full";
  readonly cells: readonly { readonly id: string; readonly version?: number; readonly active: boolean; readonly fresh: boolean; readonly findings: readonly StrategyPageCheckFinding[] }[];
  readonly l1: readonly { readonly id: string; readonly unlocked: boolean }[]; readonly l2: readonly { readonly id: string; readonly coherent: boolean }[];
  readonly l0Clean: boolean; readonly nextUnlock?: string; readonly findings: readonly StrategyPageCheckFinding[];
  readonly storyline: { readonly headlines: readonly { readonly cell: string; readonly text?: string; readonly fresh: boolean }[]; readonly critic: "not judged" | "pass" | "fail"; readonly clean: boolean };
  readonly counts: { readonly active: number; readonly fresh: number; readonly total: number; readonly coherentL2: number; readonly unlockedL1: number };
}
export interface StrategyPageBrief {
  readonly contract: string; readonly state: "ready" | "missing" | "stale"; readonly missing: readonly string[];
  readonly stale: readonly { readonly cell: string; readonly version: number }[]; readonly fingerprint: string; readonly compiledAt: string;
  readonly cells: readonly { readonly cell: string; readonly version: number; readonly direction: readonly StrategyPageBullet[]; readonly watch: readonly StrategyPageBullet[]; readonly sources: readonly StrategyPageRef[] }[];
}
export interface StrategyPageReader {
  getCell(id: string, version?: number): StrategyPageCell | undefined;
  getActive(id: string): StrategyPageCell | undefined;
  getBrief(contract: string): StrategyPageBrief;
  isStale(ref: { cell: string; version: number }): boolean;
  status(options?: { scope?: "core" | "full" }): StrategyPageStatus;
}
export interface StrategyPageLabels {
  readonly title: AdminPageCopyRef; readonly direction: AdminPageCopyRef; readonly because: AdminPageCopyRef; readonly watch: AdminPageCopyRef;
  readonly status: AdminPageCopyRef; readonly missing: AdminPageCopyRef; readonly empty: AdminPageCopyRef;
  readonly templates: Readonly<Record<"scope" | "levels" | "storyline" | "l1" | "l2" | "brief" | "metadata", AdminPageCopyRef>>;
  readonly boolean: Readonly<Record<"true" | "false", AdminPageCopyRef>>;
  readonly fileStatus: Readonly<Record<StrategyPageCell["status"] | "missing", AdminPageCopyRef>>;
  readonly briefState: Readonly<Record<StrategyPageBrief["state"], AdminPageCopyRef>>;
  readonly critic: Readonly<Record<StrategyPageStatus["storyline"]["critic"], AdminPageCopyRef>>;
  readonly unlocked: Readonly<Record<"true" | "false", AdminPageCopyRef>>; readonly coherent: Readonly<Record<"true" | "false", AdminPageCopyRef>>;
  readonly scope: Readonly<Record<"core" | "full", AdminPageCopyRef>>; readonly none: AdminPageCopyRef;
}
export interface StrategyPageInput {
  /** Reopen here to observe later drafts or activation; an old handle stays old. */
  readonly open: () => StrategyPageReader;
  readonly source: { readonly id: string; readonly revision: number };
  readonly namespace: string; readonly scope?: "core" | "full"; readonly selected?: { readonly id: string; readonly version?: number };
  /** Actual installed contract ids, for example designer.identity. */
  readonly contracts: readonly string[];
  readonly issues?: readonly { readonly path: string; readonly line: number; readonly reason: string; readonly message: string }[];
  readonly envelopes: readonly AdminPageCopyEnvelope[]; readonly labels: StrategyPageLabels;
  /** The consumer allocates canonical draft ids and supplies its actual owned set. */
  readonly recordIdForContext: (context: string) => string;
  readonly ownedRecords: readonly { readonly id: string; readonly context: string; readonly leaf: string }[];
}
export interface StrategyPageFinding {
  readonly code: "strategy-input" | "strategy-read" | "strategy-root" | "copy-limit" | "copy-id" | "copy-source";
  readonly message: string; readonly cellId?: string; readonly version?: number; readonly region?: string; readonly line?: number;
  readonly path?: string; readonly reason?: string;
}
interface FieldSource {
  readonly cellId?: string; readonly version?: number; readonly region: string; readonly line?: number;
  readonly key?: string; readonly refs?: readonly StrategyPageRef[];
  /** Parsed cell fingerprint, not a claim to hash source bytes. Exact transitive
   * source-byte fingerprints remain the native Brief.fingerprint values. */
  readonly cellFingerprint?: string;
}
export interface StrategyPageFieldProof extends FieldSource {
  readonly recordId: string; readonly context: string; readonly text: string; readonly writer: AdminPageCopyProof;
}
export interface StrategyPageSnapshot {
  readonly status: StrategyPageStatus; readonly briefs: readonly StrategyPageBrief[]; readonly selected: StrategyPageCell | null;
  readonly cells: readonly { readonly id: string; readonly latest: StrategyPageCell | null; readonly active: StrategyPageCell | null;
    readonly latestStale: boolean | null; readonly activeStale: boolean | null; readonly canonical: StrategyPageStatus["cells"][number] }[];
}
export interface PreparedStrategyPage {
  readonly status: "prepared"; readonly snapshot: StrategyPageSnapshot; readonly copy: AdminPageCopy;
  readonly envelope: AdminPageCopyEnvelope; readonly selectedTitle: AdminPageCopyRef;
  readonly rows: RuntimeContent; readonly body: RuntimeContent;
  readonly sourceSnapshot: StrategyPageContentSnapshot;
  readonly provenance: { readonly source: StrategyPageInput["source"]; readonly snapshotHash: string; readonly envelopeHash: string;
    readonly locale: "en"; readonly fields: readonly StrategyPageFieldProof[]; readonly ui: ReturnType<AdminPageCopy["provenance"]>;
    readonly briefFingerprints: readonly { readonly contract: string; readonly fingerprint: string }[] };
}
/** Stored beside consumerPage in each selected candidate's typeSettings. */
export interface StrategyPageContentSnapshot {
  readonly version: 1; readonly source: StrategyPageInput["source"]; readonly snapshotHash: string; readonly envelopeHash: string;
  readonly copySources: readonly { readonly source: string; readonly hash: string }[];
  readonly briefFingerprints: readonly { readonly contract: string; readonly fingerprint: string }[];
}
export type StrategyPageResult = PreparedStrategyPage | { readonly status: "refused"; readonly findings: readonly StrategyPageFinding[] };

/** Mirrors the existing strings.common contract; no long-form model or override. */
export const STRATEGY_PAGE_TEXT_LIMITS = Object.freeze({ maxChars: 320, maxWords: 60 });
const literalIcu = (text: string) => text.replace(/'/g, "''").replace(/\{/g, "'{'").replace(/\}/g, "'}'");
const refuse = (findings: readonly StrategyPageFinding[]): StrategyPageResult => runtimeSnapshot({ status: "refused" as const, findings });
const prepared = new WeakSet<PreparedStrategyPage>();

/** Server-only data adapter. Prepared data still requires native rendering
 * evidence, production approval, publication and consumer adoption. Copy and source
 * provenance stay outside StringRecord's closed schema. */
export function prepareStrategyPage(input: StrategyPageInput): StrategyPageResult {
  if (!input.source.id.trim() || !Number.isSafeInteger(input.source.revision) || input.source.revision < 1
    || !/^[a-z][a-z0-9.-]*$/.test(input.namespace) || !Array.isArray(input.contracts) || !input.contracts.length
    || new Set(input.contracts).size !== input.contracts.length || input.contracts.some(id => !id.trim())
    || input.scope !== undefined && !["core", "full"].includes(input.scope)
    || input.selected?.version !== undefined && (!Number.isSafeInteger(input.selected.version) || input.selected.version < 1)) return refuse([{ code: "strategy-input", message: "A source revision, namespace, scope and actual brief contracts are required" }]);
  if (input.issues?.length) return refuse(input.issues.map(issue => ({ ...issue, code: "strategy-root" as const })));
  let snapshot: StrategyPageSnapshot;
  try {
    const reader = input.open(), status = reader.status({ scope: input.scope ?? "core" });
    const technicalId = (value: string) => /^[a-z][a-z0-9.-]*$/.test(value);
    if (status.scope !== (input.scope ?? "core") || !status.l1.every(row => technicalId(row.id)) || !status.l2.every(row => technicalId(row.id))
      || status.nextUnlock !== undefined && !technicalId(status.nextUnlock)) throw new TypeError("Status identities differ from the selected scope");
    const briefs = input.contracts.map(id => {
      const brief = reader.getBrief(id);
      if (brief.contract !== id || !technicalId(id) || !/^[a-f0-9]{64}$/.test(brief.fingerprint)) throw new TypeError("Brief identity or fingerprint differs");
      return brief;
    });
    snapshot = runtimeSnapshot({ status, briefs, selected: input.selected ? reader.getCell(input.selected.id, input.selected.version) ?? null : null,
      cells: status.cells.map(canonical => {
        const latest = reader.getCell(canonical.id) ?? null, active = reader.getActive(canonical.id) ?? null;
        return { id: canonical.id, latest, active, canonical, latestStale: latest ? reader.isStale({ cell: latest.id, version: latest.version }) : null,
          activeStale: active ? reader.isStale({ cell: active.id, version: active.version }) : null };
      }) });
  } catch { return refuse([{ code: "strategy-read", message: "The immutable strategy snapshot or an installed brief contract could not be read" }]); }
  if (snapshot.selected && !snapshot.cells.some(cell => cell.id === snapshot.selected!.id)) return refuse([{ code: "strategy-input", message: "Selected cell is outside the requested catalogue scope", cellId: snapshot.selected.id, version: snapshot.selected.version }]);
  const findings: StrategyPageFinding[] = [], records: StringRecord[] = [], bindings: { cellId: string; recordId: string; target: string; kind: string }[] = [];
  const fields: (FieldSource & { recordId: string; context: string; text: string })[] = [];
  const uiIds = new Set<string>(input.envelopes.flatMap(envelope => envelope.envelope.records.map(record => record.id)));
  const allocated = new Set<string>();
  const bounded = (text: string, source: FieldSource) => {
    // Writer's WR7 counts Unicode code points and locale word boundaries of
    // literal display text. Escaped ICU source bytes are not display length.
    const chars = [...text].length, words = [...new Intl.Segmenter("en", { granularity: "word" }).segment(text)].filter(segment => segment.isWordLike).length;
    if (!text.trim() || chars > STRATEGY_PAGE_TEXT_LIMITS.maxChars || words > STRATEGY_PAGE_TEXT_LIMITS.maxWords) findings.push({ ...source, code: "copy-limit", message: `Complete display field exceeds strings.common bounds or is blank (${chars} characters, ${words} words)` });
  };
  let ui: AdminPageCopy;
  try {
    ui = createAdminPageCopy({ locale: "en", envelopes: input.envelopes });
    const { templates: _, ...labels } = input.labels;
    const visit = (value: object) => {
      if ("id" in value) {
        const resolved = ui.resolve(value as AdminPageCopyRef);
        if (resolved.provenance.locale !== "en") throw new TypeError("Strategy UI locale differs");
        bounded(resolved.text, { region: "ui" }); return;
      }
      Object.values(value).forEach(visit);
    };
    visit(labels);
  } catch { return refuse([{ code: "copy-source", message: "Writer refused the owned UI labels or vocabulary" }]); }
  const bool = (value: boolean, vocabulary = input.labels.boolean) => ui(vocabulary[value ? "true" : "false"]);
  const template = (name: keyof StrategyPageLabels["templates"], values: NonNullable<AdminPageCopyRef["values"]>, source: FieldSource = { region: "status" }): RuntimeJson => {
    const reference = { ...input.labels.templates[name], values };
    const display = ui.resolve(reference);
    if (display.provenance.locale !== "en") throw new TypeError("Strategy UI template locale differs");
    bounded(display.text, source);
    return writerCopy(reference);
  };
  const draft = (context: string, text: string, source: FieldSource, target = "sections.article/body"): AdminPageCopyRef => {
    const location = { ...source, context };
    let id: string;
    try { id = input.recordIdForContext(context); }
    catch { findings.push({ ...source, code: "copy-id", message: "Consumer draft id allocation failed" }); return { id: "" }; }
    const owners = input.ownedRecords.filter(record => record.id === id);
    const sameOwner = owners.length === 1 && owners[0]!.context === context && owners[0]!.leaf === "strings.common";
    if (!/^st\.[0123456789abcdefghjkmnpqrstvwxyz]{10}$/.test(id) || uiIds.has(id) || owners.length > 0 && !sameOwner || allocated.has(id)) findings.push({ ...source, code: "copy-id", message: "Draft id is malformed, belongs to another context/source or is allocated more than once" });
    allocated.add(id);
    bounded(text, source);
    records.push({ id: id as StringRecord["id"], leaf: "strings.common", context, status: "draft", origin: "authored", text: literalIcu(text) });
    bindings.push({ cellId: context, recordId: id, target, kind: "CopyRef" });
    fields.push({ ...location, recordId: id, text });
    return { id };
  };
  const field = (key: string, text: string, source: FieldSource = { region: "status" }, target?: string) => draft(`${input.namespace}.${key}`, text, source, target);
  const rows: RuntimeJson = snapshot.cells.map(cell => ({ id: cell.id,
    cell: writerCopy(field(`rows.${cell.id}.id`, cell.id, { cellId: cell.id, region: "metadata" }, "sections.data-table/rows")),
    latestVersion: cell.latest?.version ?? null, activeVersion: cell.active?.version ?? null,
    latestStatus: writerCopy(input.labels.fileStatus[cell.latest?.status ?? "missing"]),
    active: writerCopy(input.labels.boolean[cell.canonical.active ? "true" : "false"]),
    fresh: writerCopy(input.labels.boolean[cell.canonical.fresh ? "true" : "false"]),
  }));
  const body: RuntimeJson[] = [{ kind: "heading", text: writerCopy(input.labels.status) }];
  const paragraph = (key: string, text: string, source?: FieldSource) => body.push({ kind: "paragraph", text: writerCopy(field(key, text, source)) });
  const status = snapshot.status;
  try {
    const prose = (name: keyof StrategyPageLabels["templates"], values: NonNullable<AdminPageCopyRef["values"]>) => body.push({ kind: "paragraph", text: template(name, values) });
    prose("scope", { scope: ui(input.labels.scope[status.scope]), active: status.counts.active, total: status.counts.total, fresh: status.counts.fresh });
    prose("levels", { clean: bool(status.l0Clean), coherent: status.counts.coherentL2, unlocked: status.counts.unlockedL1 });
    prose("storyline", { critic: ui(input.labels.critic[status.storyline.critic]), clean: bool(status.storyline.clean), nextUnlock: status.nextUnlock ?? ui(input.labels.none) });
    status.l1.forEach(row => prose("l1", { id: row.id, state: bool(row.unlocked, input.labels.unlocked) }));
    status.l2.forEach(row => prose("l2", { id: row.id, state: bool(row.coherent, input.labels.coherent) }));
    snapshot.briefs.forEach(brief => prose("brief", { contract: brief.contract, state: ui(input.labels.briefState[brief.state]), missing: brief.missing.length, stale: brief.stale.length }));
  } catch { return refuse([{ code: "copy-source", message: "Writer refused a bound status template or vocabulary" }]); }
  status.findings.forEach((finding, index) => paragraph(`status.finding.${index}`, finding.message, { region: "status", ...(finding.cell ? { cellId: finding.cell } : {}), ...(finding.line ? { line: finding.line } : {}) }));
  const cell = snapshot.selected;
  let selectedTitle = input.labels.missing;
  if (cell) {
    const source = { cellId: cell.id, version: cell.version, cellFingerprint: runtimeHash(cell) };
    selectedTitle = field(`selected.${cell.id}.v${cell.version}.title`, cell.id, { ...source, region: "metadata" });
    body.push({ kind: "heading", text: writerCopy(selectedTitle) });
    const row = snapshot.cells.find(row => row.id === cell.id);
    try {
      body.push({ kind: "paragraph", text: template("metadata", { version: cell.version, status: ui(input.labels.fileStatus[cell.status]), pointer: row?.active ? String(row.active.version) : ui(input.labels.fileStatus.missing), active: bool(row?.canonical.active ?? false), fresh: bool(row?.canonical.fresh ?? false) }, { ...source, region: "metadata" }) });
    } catch { return refuse([{ code: "copy-source", message: "Writer refused a bound metadata template or vocabulary" }]); }
    row?.canonical.findings.forEach((finding, index) => paragraph(`canonical.${cell.id}.finding.${index}`, finding.message, {
      cellId: cell.id, ...(row.canonical.version === undefined ? {} : { version: row.canonical.version }),
      ...(row.active ? { cellFingerprint: runtimeHash(row.active) } : {}), region: "canonical-status", ...(finding.line ? { line: finding.line } : {}) }));
    for (const region of ["direction", "because", "watch"] as const) {
      body.push({ kind: "heading", text: writerCopy(input.labels[region]) });
      if (!cell[region].length) body.push({ kind: "paragraph", text: writerCopy(input.labels.empty) });
      else body.push({ kind: "list", items: cell[region].map((bullet, index) => writerCopy(field(`selected.${cell.id}.v${cell.version}.${region}.${index}`, bullet.key === undefined ? bullet.text : `${bullet.key}: ${bullet.text}`, { ...source, region, line: bullet.line, refs: bullet.refs, ...(bullet.key === undefined ? {} : { key: bullet.key }) }))) });
    }
  } else body.push({ kind: "paragraph", text: writerCopy(input.labels.missing) });
  if (findings.length) return refuse(findings);
  try {
    const envelope = prepareAdminPageCopyEnvelopes([{ source: input.source.id, envelope: { version: 1, revision: input.source.revision, state: "draft", locale: "en", activation: "none", records, bindings } }])[0]!;
    const copy = createAdminPageCopy({ locale: "en", envelopes: [...input.envelopes, envelope] });
    // Static labels must retain genuine owned bindings even if this selection
    // happens not to render an empty/missing region.
    const proofs = fields.map(item => {
      const resolved = copy.resolve({ id: item.recordId });
      if (resolved.text !== item.text || resolved.provenance.recordSource !== input.source.id || resolved.provenance.revision !== input.source.revision) throw new TypeError("Writer literal roundtrip or envelope provenance differs");
      return { ...item, writer: resolved.provenance };
    });
    const snapshotHash = runtimeHash({ ...snapshot, briefs: snapshot.briefs.map(({ compiledAt: _, ...brief }) => brief) });
    const envelopeHash = runtimeHash(envelope.envelope), briefFingerprints = snapshot.briefs.map(({ contract, fingerprint }) => ({ contract, fingerprint }));
    const sourceSnapshot = runtimeSnapshot({ version: 1 as const, source: input.source, snapshotHash, envelopeHash, briefFingerprints,
      copySources: input.envelopes.map(value => ({ source: value.source, hash: runtimeHash(value.envelope) })).sort((a, b) => a.source.localeCompare(b.source)) });
    const result: PreparedStrategyPage = Object.freeze({ status: "prepared" as const, snapshot, copy, envelope, selectedTitle, sourceSnapshot,
      rows: runtimeSnapshot(adminPageContent(copy, { kind: "records", ref: `${input.namespace}/rows` }, rows)),
      body: runtimeSnapshot(adminPageContent(copy, { kind: "region", ref: `${input.namespace}/item/body` }, body)),
      provenance: runtimeSnapshot({ source: input.source, snapshotHash, envelopeHash, locale: "en" as const, fields: proofs, ui: ui.provenance(), briefFingerprints }) });
    prepared.add(result); return result;
  } catch { return refuse([{ code: "copy-source", message: "Writer refused a bound source record, literal roundtrip or envelope provenance" }]); }
}

/** Existing canonical composition check plus exact strategy/Writer source pins.
 * No route, slot, candidate, revision, library or frame identity is synthesized. */
export function prepareStrategyPageRegistry(input: Omit<ConsumerPageContentInput, "copy"> & { readonly page: PreparedStrategyPage }) {
  if (!prepared.has(input.page)) throw new TypeError("An authentic prepared strategy projection is required");
  if (input.locale !== input.page.copy.locale) throw new TypeError("Strategy Writer locale differs from the selected route locale");
  for (const selection of input.selections) {
    const { candidate } = selectContentRoute(input.registry, selection.slotId, input.locale);
    if (runtimeHash(candidate.typeSettings.strategyPage ?? null) !== runtimeHash(input.page.sourceSnapshot)) throw new TypeError("Selected canonical candidate differs from the strategy or Writer source snapshot");
  }
  return prepareConsumerPageRegistry({ registry: input.registry, locale: input.locale, selections: input.selections, copy: input.page.copy });
}
