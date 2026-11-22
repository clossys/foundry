/**
 * R03 Adopt or create, one certification (slot-constitution.md R03, W2-C). Status `building`:
 * reported, never failing a non-strict run (section 4), until the ledger (W2-B) records `submit`
 * and `verdict` events and the slots name standards (W2-I).
 *
 * - R03.1 each candidate's last `submit` event names a rung (adopt, adapt, create; the Designer's
 *   L1-L4 map through candidate-ladder.ts); adopt and adapt name a seed; create follows a `create`
 *   verdict (the latest verdict before the submit).
 * - R03.2 adopt is verbatim, for every candidate, not only pins: a Designer registry item's lineage
 *   passes the provenance rule against the reference manifest (certify/source.ts, the logic the
 *   Designer's check-provenance.mjs calls); another agent's adopt equals its seed candidate's bytes.
 *   A candidate submitted by code:adopt is the stock item of a byte-exact adopt slot, at rung L1
 *   with its seed (records/code-adopt.ts); any other is a row.
 * - R03.3 one certifier: `certify()` takes only slot, candidate and contract, and no certifier
 *   source reads a source kind, a rung or a seed (structural).
 * - R03.4 under an `adopt-first` standard, an adopt or adapt keeps every mapped seed file
 *   byte-exact (`meta.refVerbatim.files`) to the normalized reference (the seed as the consumer's
 *   components.json installs it, the text ref-verbatim compares with); an adapt only adds files.
 * - R03.5 under an `adopt-first` standard, a create follows a `create` verdict with a gap whose
 *   `class` is in the standard's `createGaps`, and imports no raw headless primitive.
 *
 * Ledger events (until W2-B's ledger.schema.json lands, read leniently): `{op: "submit", name |
 * candidate, rung, seed?, reason?}` and `{op: "verdict", create: true | verdict: "create", gaps:
 * [{id, class}]}`.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, posix } from "node:path";
import { normalizedSeedFile } from "@clossys/designer/ref-verbatim";
import { CODE_ADOPT, adoptionReaderOf, codeAdoptSubmitRefusal } from "../../records/code-adopt.js";
import { packagePath } from "../../package-path.js";
import { ladderIssues, rungKind, type GenericRung } from "../../pipeline/candidate-ladder.js";
import { ledgerEvents, standardFor, type Standard } from "../../records/standards.js";
import { readCandidateText } from "../../records/slot-current.js";
import { certifyEnv, slotDocOf } from "../certify/index.js";
import { isAgentLoopRecord } from "../certify/loop.js";
import { CERTIFY_INPUT_FIELDS } from "../certify/types.js";
import { backdropFindings, candidateLineage, carriesBackdrop, lineageFindings, resolveProvenanceRule, verbatimFindings, type ProvenanceRule, type ReferenceManifest } from "../certify/source.js";
import { candidateMeta, focusedLiveSlots, isObject, liveSlotRecords, registryFiles, row } from "../checks/shared.js";
import type { CandidateRecord, Check, ConstitutionContext, Row, RuleModule, SlotRecord } from "../types.js";

/** The Designer's provenance rule and reference manifest (workspace-relative). */
const DESIGNER_PACKAGE = "packages/designer";
export const PROVENANCE_RULE_PATH = `${DESIGNER_PACKAGE}/src/catalog/rules/provenance.json`;
export const REFERENCE_MANIFEST_PATH = "packages/designer/references/manifest.json";
/** `createGaps` when an adopt-first standard lists none (section 5a). */
export const DEFAULT_CREATE_GAPS = Object.freeze(["missing-behavior", "a11y-failure", "foundry-signature"]);
/** Raw headless primitives a create must not import directly (it composes React Aria through shadcn). */
export const RAW_HEADLESS = /^(?:react-aria(?:-components)?|@react-aria\/[^/]+|@react-stately\/[^/]+|@radix-ui\/[^/]+|@base-ui-components\/[^/]+|@headlessui\/[^/]+)(?:\/.*)?$/;
/** What a certifier must never read (R03.3). */
export const RUNG_READS = /\bsource\??\.kind\b|\bsourceKind\b|\.rung\b|\.seed\b|\brefVerbatim\b/;

