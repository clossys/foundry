/** Node-only read adapter. No renderer, migration, fill generator or approval writer is called. */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import bundledGraph from "../../reports/usage-graph.json" with { type: "json" };
import { flatten, references } from "../../../catalog-core/model.js";
import type { FillDoc } from "../../../catalog-core/types.js";
import { LAYERS } from "./check.js";
import type { CoverageInput, Edge, ExternalNode, Fill, Finding, Layer, Placement } from "./types.js";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
export const defaultCatalogRoot = existsSync(join(packageRoot, "src/catalog")) ? join(packageRoot, "src/catalog") : join(packageRoot, "dist/catalog");
export interface LoadOptions { catalogRoot?: string; writerCatalogRoot?: string; publisherInput?: string; checksInput?: string }
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const records = (value: unknown): Record<string, unknown>[] => Array.isArray(value) ? value.filter(object) : [];
const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
const read = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"));
const leafOf = (id: string): string => /^(tokens|assets|components|sections|frames)\./.test(id) ? id.split(".").slice(0, 2).join(".") : id;
function jsonFiles(root: string): string[] {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap(entry =>
    entry.isDirectory() ? jsonFiles(join(root, entry.name)) : entry.isFile() && entry.name.endsWith(".json") ? [join(root, entry.name)] : []);
}
/** Output guards use these roots too: a report must never replace catalog data. */
export function inputRoots(options: LoadOptions): string[] {
  return [options.catalogRoot ?? defaultCatalogRoot, options.writerCatalogRoot ?? defaultWriterRoot()].filter((path): path is string => !!path).map(path => resolve(path));
}
function defaultWriterRoot(): string | undefined {
  return [resolve(packageRoot, "../writer/src/catalog"), resolve(packageRoot, "../writer/dist/catalog")].find(path => existsSync(join(path, "slots/passages.json")));
}

