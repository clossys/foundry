import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { join } from "node:path";
import type { Cell, Bullet } from "@clossys/strategist";
import { agentModule, agentRoot, hasCellTree, readCells } from "../server/cells.js";
import type { CliArgs } from "./args.js";

const INPUTS = [
  ["essence", "identity.brand.essence", true],
  ["personality", "identity.brand.personality", true],
  ["visual-direction", "identity.visual.style", true],
  ["imagery", "identity.visual.imagery", false],
  ["voice", "identity.verbal.voice", true],
  ["audience", "focus.segment.core", true],
  ["position", "advantage.proposition.promise", true],
  ["category", "focus.category.definition", true],
] as const;
type Finding = { code: string; subject: string; message: string };
export interface DesignTrait {
  id: string; ref: string; kind: "brand-trait" | "visual-direction" | "voice-rule";
  key?: string; text: string; line: number;
}
export interface DesignBrief {
  schemaVersion: 1; agent: "designer";
  inputs: { role: string; id: string; required: boolean; version: number | null; ref: string | null; direction: Bullet[]; watch: Bullet[]; cites: Cell["cites"] }[];
  traits: DesignTrait[];
  wontClaim: { ref: string; key: string; text: string; line: number }[];
  leaves: { id: string; layer: string }[];
  componentSourcePreference: { source: "shadcn@aria"; basis: "planner-default" };
  limits: Finding[];
}
interface DesignResult {
  exitCode: 0 | 1 | 2; verb: "design"; root: string; check: boolean; message: string;
  result?: unknown;
}
const directorRef = (cell: Cell) => `director:${cell.id}@${cell.version}`;
const ownerPlaceholder = new RegExp("\\bTODO-OWNER\\b", "i");
const prohibitionLabel = new RegExp("^never(?:-claim)?$", "i");
const unresolved = (bullet: Bullet) => ownerPlaceholder.test(`${bullet.key ?? ""}: ${bullet.text}`);

async function activeDirector(root: string): Promise<Cell[]> {
  if (!await hasCellTree(agentRoot(root, "director"))) throw new Error("design: Director cells are missing at clossys/agents/director; initialise the native Director root first");
  const cells = await readCells(root, "director", true);
  const api = await agentModule("director", "index.js");
  return cells.map(cell => api.parseCell(cell.source, cell.path).value as Cell);
}

/** Preserve active source text and uncertainty. This assembles inputs; it chooses no design values. */
export async function designBrief(root: string, active?: Cell[]): Promise<DesignBrief> {
  const cells = active ?? await activeDirector(root);
  const catalog = await agentModule("designer", "catalog-core/index.js");
  const limits: Finding[] = [];
  const inputs = INPUTS.map(([role, id, required]) => {
    const cell = cells.find(cell => cell.id === id);
    if (!cell) limits.push({ code: required ? "missing-director-input" : "optional-director-input", subject: id, message: `No active ${role} input` });
    else if (required && !cell.direction.length) limits.push({ code: "missing-director-input", subject: id, message: `Active ${role} input has no Direction bullets` });
    return { role, id, required, version: cell?.version ?? null, ref: cell ? directorRef(cell) : null,
      direction: cell?.direction ?? [], watch: cell?.watch ?? [], cites: cell?.cites ?? [] };
  });
  const traits: DesignTrait[] = [];
  for (const input of inputs) {
    for (const bullet of input.direction) {
      if (unresolved(bullet)) {
        limits.push({ code: "unresolved-owner-input", subject: `${input.ref}#direction-L${bullet.line}`, message: bullet.text });
        continue;
      }
      const kind = input.role === "voice" ? "voice-rule" : ["essence", "personality"].includes(input.role) ? "brand-trait"
        : ["visual-direction", "imagery"].includes(input.role) ? "visual-direction" : undefined;
      if (kind) traits.push({ id: `${input.ref}#direction-L${bullet.line}`, ref: input.ref!, kind, ...(bullet.key ? { key: bullet.key } : {}), text: bullet.text, line: bullet.line });
    }
  }
  const wontClaim = cells.flatMap(cell => cell.direction.filter(bullet => prohibitionLabel.test(bullet.key ?? ""))
    .map(bullet => ({ ref: directorRef(cell), key: bullet.key!, text: bullet.text, line: bullet.line })));
  const leaves = [...catalog.loadCatalog().slots, ...catalog.loadComponentRegistry().slots,
    ...catalog.loadSectionRegistry().slots, ...catalog.loadBuildCatalog().slots.filter((slot: { layer: string }) => slot.layer === "frames")]
    .map((slot: { id: string; layer: string }) => ({ id: slot.id, layer: slot.layer })).sort((a, b) => a.id.localeCompare(b.id));
  return { schemaVersion: 1, agent: "designer", inputs, traits, wontClaim, leaves,
    componentSourcePreference: { source: "shadcn@aria", basis: "planner-default" }, limits };
}