type Event = Record<string, unknown>;
const text = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const ledgerPath = (slot: SlotRecord) => slot.ledger?.path ?? `${slot.dir}/ledger.json`;

/** The candidate's last `submit` event and the latest `verdict` before it. */
export function submitOf(slot: SlotRecord, candidate: string): { submit?: Event; verdict?: Event } {
  const events = ledgerEvents(slot.ledger?.value);
  let verdict: Event | undefined;
  let found: { submit?: Event; verdict?: Event } = {};
  for (const event of events) {
    if (event.op === "verdict") verdict = event;
    else if (event.op === "submit" && (event.name === candidate || event.candidate === candidate)) found = { submit: event, ...(verdict ? { verdict } : {}) };
  }
  return found;
}

export const isCreateVerdict = (event: Event | undefined): boolean => !!event && (event.create === true || event.verdict === "create" || event.kind === "create");
const gapClasses = (event: Event | undefined): string[] => (Array.isArray(event?.gaps) ? event!.gaps : []).flatMap(gap => (isObject(gap) && typeof gap.class === "string" ? [gap.class] : []));

/** The generic rung a submit names, or null when it names none or an unknown one. */
function rungOf(slot: SlotRecord, submit: Event | undefined): GenericRung | null {
  return submit && typeof submit.rung === "string" ? rungKind(slot.agent, submit.rung) : null;
}

/** The slot's standard when slot.json names one that exists. */
function standardOf(slot: SlotRecord, standards: readonly Standard[]): Standard | undefined {
  const id = slotDocOf(slot).doc.standard;
  return typeof id === "string" ? standardFor(standards, slot.agent, id) : undefined;
}

/** R03.1: every candidate of a live slot has a submit event naming a valid rung record. */
export const r03_1: Check = ctx => {
  const rows: Row[] = [];
  for (const slot of liveSlotRecords(ctx)) {
    for (const candidate of slot.candidates) {
      const { submit, verdict } = submitOf(slot, candidate.name);
      if (!submit) { rows.push(row("R03", "R03.1", slot, "no ledger submit event names this candidate's rung (adopt, adapt or create)", ledgerPath(slot), candidate.name)); continue; }
      const ladder = { rung: typeof submit.rung === "string" ? submit.rung : String(submit.rung), ...(submit.seed !== undefined ? { seed: submit.seed as string } : {}), ...(submit.reason !== undefined ? { reason: submit.reason as string } : {}) };
      for (const issue of ladderIssues(slot.agent, ladder)) rows.push(row("R03", "R03.1", slot, `submit ${issue.rule}: ${issue.detail}`, ledgerPath(slot), candidate.name));
      if (rungOf(slot, submit) === "create" && !isCreateVerdict(verdict)) {
        rows.push(row("R03", "R03.1", slot, verdict ? "create follows a verdict that is not create (P2 needs the slot's latest verdict to be create)" : "create follows no verdict (P2 needs the slot's latest verdict to be create)", ledgerPath(slot), candidate.name));
      }
    }
  }
  return rows;
};

interface Provenance { readonly rule?: ProvenanceRule; readonly manifest?: ReferenceManifest; readonly error?: string }
const PROVENANCE = new WeakMap<ConstitutionContext, Provenance>();
/** The provenance rule and manifest under the workspace root, read once per context. */
export function provenanceOf(ctx: ConstitutionContext): Provenance {
  let found = PROVENANCE.get(ctx);
  if (!found) {
    try {
      found = {
        rule: resolveProvenanceRule(
          JSON.parse(readFileSync(packagePath(ctx.root, PROVENANCE_RULE_PATH), "utf8")) as ProvenanceRule,
          rel => JSON.parse(readFileSync(packagePath(ctx.root, `${DESIGNER_PACKAGE}/${rel}`), "utf8")) as unknown,
        ),
        manifest: JSON.parse(readFileSync(packagePath(ctx.root, REFERENCE_MANIFEST_PATH), "utf8")) as ReferenceManifest,
      };
    } catch (error) {
      found = { error: `cannot read ${PROVENANCE_RULE_PATH} or ${REFERENCE_MANIFEST_PATH}: ${(error as Error).message}` };
    }
    PROVENANCE.set(ctx, found);
  }
  return found;
}

