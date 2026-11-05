import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CONTENT_TREE } from "../../content/taxonomy.js";
import { FORMAT_IA, FORMAT_LEAVES, checkFormatRegistry } from "../../formats/index.js";
import type { ContentRegistry } from "../../content/model.js";
import type { CandidateStageEvidence } from "../../content/stage-engine.js";
import type { ReviewLibrarySnapshot } from "../../content/review/types.js";
import type { CoverageInput, WriterEntry } from "./types.js";

export const publisherPackageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const packageCatalog = (name: string) => {
  const root = resolve(publisherPackageRoot, "..", name);
  return [join(root, "src/catalog"), join(root, "dist/catalog")].find(path => existsSync(path)) ?? join(root, "src/catalog");
};
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
function rows(value: unknown, description: string): Record<string, unknown>[] {
  if (!Array.isArray(value) || value.some(row => !object(row))) throw new TypeError(`${description} must be an array of records`);
  return value as Record<string, unknown>[];
}
const strings = (value: unknown) => Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
const id = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const files = (path: string): string[] => existsSync(path) ? readdirSync(path, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap(entry =>
  entry.isDirectory() ? files(join(path, entry.name)) : entry.isFile() && entry.name.endsWith(".json") ? [join(path, entry.name)] : []) : [];
export interface LoadOptions { registry?: string; evidence?: string; libraries?: string; designerCatalog?: string; writerCatalog?: string }

/** Source catalogs are registrations, never a substitute for a live consumer library or registry. */
export function loadPublisherIAInput(options: LoadOptions = {}): CoverageInput {
  const input: CoverageInput = { contentTree: CONTENT_TREE, declaredSlots: [], formatTree: FORMAT_IA, formats: FORMAT_LEAVES,
    designer: [], writer: [], libraries: [], evidence: [], edges: [], needs: [], unavailable: [], diagnostics: [], inputHashes: {} };
  const read = (path: string, label: string): unknown => {
    const bytes = readFileSync(path); input.inputHashes![label] = createHash("sha256").update(bytes).digest("hex");
    return JSON.parse(bytes.toString("utf8")) as unknown;
  };
  const freeze = [join(publisherPackageRoot, "src/content/slots.leaf-freeze.json"), join(publisherPackageRoot, "dist/content/slots.leaf-freeze.json")].find(path => existsSync(path));
  if (!freeze) throw new TypeError("Publisher slot membership snapshot is unavailable");
  const membership = read(freeze, "publisher/slots.leaf-freeze.json");
  if (!object(membership) || !Array.isArray(membership.leafIds) || !membership.leafIds.every(id)) throw new TypeError("Invalid Publisher slot membership snapshot");
  input.declaredSlots = membership.leafIds as string[];
  if (options.registry) {
    const registry = read(resolve(options.registry), "input/registry.json");
    if (!object(registry) || !object(registry.workspace)) throw new TypeError("Registry requires a workspace, slots and candidates");
    rows(registry.slots, "Registry slots"); rows(registry.candidates, "Registry candidates");
    input.registry = registry as unknown as ContentRegistry;
  } else input.needs.push("No consumer ContentRegistry supplied. Frozen slot membership has no placement/route records; observed missing slots do not establish deployed host absence. No fixture is loaded.");
  if (options.evidence) input.evidence = rows(read(resolve(options.evidence), "input/evidence.json"), "Candidate evidence") as unknown as CandidateStageEvidence[];
  else input.needs.push("No executed candidate-stage evidence supplied. Missing proof remains Waiting; candidate state labels do not establish checked/approved.");
  if (options.libraries) input.libraries = rows(read(resolve(options.libraries), "input/libraries.json"), "Consumer libraries") as unknown as ReviewLibrarySnapshot[];
  else input.needs.push("No consumer Designer library snapshots supplied; source catalog declarations do not establish exact consumer/version/config registration.");

  const designerRoot = resolve(options.designerCatalog ?? packageCatalog("designer"));
  const writerRoot = resolve(options.writerCatalog ?? packageCatalog("writer"));
  const aliases = new Map<string, string>();
  const leafOf = (value: string): string => value.split(".").slice(0, 2).join(".");
  for (const layer of ["themes", "assets", "components", "sections", "frames"]) {
    const path = join(designerRoot, "slots", `${layer}.json`);
    if (!existsSync(path)) { if (!input.unavailable.includes("designer")) input.unavailable.push("designer"); input.needs.push(`Designer registry unavailable: ${layer}`); continue; }
    for (const row of rows(read(path, `designer/slots/${layer}.json`), "Designer slots")) {
      if (!id(row.id) || !object(row.contract)) throw new TypeError("Designer registration needs an id and contract");
      input.designer.push({ id: row.id, ...(id(row.contract.passageSchema) ? { passageSchema: row.contract.passageSchema } : {}) });
    }
    for (const area of ["aliases", "retired"]) {
      const path = join(designerRoot, area, `${layer}.json`);
      if (existsSync(path)) for (const row of rows(read(path, `designer/${area}/${layer}.json`), "Designer aliases")) {
        const target = row.target ?? row.replacedBy; if (id(row.id) && id(target)) aliases.set(row.id, target);
      }
    }
  }
  const canonical = (value: string): string => {
    let current = leafOf(value); const seen = new Set<string>();
    while (aliases.has(current) && !seen.has(current)) { seen.add(current); current = aliases.get(current)!; }
    return current;
  };
  const graphPath = join(designerRoot, "reports/usage-graph.json");
  if (existsSync(graphPath)) {
    const graph = read(graphPath, "designer/reports/usage-graph.json");
    if (!object(graph)) throw new TypeError("Designer graph must be a record");
    for (const edge of rows(graph.edges, "Designer graph edges")) {
      // Do not infer permissions, page fixtures or member aliases as actual consumer relationships.
      if (!id(edge.from) || !id(edge.to) || !/^(tokens|assets|components|sections|frames)\./.test(edge.from) || !/^(tokens|assets|components|sections|frames)\./.test(edge.to)) continue;
      const from = canonical(edge.from), to = canonical(edge.to);
      if (from === to) continue;
      for (const evidence of strings(edge.evidence).filter(value => value === "scanned" || value === "runtime"))
        input.edges.push({ from: `designer:${from}`, to: `designer:${to}`, kind: "uses", evidence: `reported-${evidence}` });
    }
    input.needs.push("Designer usage-snapshot freshness is not re-qualified by this command; scanned/runtime edges retain their reported basis. Declared permissions and page fixtures are not consumption proof.");
  } else input.needs.push("Designer usage graph unavailable; admin reachability is a partial lower bound.");
  const schemaPath = join(writerRoot, "slots/passages.json");
  if (existsSync(schemaPath)) {
    for (const row of rows(read(schemaPath, "writer/slots/passages.json"), "Writer passage schemas")) {
      if (!id(row.id) || !object(row.contract)) throw new TypeError("Writer schema needs an id and contract");
      input.writer.push({ id: row.id, kind: "schema", ...(id(row.contract.sectionId) ? { sectionId: row.contract.sectionId } : {}) });
    }
  } else { input.unavailable.push("writer"); input.needs.push("Writer passage schema registry unavailable; unresolved package links are unknown, not proven dangling."); }
  const records = new Map<string, WriterEntry>(), identities = new Set<string>();
  const inspectRecord = (row: Record<string, unknown>, locale: string | undefined): void => {
    if (!id(row.id) || !/^(?:lx|st|pt|ps|nr)\.[0123456789abcdefghjkmnpqrstvwxyz]{10}$/.test(row.id)) throw new TypeError("Invalid Writer record identity");
    const identity = JSON.stringify([locale ?? null, row.id]);
    if (identities.has(identity)) throw new TypeError(`Duplicate Writer record in locale ${locale ?? "unknown"}: ${row.id}`);
    identities.add(identity);
    if (!locale) input.needs.push(`Writer record ${row.id} has no observed locale; it cannot establish a localized copy binding.`);
    const refs = new Set<string>();
    const walk = (value: unknown, key = ""): void => {
      if (Array.isArray(value)) { value.forEach(entry => walk(entry)); return; }
      if (!object(value)) return;
      if (id(value.id) && (typeof value.ref === "string" || key === "ref")) refs.add(value.id);
      for (const [name, entry] of Object.entries(value)) if (name !== "text" && name !== "context") walk(entry, name);
    };
    walk(row);
    const entry: WriterEntry = { id: row.id, kind: "record", ...(id(row.schema) ? { schema: row.schema } : {}), refs: [...refs].sort(), ...(locale ? { locales: [locale] } : {}) };
    const previous = records.get(row.id);
    if (previous && previous.schema !== entry.schema) throw new TypeError("Writer record identity has ambiguous schemas");
    records.set(row.id, previous ? { ...previous, refs: [...new Set([...(previous.refs ?? []), ...refs])].sort(), locales: [...new Set([...(previous.locales ?? []), ...entry.locales ?? []])].sort() } : entry);
  };
  for (const path of files(join(writerRoot, "records"))) {
    const data = read(path, `writer/records/${path.slice(join(writerRoot, "records").length + 1)}`);
    if (Array.isArray(data)) for (const row of rows(data, "Writer records")) inspectRecord(row, id(row.locale) ? row.locale : undefined);
    else if (object(data)) {
      if (Object.hasOwn(data, "records")) for (const row of rows(data.records, "Writer records")) inspectRecord(row, id(data.locale) ? data.locale : undefined);
      if (object(data.locales)) for (const [tag, locale] of Object.entries(data.locales)) {
        if (!object(locale)) throw new TypeError("Writer locale must be a record");
        for (const row of rows(locale.records, "Writer locale records")) inspectRecord(row, tag);
      }
    }
  }
  input.writer.push(...records.values());
  input.diagnostics!.push(...checkFormatRegistry().map(row => ({ code: "IA-FORMAT-REGISTRY", priority: "P0" as const, subject: `publisher:format/${row.subject}`, message: row.message })));
  return input;
}