export function loadCoverageInput(options: LoadOptions = {}): CoverageInput {
  const root = resolve(options.catalogRoot ?? defaultCatalogRoot), needs: string[] = [];
  const slots: { id: string; layer: Layer; contract: Record<string, unknown> }[] = [], placements: Placement[] = [];
  for (const layer of LAYERS) {
    const slotPath = join(root, "slots", `${layer}.json`), treePath = join(root, "ia", `${layer}.json`);
    if (existsSync(slotPath)) {
      const rows = read(slotPath);
      if (!Array.isArray(rows)) throw new TypeError(`${layer} slot registry must be an array`);
      for (const row of records(rows)) {
        if (typeof row.id !== "string" || row.layer !== layer || !object(row.contract)) throw new TypeError(`${layer} registry entry needs id, layer and contract`);
        slots.push({ id: row.id, layer, contract: row.contract });
      }
    } else needs.push(`Registry input unavailable: ${layer}`);
    if (existsSync(treePath)) placements.push(read(treePath) as Placement);
  }
  const aliases = new Map<string, string>();
  for (const layer of LAYERS) for (const kind of ["aliases", "retired"]) {
    const path = join(root, kind, `${layer}.json`);
    if (existsSync(path)) for (const row of records(read(path))) {
      const target = row.target ?? row.replacedBy;
      if (typeof row.id === "string" && typeof target === "string") aliases.set(row.id, target);
    }
  }
  const canonical = (id: string): string => {
    let target = leafOf(id); const seen = new Set<string>();
    while (aliases.has(target) && !seen.has(target)) { seen.add(target); target = aliases.get(target)!; }
    return target;
  };
  const fills: Fill[] = [], edges: Edge[] = [], external: ExternalNode[] = [], diagnostics: Finding[] = [];
  const add = (from: string, to: string, evidence: string, kind?: Edge["kind"]): void => { edges.push({ from, to, evidence, ...(kind ? { kind } : {}) }); };
  for (const path of jsonFiles(join(root, "fills"))) {
    const bytes = readFileSync(path, "utf8"), value: unknown = JSON.parse(bytes);
    const meta = object(value) && object(value.$extensions) ? value.$extensions["com.clossys.fill"] : undefined;
    if (!object(meta)) continue; // Known coverage reports are not fill documents.
    if (typeof meta.id !== "string" || typeof meta.slot !== "string") throw new TypeError(`Malformed fill metadata: ${path}`);
    const fill: Fill = { id: meta.id, leaf: canonical(meta.slot), hash: `sha256:${createHash("sha256").update(bytes).digest("hex")}` };
    if (object(meta.signoff) && typeof meta.signoff.by === "string" && typeof meta.signoff.date === "string" && typeof meta.signoff.ref === "string") fill.signoff = { by: meta.signoff.by, date: meta.signoff.date, ref: meta.signoff.ref };
    fills.push(fill);
    if (object(value) && object(value.tokens)) for (const token of Object.values(flatten(value as unknown as FillDoc))) for (const reference of references(token)) {
      const target = canonical(reference);
      // A member alias within a leaf is not a leaf-level consumption cycle.
      if (target !== fill.leaf) add(fill.leaf, target, "fill-token-reference");
    }
  }
  // Explicit composition/parts are relationships; allowedReads/allowedComposes are permissions, never inferred uses.
  for (const slot of slots) for (const id of [...strings(slot.contract.composes), ...strings(slot.contract.parts)]) add(slot.id, canonical(id), "contract-composition");
  const graphPath = join(root, "reports/usage-graph.json");
  const graph = existsSync(graphPath) ? read(graphPath) : root === resolve(defaultCatalogRoot) ? bundledGraph : undefined;
  if (object(graph)) {
    const reported = new Set(records(graph.nodes).filter(node => node.origin === "inventory").map(node => node.id));
    if (slots.some(slot => !reported.has(slot.id)) || reported.size !== slots.length) needs.push("Reported usage graph inventory differs from the current registry; connections are a partial lower bound.");
    for (const edge of records(graph.edges)) {
      if (typeof edge.from !== "string" || typeof edge.to !== "string" || edge.from.startsWith("pages.") || edge.to.startsWith("pages.")) continue;
      for (const evidence of strings(edge.evidence).filter(item => item === "scanned" || item === "runtime")) add(canonical(edge.from), canonical(edge.to), `reported-${evidence}`);
    }
    needs.push("Usage snapshot source freshness is not re-qualified here; reported-scanned/runtime edges retain their reported evidence basis.");
  } else needs.push("Source usage graph unavailable; only explicit data relationships are covered.");
  if (options.checksInput) {
    const rows = read(options.checksInput);
    if (!Array.isArray(rows)) throw new TypeError("Check results must be an array of fillId, sourceHash and results records");
    for (const row of records(rows)) {
      if (typeof row.fillId !== "string" || typeof row.sourceHash !== "string" || !Array.isArray(row.results) || !row.results.every(result => object(result) && typeof result.code === "string" && result.code.trim() && typeof result.passed === "boolean")) throw new TypeError("Malformed check result record");
      for (const fill of fills.filter(fill => fill.id === row.fillId)) (fill.checks ??= []).push({ sourceHash: row.sourceHash, results: records(row.results) as { code: string; passed: boolean }[] });
    }
  } else needs.push("No hash-bound per-fill executed check records supplied: existing fills remain draft, never inferred checked/approved from metadata labels.");

  const unavailablePackages: ("writer" | "publisher")[] = [];
  const writer = options.writerCatalogRoot ?? defaultWriterRoot();
  const passagePath = writer && join(writer, "slots/passages.json");
  if (passagePath && existsSync(passagePath)) {
    for (const passage of records(read(passagePath))) {
      if (typeof passage.id !== "string" || !object(passage.contract)) throw new TypeError("Malformed Writer passage registration");
      const contract = passage.contract;
      const id = `writer:${passage.id}`; external.push({ id, package: "writer", kind: "passage-schema" });
      if (typeof contract.sectionId === "string") add(id, canonical(contract.sectionId), "writer-schema-owner", "describes");
      const section = slots.find(slot => slot.id === contract.sectionId);
      if (section && section.contract.passageSchema !== passage.id) diagnostics.push({ code: "IA-BINDING-MISMATCH", priority: "P0", subject: id, target: section.id, message: "Writer passage owner and Designer passageSchema do not agree." });
    }
    for (const path of jsonFiles(join(writer!, "records"))) {
      const data = read(path);
      for (const record of records(object(data) ? data.records : data)) if (typeof record.id === "string") {
        const id = `writer:${record.id}`;
        if (!external.some(node => node.id === id)) external.push({ id, package: "writer", kind: "copy-record" });
        if (typeof record.schema === "string" && record.schema.startsWith("passages.")) add(id, `writer:${record.schema}`, "writer-record-schema");
      }
    }
  } else { unavailablePackages.push("writer"); needs.push("Writer passage/record registry input unavailable: cross-package resolution is unknown, not proven dangling."); }
  for (const slot of slots) if (typeof slot.contract.passageSchema === "string") add(slot.id, `writer:${slot.contract.passageSchema}`, "section-copy-schema");

  const adminRoots = slots.some(slot => slot.id === "frames.app-shell") ? ["frames.app-shell"] : [];
  const adminRoutes = ["/agents/designer", "/agents/writer", "/agents/publisher"];
  const registeredRoutes = new Set<string>();
  if (options.publisherInput) {
    const registry = read(options.publisherInput);
    if (!object(registry) || !Array.isArray(registry.slots) || !Array.isArray(registry.candidates)) throw new TypeError("Publisher input must be its ContentRegistry (slots and candidates)");
    for (const slot of records(registry.slots).filter(slot => typeof slot.route === "string" && adminRoutes.includes(slot.route))) {
      if (typeof slot.id !== "string") throw new TypeError("Publisher slot needs an id");
      const routeId = `publisher:slot/${slot.id}`; external.push({ id: routeId, package: "publisher", kind: "admin-route" }); adminRoots.push(routeId);
      if (typeof slot.activeCandidateId !== "string") { needs.push(`Admin slot ${slot.id} has no active candidate; reachability remains incomplete.`); continue; }
      const candidateId = `publisher:content/${slot.activeCandidateId}`;
      add(routeId, candidateId, "publisher-active-candidate");
      const candidate = records(registry.candidates).find(row => row.id === slot.activeCandidateId && row.slotId === slot.id);
      if (!candidate) continue;
      external.push({ id: candidateId, package: "publisher", kind: "composition" });
      const composition = candidate.composition;
      if (!object(composition) || !object(composition.frame) || typeof composition.frame.frameId !== "string") { needs.push(`Active candidate ${slot.activeCandidateId} has no frame composition.`); continue; }
      add(candidateId, canonical(composition.frame.frameId), "publisher-frame"); registeredRoutes.add(slot.route as string);
      for (const section of records(composition.sections)) {
        if (typeof section.sectionId === "string") add(candidateId, canonical(section.sectionId), "publisher-section");
        for (const field of records(section.fields)) if (field.source === "writer" && object(field.ref) && typeof field.ref.id === "string") add(candidateId, `writer:${field.ref.id}`, "publisher-copy-ref");
      }
    }
  } else { unavailablePackages.push("publisher"); needs.push("No consumer Publisher ContentRegistry supplied; no fixture is presented as a live admin page binding."); }
  const adminInputsComplete = adminRoutes.every(route => registeredRoutes.has(route));
  if (!adminInputsComplete) needs.push("Designer/Writer/Publisher console route bindings are incomplete; non-reachable leaves are unknown, not proven unreachable.");
  return { slots: slots.map(({ id, layer }) => ({ id, layer })), placements, fills, edges, external, adminRoots, adminInputsComplete, needs, unavailablePackages, diagnostics };
}