/**
 * The content digest (records/slot-current.ts contentDigest) of the seed named `<slot>/<candidate>` (or
 * `<agent>:<slot>/<candidate>`), optionally with the `@<sha256>` a reissue records (slot-constitution.md section 5,
 * Reissue: `seed <slot>/<old>@<sha>`, the old file retired). A live candidate gives its own digest (and its bytes must
 * still hold the recorded sha). A retired one counts only when the seed slot's ledger has a `retire-candidate` event
 * for that name with the recorded sha and the slot's `retired/` folder still holds those very bytes (their raw sha is
 * the recorded one): their digest is the seed's. Else a reason: no such seed, or a retired seed whose bytes are gone.
 */
function seedDigest(ctx: ConstitutionContext, slot: SlotRecord, seed: string): { digest: string } | { missing: string } {
  const none = { missing: "names no candidate (<slot>/<candidate>, or a retired one with its recorded @<sha256>)" };
  const m = /^(?:([a-z]+):)?([^/\s]+)\/([^/\s@]+)(?:@([0-9a-f]{64}))?$/.exec(seed);
  if (!m) return none;
  const agent = m[1] ?? slot.agent;
  const seedSlot = ctx.agents.find(item => item.agent === agent)?.slots.get(m[2]!);
  const recorded = m[4];
  const live: CandidateRecord | undefined = seedSlot?.candidates.find(candidate => candidate.name === m[3]);
  if (live) return recorded === undefined || recorded === live.sha256 ? { digest: live.contentDigest } : none;
  if (recorded === undefined || !seedSlot) return none;
  const retired = ledgerEvents(seedSlot.ledger?.value).some(event => event.op === "retire-candidate" && event.name === m[3] && event.sha256 === recorded);
  if (!retired) return none;
  const bytes = seedSlot.retired.find(record => record.name === m[3] && record.error === undefined && record.sha256 === recorded);
  if (!bytes) return { missing: `names a retired candidate whose bytes (sha256 ${recorded.slice(0, 12)}) are not in ${seedSlot.dir}/retired/` };
  return { digest: readCandidateText(seedSlot.slot?.value, seedSlot.agent, seedSlot.id, bytes.name, bytes.text, bytes.path).contentDigest };
}

