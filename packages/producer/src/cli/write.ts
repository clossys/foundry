import { join } from "node:path";
import type { Cell } from "@clossys/strategist";
import type { WriterSlotBodyRecord } from "@clossys/writer/slot-body";
import { agentModule } from "../server/cells.js";
import { directorRef, pinnedStrategyModel, readPinnedDirector } from "../records/director-pinned.js";
import { agentRefs, candidateDocument, readPinned, type PinnedCandidate } from "../records/pinned.js";
import { hasSlotModel, readIa } from "../records/slots.js";
import type { CliArgs } from "./args.js";
import type { CliResult } from "./main.js";
import { emitProjection } from "./projection.js";

/** The Director slots a Writer derives from (the Writer's own brief inputs). */
const INPUTS = ["identity.brand.essence", "identity.brand.personality", "identity.visual.style", "identity.verbal.voice", "focus.segment.core", "focus.category.stance", "advantage.proposition.proof"] as const;
const OBLIGED = ["identity.brand.personality", "identity.verbal.voice"];
interface Finding { rule: string; slot?: string; message: string }
interface WriterRows { candidate: PinnedCandidate; locales: string[]; rows: WriterSlotBodyRecord[] }

function workspace(root: string): string {
  const consumer = join(root, "clossys");
  if (!hasSlotModel(consumer) || !readIa(consumer, "director")) throw new Error("clossys/agents/director/ia.json is missing");
  if (!readIa(consumer, "writer")) throw new Error("clossys/agents/writer/ia.json is missing");
  return consumer;
}

/** The pinned Director inputs a Writer session reads, with the voice and personality lines it must realise. */
function writerBrief(cells: readonly Cell[], catalog: { slots: { id: string; layer: string; contract: Record<string, unknown> }[] }, layers: readonly string[]) {
  const selected = cells.filter(cell => (INPUTS as readonly string[]).includes(cell.id));
  return {
    schemaVersion: 1 as const, agent: "writer" as const,
    directorInputs: selected.map(cell => ({ id: cell.id, version: cell.version, ref: directorRef(cell), path: cell.path, direction: cell.direction, because: cell.because, watch: cell.watch })),
    leaves: layers.map(layer => ({ layer, role: [...new Set(catalog.slots.filter(slot => slot.layer === layer).map(slot => String(slot.contract.recordKind ?? slot.contract.kind)))].join(", "), ids: catalog.slots.filter(slot => slot.layer === layer).map(slot => slot.id) })),
    missingInputs: INPUTS.filter(id => !selected.some(cell => cell.id === id)),
    obligations: selected.filter(cell => OBLIGED.includes(cell.id)).flatMap(cell => cell.direction.map(bullet => ({ id: `${directorRef(cell)}#L${bullet.line}`, ref: directorRef(cell), line: bullet.line, ...(bullet.key ? { key: bullet.key } : {}), text: bullet.text }))),
  };
}

/** Every pinned Writer candidate's rows, read by the Writer's own slot-body parser. */
async function pinnedRows(candidates: readonly PinnedCandidate[], findings: Finding[]): Promise<WriterRows[]> {
  const parser = await agentModule("writer", "slot-body.js");
  const out: WriterRows[] = [];
  for (const candidate of candidates) {
    try {
      const { fields, body } = candidateDocument(candidate);
      const locales = Array.isArray(fields.locales) ? fields.locales.filter((locale): locale is string => typeof locale === "string") : [];
      out.push({ candidate, locales, rows: parser.parseWriterSlotBody(body, locales) });
    } catch (error) {
      findings.push({ rule: "writer-candidate-unreadable", slot: candidate.id, message: error instanceof Error ? error.message : String(error) });
    }
  }
  return out;
}

const isCopy = (slot: string, row: WriterSlotBodyRecord) => !slot.startsWith("lexicon.") && typeof row.record.text === "string";

/**
 * Deterministic Writer verb over the slot model: `--brief` assembles the pinned Director inputs,
 * `--check` runs the Writer's derivation, locale and won't-claim checks over the pinned Writer
 * set, and the default compile prints the pinned rows by locale (written only to `--out`).
 */
