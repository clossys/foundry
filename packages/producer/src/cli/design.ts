import { join } from "node:path";
import type { Cell, Bullet } from "@clossys/director";
import { agentModule } from "../server/cells.js";
import { libraryTheme } from "../server/library-selection.js";
import { directorRef, readPinnedDirector } from "../records/director-pinned.js";
import { readPinned, type PinnedSet } from "../records/pinned.js";
import { hasSlotModel, readIa } from "../records/slots.js";
import type { CliArgs } from "./args.js";
import { emitProjection } from "./projection.js";
import { DESIGN_BRIEF_INPUTS } from "../records/slot-model/design-brief-inputs.js";

const INPUTS = DESIGN_BRIEF_INPUTS;
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
  brief?: unknown; checks?: unknown; compilation?: unknown;
}
const ownerPlaceholder = new RegExp("\\bTODO-OWNER\\b", "i");
const prohibitionLabel = new RegExp("^never(?:-claim)?$", "i");
const unresolved = (bullet: Bullet) => ownerPlaceholder.test(`${bullet.key ?? ""}: ${bullet.text}`);

/** The consumer's `clossys/` folder, once both the Director and Designer IA exist. */
function workspace(root: string): string {
  const consumer = join(root, "clossys");
  if (!hasSlotModel(consumer) || !readIa(consumer, "director")) throw new Error("clossys/agents/director/ia.json is missing");
  if (!readIa(consumer, "designer")) throw new Error("clossys/agents/designer/ia.json is missing");
  return consumer;
}