async function designerTree(root: string): Promise<any> {
  const source = agentRoot(root, "designer");
  if (!await hasCellTree(source)) throw new Error("design: Designer cells are missing at clossys/agents/designer; initialise them through designer-library cells migrate --from <native-library> before compiling or checking");
  const handle = await open(join(source, "tree.json"), constants.O_RDONLY | constants.O_NOFOLLOW);
  try { return JSON.parse(await handle.readFile("utf8")); } finally { await handle.close(); }
}

/** Rationale declares coverage; matching a marker never certifies visual quality. */
async function checkDesign(root: string, director: Cell[], brief: DesignBrief) {
  const tree = await designerTree(root);
  const cells = await readCells(root, "designer", true);
  const store = await agentModule("director", "cell-format/index.js");
  const profile = await agentModule("designer", "library-cli/cells.js");
  const findings: Finding[] = brief.limits.filter(limit => limit.code === "missing-director-input");
  const coverage = new Map<string, string[]>();
  for (const cell of cells) {
    const parsed = profile.parseLibraryCell(cell.source, cell.path);
    const links = (cell.document.fields.links as string[]).map(link => store.parseLinkRef(link)).filter((ref: any) => ref.agent === "director");
    if (!links.length) findings.push({ code: "missing-director-link", subject: `${cell.id}@${cell.version}`, message: "Active Designer cell has no Director link" });
    const current = links.filter((ref: any) => director.some(cell => cell.id === ref.cell && cell.version === ref.version));
    for (const ref of links) if (!current.includes(ref)) findings.push({ code: "stale-director-version", subject: `${cell.id}@${cell.version}`, message: `Director link director:${ref.cell}@${ref.version} is not the active version` });
    const rationale = parsed.rationale ?? "";
    for (const trait of brief.traits) {
      if (current.some((ref: any) => `director:${ref.cell}@${ref.version}` === trait.ref)
        && rationale.split("\n").some((line: string) => line.startsWith(`Realises ${trait.id}: `) && line.slice(`Realises ${trait.id}: `.length).trim())) {
        coverage.set(trait.id, [...coverage.get(trait.id) ?? [], `${cell.id}@${cell.version}`]);
      }
    }
  }
  if (!cells.length) findings.push({ code: "missing-designer-cells", subject: "designer", message: "There are no active Designer cells" });
  for (const trait of brief.traits) if (!coverage.has(trait.id)) findings.push({ code: "unrealised-director-trait", subject: trait.id, message: `No active Designer rationale declares a realisation of ${trait.key ?? trait.kind}: ${trait.text}` });
  const catalogApi = await agentModule("designer", "catalog-core/index.js");
  const engine = await agentModule("designer", "catalog-core/api.js");
  const reader = await agentModule("designer", "library-cli/fs-library.js");
  const values = catalogApi.loadCatalog();
  let catalog: any = values;
  if (tree.meta?.metadata?.format === "composite-v1") {
    const bundles = await agentModule("designer", "catalog-bundles.js");
    const surfaces = await agentModule("designer", "library-cli/surface-catalog.js");
    catalog = { values, components: { slots: catalogApi.loadComponentRegistry().slots, fills: bundles.loadCatalogBundles().componentFills, rules: catalogApi.loadComponentCompositionRules() }, surfaces: surfaces.foundrySurfaceCatalog() };
  }
  // Designer owns the isolated, temporary projection. No consumer file is written.
  const library = await reader.readLibraryFromCells(agentRoot(root, "designer"), catalog);
  const tokens = "values" in library ? { ...library.values, source: library.source, adoptedAt: library.adoptedAt } : library;
  const native = engine.check({ catalog: values, library: tokens });
  for (const finding of native.findings.filter((finding: any) => finding.severity === "error")) findings.push({ code: `native-${finding.code}`, subject: finding.subject, message: finding.message });
  const resolved = engine.resolve({ catalog: values, library: tokens });
  const emitted = new Set(Object.values(resolved.members).map((member: any) => member.emit).filter(Boolean));
  const { CONTRAST_PAIRS } = await agentModule("designer", "tokens/contrast-pairs.js");
  const missingPairs = CONTRAST_PAIRS.filter((pair: any) => !emitted.has(pair.foreground) || !emitted.has(pair.background));
  if (missingPairs.length) findings.push({ code: "contrast-coverage-missing", subject: "designer", message: `${missingPairs.length} of ${CONTRAST_PAIRS.length} native WCAG contrast pairs lack active token bindings` });
  return { findings, coverage: brief.traits.map(trait => ({ trait: trait.id, cells: coverage.get(trait.id) ?? [] })),
    contrast: { totalPairs: CONTRAST_PAIRS.length, boundPairs: CONTRAST_PAIRS.length - missingPairs.length, modes: ["light", "dark"] },
    limits: [...brief.limits.filter(limit => limit.code !== "missing-director-input"),
      { code: "visual-review-required", subject: "designer", message: "Declared traceability and token contrast do not establish design quality or runtime WCAG conformance; review the consumer specimens" },
      { code: "copy-checks-owned-by-writer", subject: "writer", message: "Run clossys write --check for prohibited copy and locale coverage" }] };
}