export async function runWrite(args: CliArgs, root: string): Promise<CliResult> {
  const base = { verb: "write" as const, root, check: args.check };
  try {
    const consumer = workspace(root);
    const director = await readPinnedDirector(consumer);
    if (args.brief) {
      const ia = await agentModule("writer", "catalog/ia/index.js");
      const ids = await agentModule("writer", "catalog-core/ids.js");
      const brief = writerBrief(director.cells, ia.loadWriterCatalog(), ids.WRITER_LAYERS);
      const emitted = await emitProjection(args, root, "writer brief", brief);
      return { ...base, exitCode: brief.missingInputs.length ? 1 : 0, brief, message: emitted ? `write: brief written to ${emitted}` : JSON.stringify(brief, null, 2) };
    }
    const writer = readPinned(consumer, "writer");
    const findings: Finding[] = writer.issues.map(issue => ({ rule: issue.reason, slot: issue.slot, message: issue.message }));
    const rows = await pinnedRows(writer.pinned, findings);
    if (!args.check) {
      const byLocale: Record<string, { slot: string; id: unknown; kind: unknown; text?: unknown }[]> = {};
      for (const { candidate, rows: list } of rows) for (const row of list) {
        (byLocale[row.locale] ??= []).push({ slot: candidate.id, id: row.record.id, kind: row.record.kind, ...(typeof row.record.text === "string" ? { text: row.record.text } : {}) });
      }
      const compilation = { schemaVersion: 1 as const, agent: "writer" as const, slots: rows.map(({ candidate }) => ({ id: candidate.id, candidate: candidate.name, version: candidate.version, sha256: candidate.sha256 })), locales: byLocale };
      const emitted = await emitProjection(args, root, "writer", compilation);
      const count = Object.values(byLocale).reduce((sum, list) => sum + list.length, 0);
      return { ...base, exitCode: findings.length ? 1 : 0, compilation, message: [
        `write: compiled ${rows.length} pinned Writer slot(s) (${count} records)${emitted ? ` to ${emitted}` : ""}; ${writer.unpinned.length} unpinned`,
        ...findings.map(finding => `${finding.rule}${finding.slot ? ` (${finding.slot})` : ""}: ${finding.message}`),
        ...(emitted ? [] : [JSON.stringify(compilation, null, 2)]),
      ].join("\n") };
    }

    // Derivation: each pinned Writer slot names the pinned Director versions it derives from.
    const pinnedDirector = new Map(director.cells.map(cell => [cell.id, cell.version]));
    for (const id of INPUTS) if (!pinnedDirector.has(id)) findings.push({ rule: "director-input-missing", slot: id, message: `No pinned Director input: ${id}` });
    const limits: string[] = [];
    for (const { candidate } of rows) {
      for (const input of candidate.doc.inputs) if (!pinnedDirector.has(input)) findings.push({ rule: "director-input-unpinned", slot: candidate.id, message: `Declared input director:${input} has no pinned candidate` });
      const refs = agentRefs(candidateDocument(candidate).fields, "director");
      for (const ref of refs) if (pinnedDirector.get(ref.slot) !== ref.version) findings.push({ rule: "director-link-stale", slot: candidate.id, message: `Director link is absent or not the pinned version: ${ref.ref}` });
    }
    // Voice derivation: record-level directorSources against the pinned voice/personality lines.
    const ia = await agentModule("writer", "catalog/ia/index.js");
    const ids = await agentModule("writer", "catalog-core/ids.js");
    const brief = writerBrief(director.cells, ia.loadWriterCatalog(), ids.WRITER_LAYERS);
    const sources = await agentModule("writer", "model/director-sources.js");
    const obligations = new Set(brief.obligations.map(obligation => obligation.id));
    const mapped: string[] = [];
    for (const { candidate, rows: list } of rows) for (const row of list) {
      const declared = row.record.directorSources;
      if (declared === undefined) continue;
      if (!Array.isArray(declared)) { findings.push({ rule: "director-source-invalid", slot: candidate.id, message: "directorSources must be an array of {ref, line}" }); continue; }
      for (const source of declared) {
        if (!sources.isDirectorSource(source)) { findings.push({ rule: "director-source-invalid", slot: candidate.id, message: `Invalid source mapping on record ${String(row.record.id)}` }); continue; }
        const id = `${source.ref}#L${source.line}`;
        mapped.push(id);
        if (!obligations.has(id)) findings.push({ rule: "director-source-stale", slot: candidate.id, message: `Record source does not identify a pinned voice or personality Direction line: ${id}` });
      }
    }
    if (mapped.length) {
      const coverage = await agentModule("writer", "voice/derivation-coverage.js");
      const voice = coverage.checkVoiceDerivationCoverage([...obligations], [...new Set(mapped)]);
      for (const id of voice.obligationsMissingFromRecord) findings.push({ rule: "voice-derivation-coverage:missing", slot: id, message: `Director rule has no Writer realisation: ${id}` });
      for (const id of voice.recordRulesNotObliged) findings.push({ rule: "voice-derivation-coverage:unobliged", slot: id, message: `Writer source has no pinned Director obligation: ${id}` });
      if (!voice.ok && voice.reason !== "coverage-gap") limits.push(`voice-derivation-coverage: ${voice.reason}`);
    } else if (obligations.size) {
      limits.push(`voice-derivation-trace-undeclared: no pinned Writer record declares directorSources, so ${obligations.size} voice/personality line(s) are traced at slot level (source.ref) only`);
    }
    // Locale coverage over the pinned copy rows, by the Writer's own checker.
    const locales = [...new Set(rows.flatMap(row => row.locales))].sort();
    const sourceLocale = locales.includes("en") ? "en" : locales[0];
    const registries: Record<string, unknown> = {};
    for (const locale of locales) {
      const entries = rows.flatMap(({ candidate, rows: list }) => list.filter(row => row.locale === locale && isCopy(candidate.id, row))
        .map(row => ({ ...row.record, status: row.record.status === "approved" || row.record.status === "retired" ? row.record.status : "draft" })));
      if (entries.length) registries[locale] = { id: "writer-slots", locale, revision: rows.map(({ candidate }) => `${candidate.id}@${candidate.version}`).join(","), source: { kind: "consumer", reference: "writer-slots" }, entries };
    }
    const localeApi = await agentModule("writer", "locale-coverage.js");
    const localeCoverage = sourceLocale ? localeApi.checkLocaleCoverage(registries, sourceLocale, locales) : undefined;
    if (!localeCoverage) limits.push("locale-coverage: no pinned Writer locale");
    else {
      for (const finding of localeCoverage.findings) findings.push({ rule: finding.rule, slot: finding.entryId, message: finding.message });
      if (!localeCoverage.complete) limits.push("locale-coverage: incomplete");
    }
    // Won't-claim drift over the pinned copy, against the pinned Director prohibitions.
    const api = await agentModule("director", "index.js");
    const copy = rows.flatMap(({ candidate, rows: list }) => list.filter(row => isCopy(candidate.id, row))
      .map(row => ({ path: `${candidate.path}#${row.locale}/${String(row.record.id)}`, content: row.record.text as string })));
    const wontClaim = api.checkWontClaimDrift(copy, pinnedStrategyModel(consumer, director.cells, []));
    for (const finding of wontClaim.findings) findings.push({ rule: "wont-claim:hit", slot: finding.file, message: finding.message });
    for (const reason of wontClaim.indeterminateReasons) limits.push(`wont-claim: ${reason}`);
    for (const id of wontClaim.unchecked) limits.push(`wont-claim:unchecked: unquoted prohibition requires owner interpretation: ${id}`);
    for (const ignored of wontClaim.ignored) limits.push(`wont-claim:ignored: ${ignored.file} line ${ignored.line} carries a prohibition ignore marker`);
    const cannotRun = !localeCoverage?.complete || wontClaim.state === "indeterminate" || limits.some(limit => limit.startsWith("voice-derivation-coverage:"));
    const exitCode = cannotRun ? 2 : findings.length ? 1 : 0;
    const records = copy.length;
    return { ...base, exitCode, checks: { findings, limits, writerCount: rows.length, directorCount: director.cells.length, records, localeCoverage, wontClaim }, message: [
      `write: ${rows.length} pinned Writer slot(s) checked (${records} copy records, ${locales.length} locale(s)); ${findings.length} finding(s)`,
      ...findings.map(finding => `${finding.rule}${finding.slot ? ` (${finding.slot})` : ""}: ${finding.message}`),
      ...limits.map(limit => `Limit: ${limit}`),
    ].join("\n") };
  } catch (error) {
    return { ...base, exitCode: 2, message: `write: could not run: ${error instanceof Error ? error.message : String(error)}` };
  }
}