/** Preserve pinned Director text and uncertainty. This assembles inputs; it chooses no design values. */
export async function designBrief(root: string, pinned?: readonly Cell[]): Promise<DesignBrief> {
  const cells = pinned ?? (await readPinnedDirector(join(root, "clossys"))).cells;
  const catalog = await agentModule("designer", "catalog-core/index.js");
  const limits: Finding[] = [];
  const inputs = INPUTS.map(([role, id, required]) => {
    const cell = cells.find(cell => cell.id === id);
    if (!cell) limits.push({ code: required ? "missing-director-input" : "optional-director-input", subject: id, message: `No pinned ${role} input` });
    else if (required && !cell.direction.length) limits.push({ code: "missing-director-input", subject: id, message: `Pinned ${role} input has no Direction bullets` });
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

/** The pinned Designer set as one deterministic projection: slot, pinned item and its bytes' hash. */
function designerProjection(designer: PinnedSet) {
  return {
    schemaVersion: 1 as const, agent: "designer" as const,
    slots: designer.pinned.map(candidate => {
      let item: { name?: unknown; type?: unknown } = {};
      try { item = JSON.parse(candidate.bytes); } catch { /* validated by readPinned; kept total */ }
      return { id: candidate.id, kind: candidate.doc.kind, candidate: candidate.name, version: candidate.version, sha256: candidate.sha256,
        ...(typeof item.name === "string" ? { name: item.name } : {}), ...(typeof item.type === "string" ? { type: item.type } : {}) };
    }),
    unpinned: [...designer.unpinned],
  };
}

/** Pin integrity, Director inputs and the pinned theme. Matching never certifies visual quality. */
function checkDesign(consumer: string, director: Awaited<ReturnType<typeof readPinnedDirector>>, designer: PinnedSet, brief: DesignBrief) {
  const findings: Finding[] = brief.limits.filter(limit => limit.code === "missing-director-input");
  for (const issue of designer.issues) findings.push({ code: issue.reason, subject: `designer:${issue.slot}`, message: issue.message });
  if (!designer.pinned.length) findings.push({ code: "missing-designer-pins", subject: "designer", message: "The consumer has no pinned Designer slot" });
  // A declared input is an upstream Director slot or a Designer theme/asset slot the element reads.
  // A Director input must be pinned for this slot to derive from it; an unpinned Designer input is an
  // open owner decision (readiness reports it), never an error here.
  const directorPinned = new Map(director.cells.map(cell => [cell.id, cell]));
  const designerSlots = new Set([...designer.pinned.map(candidate => candidate.id), ...designer.unpinned]);
  for (const candidate of designer.pinned) {
    for (const input of candidate.doc.inputs) {
      if (!directorPinned.has(input) && !designerSlots.has(input)) findings.push({ code: "unpinned-director-input", subject: `designer:${candidate.id}`, message: `Declared input director:${input} has no pinned candidate` });
    }
  }
  const theme = libraryTheme(consumer);
  if (!theme) findings.push({ code: "theme-not-compiled", subject: "designer:themes.*", message: "No pinned themes.* item declares CSS variables; Studio and the site have no consumer theme" });
  const undeclared = designer.pinned.filter(candidate => !candidate.doc.inputs.length).length;
  const limits: Finding[] = [
    ...brief.limits.filter(limit => limit.code !== "missing-director-input"),
    ...(designer.unpinned.length ? [{ code: "unpinned-designer-slots", subject: "designer", message: `${designer.unpinned.length} Designer slot(s) have no pin yet (an owner decision; clossys check reports each one)` }] : []),
    ...(undeclared ? [{ code: "director-trace-undeclared", subject: "designer", message: `${undeclared} pinned Designer slot(s) declare no Director inputs, so trait realisation is not traceable from the slot model` }] : []),
    { code: "provenance-owned-by-check", subject: "designer", message: "Reference provenance and ref-verbatim are checked by clossys check" },
    { code: "visual-review-required", subject: "designer", message: "Declared traceability and a compiled theme do not establish design quality or runtime WCAG conformance; review the consumer specimens" },
    { code: "copy-checks-owned-by-writer", subject: "writer", message: "Run clossys write --check for prohibited copy and locale coverage" },
  ];
  return { findings, pinned: designer.pinned.length, unpinned: designer.unpinned.length, theme: theme ? { hash: theme.hash } : null, limits };
}

/**
 * Deterministic Designer verb over the slot model: `--brief` assembles the pinned Director
 * inputs, `--check` verifies the pinned Designer set against them, and the default compile
 * prints the pinned set (written only to `--out`). It generates, pins and activates nothing.
 */
export async function runDesign(args: CliArgs, root: string): Promise<DesignResult> {
  const base = { verb: "design" as const, root, check: args.check };
  try {
    const consumer = workspace(root);
    const director = await readPinnedDirector(consumer);
    if (args.brief || args.check) {
      const brief = await designBrief(root, director.cells);
      if (args.brief) {
        const missing = brief.limits.filter(limit => limit.code === "missing-director-input");
        const emitted = await emitProjection(args, root, "designer brief", brief);
        return { ...base, exitCode: missing.length ? 1 : 0, brief, message: emitted ? `design: brief written to ${emitted}` : JSON.stringify(brief, null, 2) };
      }
      const result = checkDesign(consumer, director, readPinned(consumer, "designer"), brief);
      return { ...base, exitCode: result.findings.length ? 1 : 0, checks: result, message: [
        `design: ${result.findings.length} finding(s); ${result.pinned} pinned, ${result.unpinned} unpinned Designer slot(s); theme ${result.theme ? "compiled" : "missing"}`,
        ...result.findings.map(finding => `${finding.code}: ${finding.subject}: ${finding.message}`),
        ...result.limits.map(limit => `Limit ${limit.code}: ${limit.subject}: ${limit.message}`),
      ].join("\n") };
    }
    const designer = readPinned(consumer, "designer");
    const projection = designerProjection(designer);
    const emitted = await emitProjection(args, root, "designer", projection);
    return { ...base, exitCode: designer.issues.length ? 1 : 0, compilation: projection, message: [
      `design: compiled ${designer.pinned.length} pinned Designer slot(s)${emitted ? ` to ${emitted}` : ""}; ${designer.unpinned.length} unpinned; nothing generated or pinned`,
      ...designer.issues.map(issue => `${issue.reason}: ${issue.message}`),
      ...(emitted ? [] : [JSON.stringify(projection, null, 2)]),
    ].join("\n") };
  } catch (error) {
    return { ...base, exitCode: 2, message: `design: could not run: ${error instanceof Error ? error.message : String(error)}` };
  }
}