/** R03.2: adopted candidates are verbatim (every candidate, not only pins). */
export const r03_2: Check = ctx => {
  const rows: Row[] = [];
  for (const slot of focusedLiveSlots(ctx)) {
    for (const candidate of slot.candidates) {
      const { submit } = submitOf(slot, candidate.name);
      const rung = rungOf(slot, submit);
      const label = `${slot.id}/${candidate.name}`;
      // DET-STEPS Adopt A: code authors only the stock item of a byte-exact adopt slot (records/code-adopt.ts).
      if (submit?.by === CODE_ADOPT) {
        const refused = codeAdoptSubmitRefusal(ctx.root, slot.agent, slot.id, submit);
        if (typeof refused === "string") rows.push(row("R03", "R03.2", slot, `submitted by ${CODE_ADOPT} where code may not author: ${refused}`, ledgerPath(slot), candidate.name));
      }
      // A Designer element's registry lineage; an agent loop candidate is a loop version, judged by certifyLoop.
      if (slot.agent === "designer" && !isAgentLoopRecord(slot)) {
        const item = candidate.name.endsWith(".json") ? candidate.json as Parameters<typeof candidateLineage>[1] : undefined;
        const lineage = item !== undefined ? candidateLineage(slot.id, item) : null;
        if (rung === "adopt" && lineage?.mode !== "verbatim") rows.push(row("R03", "R03.2", slot, `submit names rung ${String(submit!.rung)} (adopt) but meta.source.kind is not registry (verbatim)`, candidate.path, candidate.name));
        // An interactive backdrop descriptor (meta.backdrop) rides on the code candidate: judged on its own, beside the code's lineage.
        if (!lineage && !carriesBackdrop(item)) continue;
        const provenance = provenanceOf(ctx);
        if (provenance.error) { rows.push(row("R03", "R03.2", slot, provenance.error, candidate.path, candidate.name)); continue; }
        const findings = [...(lineage ? lineageFindings(label, lineage, { rule: provenance.rule!, manifest: provenance.manifest! }) : []), ...backdropFindings(label, slot.id, item, provenance.rule!)];
        for (const finding of findings) rows.push(row("R03", "R03.2", slot, finding, candidate.path, candidate.name));
        continue;
      }
      if (rung !== "adopt" || !text(submit!.seed)) continue;
      // Verbatim is the same content digest: every body byte, every field value and the source, not the per-file header provenance.
      const seed = seedDigest(ctx, slot, submit!.seed);
      if ("missing" in seed) rows.push(row("R03", "R03.2", slot, `adopts seed ${submit!.seed}, which ${seed.missing}`, candidate.path, candidate.name));
      else if (seed.digest !== candidate.contentDigest) rows.push(row("R03", "R03.2", slot, `adopts seed ${submit!.seed} but its bytes differ (content sha256 ${candidate.contentDigest.slice(0, 12)} != ${seed.digest.slice(0, 12)})`, candidate.path, candidate.name));
    }
  }
  return rows;
};

/** Certifier sources R03.3 scans (workspace-relative); source.ts is the R03 adopt helper, not a certifier. */
export const CERTIFIER_DIR = "packages/producer/src/constitution/certify";
const CERTIFIER_EXEMPT = new Set(["source.ts"]);
const stripComments = (code: string) => code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:\\])\/\/.*$/gm, "$1");

/** R03.3: the certifier's input fields are slot, candidate and contract, and no certifier reads a source kind, rung or seed. */
export const r03_3: Check = ctx => {
  const rows: Row[] = [];
  const at = { agent: "producer", id: "certify" } as const;
  const extra = CERTIFY_INPUT_FIELDS.filter(field => !["slot", "candidate", "contract"].includes(field));
  if (extra.length) rows.push(row("R03", "R03.3", at, `certify() takes ${extra.join(", ")}: it takes only slot, candidate and contract`, `${CERTIFIER_DIR}/types.ts`));
  const dir = join(ctx.root, CERTIFIER_DIR);
  if (!existsSync(dir)) return rows;
  for (const name of readdirSync(dir).sort()) {
    if (!/\.[cm]?[jt]s$/.test(name) || /\.(?:test|spec)\./.test(name) || name.endsWith(".d.ts") || CERTIFIER_EXEMPT.has(name)) continue;
    const hit = RUNG_READS.exec(stripComments(readFileSync(join(dir, name), "utf8")));
    if (hit) rows.push(row("R03", "R03.3", { agent: "producer", id: name }, `reads ${hit[0]}: one certifier serves every rung and never reads a source kind, rung or seed`, posix.join(CERTIFIER_DIR, name)));
  }
  return rows;
};

