import { WRITER_LAYERS, type WriterLayer } from "../../catalog-core/ids.js";
import { validateWriterRecord } from "../../model/validate.js";
import type { WriterRecord } from "../../model/types.js";
import { checkWriterClosedWorld } from "../closed-world.js";
import { checkWriterPurity } from "../purity.js";
import { checkWriterCoverage } from "../coverage.js";
import { checkWriterLength } from "../length.js";
import { checkWriterICU } from "../icu.js";
import { checkWriterExpansion } from "../expansion.js";
import { checkWriterLint } from "../lint/index.js";
import { checkWriterApproval } from "../approval.js";
import type { WriterCheckFinding, WriterCheckOptions } from "../freeze.js";
import { graphCycles, reachableFrom } from "./graph.js";
import type { CoverageInput, CoverageFinding, CoverageEdge, CoverageLeaf, CoverageReport, FillState } from "./types.js";
export type * from "./types.js";

const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const order: readonly FillState[] = ["absent", "draft", "checked", "approved"];

/** An observation, never a fill, an owner approval, or a catalog rewrite. */
export function checkIACoverage(input: CoverageInput): CoverageReport {
  const findings: CoverageFinding[] = [], keys = new Set<string>();
  const find = (code: string, priority: CoverageFinding["priority"], subject: string, detail: string): void => {
    const id = JSON.stringify([code, subject, detail]);
    if (!keys.has(id)) { keys.add(id); findings.push({ id, code, priority, subject, detail }); }
  };
  const writer = new Map(input.catalog.slots.map(slot => [slot.id, slot]));
  const designer = new Map(input.designer.slots.map(slot => [slot.id, slot]));
  const nodes = new Set([...writer.keys(), ...designer.keys()]);
  for (const standard of input.designer.standards ?? []) {
    nodes.add(standard.id);
    for (const clause of standard.clauses) nodes.add(`${standard.id}#${clause.id}`);
  }
  for (const row of input.connections?.nodes ?? []) {
    if (nodes.has(row.id)) find("duplicate-id", "P0", row.id, "Connection node duplicates a registered identity");
    nodes.add(row.id);
  }
  if (writer.size !== input.catalog.slots.length) find("duplicate-id", "P0", "writer", "Writer registry contains duplicate leaf IDs");
  if (designer.size !== input.designer.slots.length) find("duplicate-id", "P0", "designer", "Designer catalog contains duplicate IDs");
  const paths = new Map<string, string[][]>();
  const levels = { L0: input.catalog.placements.length, L1: 0, L2: 0, L3: 0 };
  const boards = input.catalog.placements.map(placement => {
    const groups: { id: string; level: number; parent: string; leaves: string[] }[] = [], seen = new Set<string>();
    const visit = (list: typeof placement.nodes, ancestors: string[]): string[] => list.flatMap(node => {
      const depth = ancestors.length;
      if (depth > 2 || seen.has(node.id)) { find("invalid-group", "P0", `${placement.layer}/${node.id}`, "Duplicate group or depth beyond L2"); return []; }
      seen.add(node.id);
      if (depth === 1) levels.L1++; else levels.L2++;
      const branch = [...ancestors, node.id];
      const leaves = "children" in node ? visit(node.children, branch) : [...node.leaves];
      if (!leaves.length) find("empty-group", "P2", branch.join("/"), "Declared group has no leaves");
      if ("leaves" in node) {
        if (depth !== 2) find("invalid-group", "P0", branch.join("/"), "L3 leaves require both L1 and L2 groups");
        for (const id of leaves) {
          paths.set(id, [...paths.get(id) ?? [], branch]);
          if (!writer.has(id)) find("missing-leaf", "P0", id, "IA leaf has no registered Writer entry");
          else if (writer.get(id)!.layer !== placement.layer) find("wrong-board", "P0", id, "IA board differs from registered layer");
        }
      }
      groups.push({ id: node.id, level: depth, parent: ancestors.at(-1)!, leaves });
      return leaves;
    });
    visit(placement.nodes, [placement.layer]);
    return { layer: placement.layer, groups };
  });
  levels.L3 = paths.size;
  for (const layer of WRITER_LAYERS) if (!boards.some(board => board.layer === layer)) find("missing-board", "P0", layer, "Writer layer has no IA board");
  for (const board of boards) if (boards.filter(row => row.layer === board.layer).length !== 1 || !(WRITER_LAYERS as readonly string[]).includes(board.layer)) find("invalid-board", "P0", board.layer, "Expected one board per Writer layer");
  for (const id of writer.keys()) if (!paths.has(id)) find("outside-tree", "P0", id, "Registered Writer leaf is outside the declared IA");
  for (const [id, rows] of paths) if (rows.length !== 1) find("duplicate-placement", "P0", id, "Leaf occurs more than once in the IA");

  const edgeMap = new Map<string, CoverageEdge>();
  const edge = (from: string, to: string, kind: CoverageEdge["kind"]): void => {
    // A record's schema or another record in its own leaf is not a leaf cycle.
    if (from === to && kind === "record") return;
    const row = { from, to, kind }; edgeMap.set(JSON.stringify(row), row);
  };
  for (const slot of input.catalog.slots) for (const to of slot.requires) edge(slot.id, to, "requires");
  for (const slot of input.designer.slots) for (const to of [...slot.requires ?? [], ...strings(slot.contract.parts), ...strings(slot.contract.composes)]) edge(slot.id, to, "requires");
  for (const row of input.connections?.nodes ?? []) for (const to of row.uses) edge(row.id, to, "external");
  const pairs: { section: string; passage: string; resolved: boolean }[] = [];
  for (const slot of input.designer.slots) {
    if (slot.contract.kind !== "section" || typeof slot.contract.passageSchema !== "string") continue;
    const passage = slot.contract.passageSchema, target = writer.get(passage);
    const resolved = target?.contract.sectionId === slot.id && target.contract.passageSchema === passage;
    pairs.push({ section: slot.id, passage, resolved }); edge(slot.id, passage, "schema");
    if (!resolved) find("schema-pair", "P0", passage, `Designer ${slot.id} does not have a matching Writer passage contract`);
  }
  for (const slot of input.catalog.slots) if (slot.contract.kind === "passage") {
    const section = slot.contract.sectionId;
    if (typeof section !== "string" || designer.get(section)?.contract.passageSchema !== slot.id) find("schema-pair", "P0", slot.id, "Writer passage does not resolve back to its Designer section");
  }

  const records: { locale: string; record: WriterRecord }[] = [];
  const recordNodes = new Set<string>(), recordEdges: CoverageEdge[] = [];
  const shape = new Map<WriterRecord, string[]>();
  const contents = input.library ? Object.entries(input.library.locales) : (input.catalogRecords ?? []).map(row => [row.locale, row] as const);
  for (const [locale, content] of contents) {
    const byId = new Map<string, WriterRecord>(content.records.map(record => [record.id, record]));
    for (const id of byId.keys()) if (content.records.filter(record => record.id === id).length !== 1) {
      byId.delete(id); find("duplicate-record", "P0", `${locale}:${id}`, "Record identity is ambiguous within the locale");
    }
    for (const record of content.records) {
      records.push({ locale, record });
      shape.set(record, validateWriterRecord(record, record.leaf.split(".")[0] as WriterLayer).map(row => row.message));
      if (!byId.has(record.id)) shape.get(record)!.push("Ambiguous duplicate record identity");
      if (!writer.has(record.leaf)) find("record-leaf", "P0", record.id, `Record leaf ${record.leaf} is not registered`);
      if (record.status === "retired") continue;
      const recordNode = `record:${locale}:${record.id}`; recordNodes.add(recordNode);
      const reference = (id: string): void => {
        const target = byId.get(id);
        const targetNode = `record:${locale}:${id}`;
        recordEdges.push({ from: recordNode, to: targetNode, kind: "record" });
        edge(record.leaf, target?.status !== "retired" ? target?.leaf ?? targetNode : targetNode, "record");
      };
      const refs = (value: unknown): void => {
        if (Array.isArray(value)) { value.forEach(refs); return; }
        if (!object(value)) return;
        if (typeof value.id === "string" && (typeof value.ref === "string" || typeof value.kind === "string")) {
          reference(value.id); return;
        }
        Object.values(value).forEach(refs);
      };
      if ("fields" in record) refs(record.fields);
      if ("schema" in record) edge(record.leaf, record.schema, "record");
      if ("parts" in record) refs(record.parts);
      if ("regions" in record) refs(record.regions);
      if ("frame" in record) {
        edge(record.leaf, record.frame.frameId, "record");
        if ("passages" in record) for (const id of [...record.passages, ...record.chrome ? [record.chrome] : []]) reference(id);
        if ("blocks" in record) {
          if (/^(lx|st|pt|ps|nr)\.[0123456789abcdefghjkmnpqrstvwxyz]{10}$/.test(record.title)) reference(record.title);
          const blocks = (list: typeof record.blocks): void => { for (const block of list) {
            edge(record.leaf, block.designer.id, "record");
            if (block.claim) reference(block.claim);
            if (block.children) blocks(block.children);
          } };
          blocks(record.blocks);
        }
      }
      if ("assetRef" in record && record.assetRef) edge(record.leaf, record.assetRef.assetId, "record");
    }
  }
  const edges = [...edgeMap.values()].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  const dangling = edges.filter(row => !nodes.has(row.from) || !nodes.has(row.to));
  for (const row of dangling) if (row.kind !== "schema") find("dangling-reference", "P0", row.from, `Unresolved ${row.kind} endpoint(s): ${[row.from, row.to].filter(id => !nodes.has(id)).join(", ")}`);
  const roots = input.connections?.adminRoots ?? ["frames.app-shell", "frames.document"].filter(id => designer.has(id));
  for (const id of roots) if (!nodes.has(id)) find("dangling-reference", "P0", id, "Admin root is not registered");
  const reached = reachableFrom(roots, edges.filter(row => nodes.has(row.from) && nodes.has(row.to)));
  const cycles = [...graphCycles(nodes, edges), ...graphCycles(recordNodes, recordEdges)];
  for (const cycle of cycles) find("cycle", "P1", cycle.join(","), "Consumption graph contains a cycle");
  const checks: WriterCheckFinding[] = [];
  let coverage: WriterCheckFinding[] = [];
  if (input.library && [...shape.values()].every(rows => !rows.length)) {
    const options: WriterCheckOptions = { catalog: input.catalog, designerLibraries: [{ version: "catalog", assets: [...designer.keys()].filter(id => id.startsWith("assets.")), leaves: [...designer.keys()], frames: [...designer.keys()].filter(id => id.startsWith("frames.")).map(id => ({ id })) }] };
    for (const check of [checkWriterClosedWorld, checkWriterPurity, checkWriterLength, checkWriterICU, checkWriterExpansion, checkWriterLint, checkWriterApproval]) checks.push(...check(input.library, options));
    coverage = checkWriterCoverage(input.library, options);
    for (const row of coverage) find("locale-coverage", "P1", row.path, row.message);
  }
  const leaves: CoverageLeaf[] = [...writer.values()].sort((a, b) => a.id.localeCompare(b.id)).map(slot => {
    const observations = records.filter(row => row.record.leaf === slot.id && row.record.status !== "retired").map(({ locale, record }) => {
      const reasons = [...shape.get(record) ?? [], ...checks.filter(row => row.severity === "error" && (!row.recordId || row.recordId === record.id && (!row.locale || row.locale === locale))).map(row => row.message)];
      if (!input.library) reasons.push("Catalog sample only; no consumer manifest/validation/approval context");
      if ([...shape.values()].some(rows => rows.length) && !reasons.length) reasons.push("Library contains invalid record shapes; checks could not run");
      const state: FillState = reasons.length ? "draft" : record.status === "approved" && !coverage.length ? "approved" : "checked";
      return { id: record.id, locale, state, reasons };
    });
    const state = observations.length ? order[Math.min(...observations.map(row => order.indexOf(row.state)))]! : "absent";
    const adminPage = reached.has(slot.id) ? true : input.connections?.completeAdminGraph ? false : null;
    return { id: slot.id, layer: slot.layer, paths: paths.get(slot.id) ?? [], state,
      uses: [...new Set(edges.filter(row => row.from === slot.id).map(row => row.to))].sort(),
      usedBy: [...new Set(edges.filter(row => row.to === slot.id).map(row => row.from))].sort(), adminPage,
      priority: state === "absent" || state === "draft" ? adminPage === false ? "P2" : "P1" : null,
      records: observations };
  });
  const orphans = leaves.filter(row => !row.usedBy.length && !roots.includes(row.id)).map(row => row.id);
  for (const id of orphans) find("orphan", leaves.find(row => row.id === id)!.priority ?? "P2", id, "No consumer in the supplied graph");
  const states = { absent: 0, draft: 0, checked: 0, approved: 0 }, admin = { reachable: 0, unreachable: 0, unknown: 0 };
  for (const leaf of leaves) { states[leaf.state]++; admin[leaf.adminPage === true ? "reachable" : leaf.adminPage === false ? "unreachable" : "unknown"]++; }
  return { schemaVersion: 1, source: "writer", summary: { levels, states, admin }, boards, leaves, edges, pairs: pairs.sort((a, b) => a.section.localeCompare(b.section)), findings: findings.sort((a, b) => a.id.localeCompare(b.id)), dangling, orphans, cycles,
    needs: [...(!input.library ? ["No consumer library supplied; shipped records establish draft presence only; catalog declarations alone do not establish filled records"] : []), ...(!input.connections?.completeAdminGraph ? ["Complete Publisher composition/admin-root connection snapshot required; unproven reachability stays unknown and unfilled unknowns rank P1"] : []), "IA declarations are the existing group registry; no separate L1/L2 registry is asserted", "Checked means shape/reference/purity/length/ICU/expansion/lint/approval-metadata checks ran clean; locale approval coverage is separately reported and blocks approved promotion; catalog freeze and publication eligibility remain separate"] };
}