export async function runDesign(args: CliArgs, root: string): Promise<DesignResult> {
  const base = { verb: "design" as const, root, check: args.check };
  try {
    if (args.brief || args.check) {
      const director = await activeDirector(root), brief = await designBrief(root, director);
      if (args.brief) {
        const missing = brief.limits.filter(limit => limit.code === "missing-director-input");
        return { ...base, exitCode: missing.length ? 1 : 0, result: brief, message: JSON.stringify(brief, null, 2) };
      }
      const result = await checkDesign(root, director, brief);
      return { ...base, exitCode: result.findings.length ? 1 : 0, result, message: [
        `design: ${result.findings.length} findings; ${result.coverage.filter(row => row.cells.length).length}/${result.coverage.length} declared traits covered; ${result.contrast.boundPairs}/${result.contrast.totalPairs} contrast pairs bound`,
        ...result.findings.map(finding => `${finding.code}: ${finding.subject}: ${finding.message}`),
        ...result.limits.map(limit => `Limit ${limit.code}: ${limit.subject}: ${limit.message}`),
      ].join("\n") };
    }
    await designerTree(root);
    await readCells(root, "designer", true);
    const api = await agentModule("designer", "library-cli/cells.js");
    const compiled = await api.compileLibraryCells(agentRoot(root, "designer"), join(agentRoot(root, "designer"), "compiled"));
    return { ...base, exitCode: compiled.ok ? 0 : 1, result: compiled, message: "design: compiled active cells to clossys/agents/designer/compiled; no drafts generated or activated" };
  } catch (error) {
    return { ...base, exitCode: 2, message: `design: could not run: ${error instanceof Error ? error.message : String(error)}` };
  }
}