/** R03.4: under an adopt-first standard, adopt and adapt keep the seed's files byte-exact to the normalized reference. */
export const r03_4: Check = ctx => {
  const rows: Row[] = [];
  const env = certifyEnv(ctx);
  for (const slot of liveSlotRecords(ctx)) {
    const standard = standardOf(slot, env.standards);
    if (standard?.doc?.mode !== "adopt-first") continue;
    for (const candidate of slot.candidates) {
      const { submit } = submitOf(slot, candidate.name);
      const rung = rungOf(slot, submit);
      const lineage = slot.agent === "designer" && candidate.name.endsWith(".json") ? candidateLineage(slot.id, candidate.json as Parameters<typeof candidateLineage>[1]) : null;
      const adopted = rung === "adopt" || rung === "adapt" || (!submit && (lineage?.mode === "verbatim" || lineage?.mode === "customized"));
      if (!adopted) continue;
      const provenance = provenanceOf(ctx);
      if (provenance.error) { rows.push(row("R03", "R03.4", slot, provenance.error, candidate.path, candidate.name)); continue; }
      const manifest = provenance.manifest!;
      const referencesDir = dirname(packagePath(ctx.root, REFERENCE_MANIFEST_PATH));
      // A consumer adoption (meta.refVerbatim.reader) is compared with its reference normalized through the same reader.
      let reader: ReturnType<typeof adoptionReaderOf>;
      try { reader = adoptionReaderOf(ctx.consumer, candidate.json); }
      catch (error) { rows.push(row("R03", "R03.4", slot, `${standard.id} is adopt-first: ${error instanceof Error ? error.message : String(error)}`, candidate.path, candidate.name)); continue; }
      const normalized = (ref: string, path: string) => normalizedSeedFile(ctx.consumer, ref, path, { manifest, referencesDir, ...(reader ? { reader } : {}) });
      for (const finding of verbatimFindings(`${slot.id}/${candidate.name}`, candidate.json, manifest, normalized)) rows.push(row("R03", "R03.4", slot, `${standard.id} is adopt-first: ${finding}`, candidate.path, candidate.name));
    }
  }
  return rows;
};

/** Bare import specifiers of a candidate's code (registry files, or the text itself). */
export function importSpecifiers(candidate: CandidateRecord): string[] {
  const files = registryFiles(candidate);
  const sources = files.length ? files.map(file => file.content) : [candidate.text];
  const specs = new Set<string>();
  const pattern = /\b(?:import|export)\s+(?:type\s+)?(?:[^'"`;]*?\sfrom\s+)?["']([^"']+)["']|\bimport\(\s*["']([^"']+)["']\s*\)|\brequire\(\s*["']([^"']+)["']\s*\)/g;
  for (const source of sources) for (const m of source.matchAll(pattern)) specs.add((m[1] ?? m[2] ?? m[3])!);
  return [...specs].sort();
}

/** R03.5: a create under an adopt-first standard cites a create verdict with a createGaps gap and imports no raw headless primitive. */
export const r03_5: Check = ctx => {
  const rows: Row[] = [];
  const env = certifyEnv(ctx);
  for (const slot of liveSlotRecords(ctx)) {
    const standard = standardOf(slot, env.standards);
    if (standard?.doc?.mode !== "adopt-first") continue;
    const allowed = standard.doc.createGaps?.length ? standard.doc.createGaps : DEFAULT_CREATE_GAPS;
    for (const candidate of slot.candidates) {
      const { submit, verdict } = submitOf(slot, candidate.name);
      if (rungOf(slot, submit) !== "create") continue;
      if (!isCreateVerdict(verdict)) rows.push(row("R03", "R03.5", slot, `${standard.id} is adopt-first: create needs the P1 create verdict`, ledgerPath(slot), candidate.name));
      else if (!gapClasses(verdict).some(cls => allowed.includes(cls))) rows.push(row("R03", "R03.5", slot, `${standard.id} is adopt-first: the create verdict names no gap of class ${allowed.join(", ")}`, ledgerPath(slot), candidate.name));
      const raw = importSpecifiers(candidate).filter(spec => RAW_HEADLESS.test(spec));
      if (raw.length) rows.push(row("R03", "R03.5", slot, `${standard.id} is adopt-first: imports raw headless ${raw.join(", ")}; compose React Aria through shadcn`, candidate.path, candidate.name));
    }
  }
  return rows;
};

/** A candidate's `meta.source.kind`, for tests asserting R03.3's output identity. */
export const sourceKindOf = (candidate: CandidateRecord): unknown => {
  const meta = candidateMeta(candidate);
  return isObject(meta?.source) ? meta.source.kind : undefined;
};

export const R03_CHECKS = { "R03.1": r03_1, "R03.2": r03_2, "R03.3": r03_3, "R03.4": r03_4, "R03.5": r03_5 } as const;
export const R03: RuleModule = { rule: "R03", checks: R03_CHECKS };
