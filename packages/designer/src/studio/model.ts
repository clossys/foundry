import {
  CatalogError, isPrefixOf,
  type CatalogData, type ChangeSet, type Finding, type FillDoc, type FillMeta, type LibraryData, type Placement, type PlacementNode, type Resolved, type ResolvedMember,
} from "../catalog-core/index.js";
import { identityRuleDefinition } from "../catalog-assets/index.js";
import { TOKENS } from "../tokens/tokens.js";
import { studioEngine, type StudioEngine } from "./engine.js";
import { evaluationFor, type StudioEvaluation } from "./evaluation.js";

/** The slot the Studio opens on when the host names none. */
export const DEFAULT_SLOT_ID = "themes.primary";

/** The status tone of a card from its check counts. */
export const toneOf = (errors: number, notices: number): "danger" | "warning" | "success" => (errors > 0 ? "danger" : notices > 0 ? "warning" : "success");

/** UI scope; placement nodes expand to leaf operations and are never persisted. */
export type Scope = "member" | "slot" | "node";
export type Change = ChangeSet["changes"][number];

const byCodeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const metaOf = (doc: FillDoc): FillMeta => doc.$extensions["com.clossys.fill"];

/** Same shape as the `TreeView` node, declared here so the model does not depend on the tree renderer. */
export interface SlotTreeNode { readonly id: string; readonly label: string; readonly children?: readonly SlotTreeNode[] }

/** The id of a placement node in the tree and in the node picker: the layer and the node id. Slot ids hold no slash, so it never names a slot. */
export const nodeKey = (layer: string, nodeId: string): string => `${layer}/${nodeId}`;

/** A placement node as the node picker sees it: every leaf under it, in file order. */
export interface NodeOption { readonly id: string; readonly label: string; readonly leaves: readonly string[] }

const leavesUnder = (node: PlacementNode): string[] => ("children" in node ? node.children.flatMap(leavesUnder) : [...node.leaves]);

/** Every placement node, outermost first, in file order. */
export function allNodes(placements: readonly Placement[]): NodeOption[] {
  const visit = (layer: string, node: PlacementNode): NodeOption[] => [
    { id: nodeKey(layer, node.id), label: node.label, leaves: leavesUnder(node) },
    ...("children" in node ? node.children.flatMap((child) => visit(layer, child)) : []),
  ];
  return placements.flatMap((placement) => placement.nodes.flatMap((node) => visit(placement.layer, node)));
}

/** The placement nodes that contain a slot, outermost first. */
export const nodeOptions = (placements: readonly Placement[], slotId: string): NodeOption[] => allNodes(placements).filter((node) => node.leaves.includes(slotId));

/** Slot information architecture: layer, then the placement nodes, then the leaves. It reads the placement files as they are; no id is split or parsed. */
export function buildSlotTree(placements: readonly Placement[]): SlotTreeNode[] {
  const visit = (layer: string, node: PlacementNode): SlotTreeNode => ({
    id: nodeKey(layer, node.id), label: node.label,
    children: "children" in node ? node.children.map((child) => visit(layer, child)) : node.leaves.map((id) => ({ id, label: id })),
  });
  return placements.map((placement) => ({ id: placement.layer, label: placement.layer, children: placement.nodes.map((node) => visit(placement.layer, node)) }));
}

/** The ids a scope can point at for one slot: the slot itself, its member ids, or the placement nodes that contain it. */
export function scopeTargets(input: { catalog: CatalogData; library: LibraryData; slotId: string; scope: Scope }): string[] {
  const { catalog, library, slotId, scope } = input;
  if (scope === "slot") return [slotId];
  if (scope === "node") return nodeOptions(catalog.placements, slotId).map((node) => node.id);
  const slot = catalog.slots.find((entry) => entry.id === slotId);
  if (slot?.contract.members.mode === "closed") return slot.contract.members.names.map((name) => `${slotId}.${name}`).sort(byCodeUnit);
  const ids = new Set<string>();
  const visit = (node: object, path: string): void => {
    for (const [key, child] of Object.entries(node)) {
      if (key.startsWith("$")) continue;
      if (child && typeof child === "object" && Object.hasOwn(child, "$value")) ids.add(`${path}.${key}`);
      else if (child && typeof child === "object") visit(child, `${path}.${key}`);
    }
  };
  for (const doc of [...catalog.fills, ...library.fills]) if (doc.$extensions["com.clossys.fill"].slot === slotId) visit(doc.themes ?? doc.assets ?? {}, slotId.split(".")[0]!);
  return [...ids].filter((id) => isPrefixOf(slotId, id)).sort(byCodeUnit);
}

/** The target a scope starts on when the user switches to it: the slot, the first member, or the innermost placement node. */
export function defaultTarget(input: { catalog: CatalogData; library: LibraryData; slotId: string; scope: Scope }): string {
  const targets = scopeTargets(input);
  return (input.scope === "node" ? targets[targets.length - 1] : targets[0]) ?? input.slotId;
}

/** Origin sources represented by the consumer at a slot or member. */
export function sourcesAt(library: LibraryData, scope: Scope, target: string): string[] {
  const sources = new Set<string>();
  const visit = (node: object, path: string): void => {
    for (const [key, value] of Object.entries(node)) {
      if (key.startsWith("$")) continue;
      const id = `${path}.${key}`;
      if (value && typeof value === "object" && Object.hasOwn(value, "$value")) {
        if (scope === "member" ? id !== target : !isPrefixOf(target, id)) continue;
        const origin = value.$extensions?.["com.clossys.origin"];
        sources.add(origin?.kind === "adopted" ? origin.source : library.source.id);
      } else if (value && typeof value === "object") visit(value, id);
    }
  };
  for (const fill of library.fills) visit(fill.themes ?? fill.assets ?? {}, metaOf(fill).slot.split(".")[0]!);
  return [...sources].sort(byCodeUnit);
}

/** Add an operation, replacing an earlier operation for the same exact member set or leaf. */
export function addChange(input: { base: LibraryData; changes: ChangeSet; change: Change; engine?: StudioEngine }): ChangeSet {
  const { base, changes, change, engine = studioEngine } = input;
  const key = (entry: Change): string => JSON.stringify([entry.slot, entry.op === "adopt" ? [...entry.members ?? []].sort(byCodeUnit) : []]);
  const kept = changes.changes.filter(entry => key(entry) !== key(change));
  const noOp = change.op === "remove" && !base.fills.some(fill => metaOf(fill).slot === change.slot) && !kept.some(entry => entry.slot === change.slot);
  return { baseHash: engine.libraryHash(base), changes: noOp ? kept : [...kept, change] };
}

/** Explicit selections adopt implementations or run registered recipes; reset removes a consumer leaf. */
export function changesFor(input: { catalog: CatalogData; library: LibraryData; scope: Scope; target: string; source?: string }): Change[] {
  const { catalog, library, scope, target, source } = input;
  if (source === library.source.id) return [];
  const leaves = scope === "node" ? allNodes(catalog.placements).find(node => node.id === target)?.leaves ?? []
    : [scope === "member" ? catalog.slots.find(slot => isPrefixOf(slot.id, target))?.id ?? target : target];
  if (source === undefined) return leaves.map(slot => ({ op: "remove", slot }));
  return leaves.flatMap((slot): Change[] => {
    const candidates = catalog.fills.filter(doc => metaOf(doc).slot === slot && metaOf(doc).source === source && metaOf(doc).mode !== "reference");
    if (!candidates.length) return [];
    if (candidates.length !== 1) throw new CatalogError(`Studio recipe selection is ambiguous for ${source}/${slot}`);
    const fill = metaOf(candidates[0]!);
    if (fill.mode === "implementation") return [{ op: "adopt", slot, source, ...(scope === "member" ? { members: [target] } : {}) }];
    if (scope === "member") throw new CatalogError("Studio recipe is unavailable at member scope; select the whole leaf explicitly");
    const rules = catalog.rules?.filter(rule => rule.id === fill.derivation?.rule && rule.slot === slot) ?? [];
    if (rules.length !== 1 || !rules[0]!.inputs) throw new CatalogError(`Studio recipe requires one registered rule with declared inputs for ${slot}`);
    const rule = rules[0]!;
    const builtin = identityRuleDefinition(rule.id);
    if (builtin && JSON.stringify([...rule.inputs!].sort(byCodeUnit)) !== JSON.stringify([...builtin.inputs!].sort(byCodeUnit))) throw new CatalogError(`Studio recipe ${rule.id} differs from declared inputs`);
    return [{ op: "derive", slot, rule: rule.id, inputs: [...rule.inputs!] }];
  });
}

export function addChanges(input: { base: LibraryData; changes: ChangeSet; list: readonly Change[]; engine?: StudioEngine }): ChangeSet {
  return input.list.reduce((changes, change) => addChange({ ...input, changes, change }), input.changes);
}
export const emptyChanges = (base: LibraryData, engine: StudioEngine = studioEngine): ChangeSet => ({ baseHash: engine.libraryHash(base), changes: [] });
export function workingLibrary(input: { catalog: CatalogData; base: LibraryData; changes: ChangeSet; engine?: StudioEngine }): LibraryData {
  return input.changes.changes.length === 0 ? input.base : (input.engine ?? studioEngine).applyLibraryChange(input.catalog, input.base, input.changes);
}

export interface Candidate {
  /** Position in the card order; it names the scoped style block `[data-studio-candidate="<index>"]`. */
  readonly index: number;
  readonly source: string;
  readonly fill: FillMeta;
  /** The slot's members as they would resolve if this source were picked at the current scope. */
  readonly members: readonly { readonly id: string; readonly member: ResolvedMember }[];
  /** Same members as a `Resolved`, ready for `emit`. */
  readonly resolved: Resolved;
  readonly findings: readonly Finding[];
  readonly errors: number;
  readonly notices: number;
  /** False for a reference fill and for any fill with an error; notices do not block. */
  readonly usable: boolean;
  readonly reason?: "reference" | "invalid";
  /** False when the fill has a C1 error: nothing from it may reach a style element. */
  readonly previewable: boolean;
  /** The consumer column is the active library. */
  readonly selected: boolean;
  readonly inUseByDefault: false;
}

/** Candidate previews apply their operations to a copy; active values always come from the consumer. */
type CandidateInput = {
  catalog: CatalogData; library: LibraryData; working: LibraryData; slotId: string; scope: Scope; target: string; engine?: StudioEngine; evaluation?: StudioEvaluation;
};

export function buildCandidates(input: CandidateInput): Candidate[] {
  input = { ...input, evaluation: evaluationFor(input) };
  const { catalog, working, slotId } = input;
  const docs = [...catalog.fills, ...working.fills].filter(doc => metaOf(doc).slot === slotId);
  const rank = (source: string): number => source === working.source.id ? 0 : source === "foundry" ? 1 : 2;
  const sources = [...new Set([working.source.id, ...docs.map(doc => metaOf(doc).source)])].sort((a,b) => rank(a)-rank(b) || byCodeUnit(a,b));
  return sources.map((source, index) => candidateForSource(input, source, index));
}

/** Project an actual current fill without proposing any alternative operations. */
export function currentConsumerCandidate(input: CandidateInput): Candidate | undefined {
  if (!input.working.fills.some(doc => metaOf(doc).slot === input.slotId && metaOf(doc).source === input.working.source.id)) return undefined;
  return candidateForSource(input, input.working.source.id, 0);
}

function candidateForSource(input: CandidateInput, source: string, index: number): Candidate {
  const { catalog, working, slotId, scope, target } = input;
  const evaluation = evaluationFor(input);
  const docs = [...catalog.fills, ...working.fills].filter(doc => metaOf(doc).slot === slotId);
  const consumer = source === working.source.id;
  const doc = docs.find(entry => metaOf(entry).source === source);
  const fill: FillMeta = doc ? metaOf(doc) : { id: `${source}/${slotId}`, slot: slotId, source, mode: "implementation", sourceAddress: "", relation: "same-contract", builtOn: [], conforms: [], evidence: [], author: "consumer", trust: "consumer", license: working.source.license, status: "draft" };
  const reference = fill.mode === "reference";
  const leaves = scope === "node" ? allNodes(catalog.placements).find(node => node.id === target)?.leaves ?? [] : [slotId];
  let changes: Change[] = [];
  let routingFailure: string | undefined;
  try { if (!consumer && !reference) changes = changesFor({ catalog, library: working, scope, target, source }); }
  catch (error) { if (!(error instanceof CatalogError)) throw error; routingFailure = error.message; }
  const evaluated = evaluation.evaluate(changes);
  const { resolved, checked } = evaluated;
  const message = routingFailure ?? evaluated.failure;
  const failure: Finding | undefined = message === undefined ? undefined : { code: "C7", rule: "library", severity: "error", subject: slotId, message };
  const findings = checked.findings.filter(finding => finding.subject === fill.id || finding.subject === target || leaves.some(leaf => finding.subject === leaf || isPrefixOf(leaf, finding.subject) || finding.subject === `${working.source.id}/${leaf}`));
  if (failure) findings.push(failure);
  const members = consumer || !reference && !failure ? Object.entries(resolved.members).filter(([,member]) => member.slot === slotId).sort(([a],[b]) => byCodeUnit(a,b)) : [];
  const invalid = findings.some(finding => finding.severity === "error");
  return { index, source, fill, members: members.map(([id,member]) => ({id,member})), resolved: { ...resolved, members: Object.fromEntries(members) }, findings,
    errors: findings.filter(finding => finding.severity === "error").length, notices: findings.filter(finding => finding.severity === "notice").length,
    usable: !consumer && !reference && !invalid && !!doc, ...(reference ? { reason: "reference" as const } : invalid ? { reason: "invalid" as const } : {}),
    previewable: !findings.some(finding => finding.code === "C1" && finding.severity === "error"), selected: consumer && !!doc, inUseByDefault: false };
}

export interface InspectorModel {
  readonly source: string;
  readonly fillId: string;
  readonly mode: FillMeta["mode"];
  readonly relation: FillMeta["relation"];
  readonly license: string;
  readonly pin?: string;
  readonly status: FillMeta["status"];
  readonly builtOn: readonly string[];
  readonly evidence: readonly string[];
  readonly rows: readonly { member: string; light: string; dark?: string; via: ResolvedMember["via"]; alias?: string }[];
  readonly findings: readonly Finding[];
}

export function inspectorModel(candidate: Candidate): InspectorModel {
  const { fill } = candidate;
  const pin = fill.pin ? Object.entries(fill.pin).sort(([a], [b]) => byCodeUnit(a, b)).map(([key, value]) => `${key}=${String(value)}`).join(" ") : undefined;
  return {
    source: candidate.source, fillId: fill.id, mode: fill.mode, relation: fill.relation, license: fill.license, ...(pin ? { pin } : {}), status: fill.status,
    builtOn: fill.builtOn,
    evidence: fill.evidence.map((entry) => `${entry.clause} ${"path" in entry ? entry.path : entry.check}`),
    rows: candidate.members.map(({ id, member }) => {
      const alias = member.alias.dark ?? member.alias.light;
      return { member: id, light: member.css.light, ...(member.css.dark !== undefined ? { dark: member.css.dark } : {}), via: member.via, ...(alias ? { alias } : {}) };
    }),
    findings: candidate.findings,
  };
}

export type PreviewSpec =
  | { readonly kind: "token"; readonly property: string }
  | { readonly kind: "swatch" | "font" | "ruler"; readonly variable: string; readonly css: string }
  | { readonly kind: "text"; readonly css: string; readonly dark?: string; readonly visualUnsupported?: true };

/** Which renderer a member gets. Bound members read the real token; unbound ones read `--studio-m-<index>`. Motion values stay text (no animation in this slice). */
export function describePreview(member: ResolvedMember, unboundIndex: number): PreviewSpec {
  const variable = `--studio-m-${unboundIndex}`;
  const css = member.css.light;
  // Valid canonical achromatic OKLCH data has no numeric hue. Keep it as
  // escaped data until the existing strict visual renderer supports it.
  if (member.$type === "color" && [css, member.css.dark].some(value => value !== undefined && /\boklch\([^()]*\bnone\b[^()]*\)/i.test(value))) return { kind: "text", css, dark: member.css.dark ?? css, visualUnsupported: true };
  if (member.$type === "duration" || member.$type === "cubicBezier") return { kind: "text", css };
  // Only a Foundry registry property has a token application; a theme var (--background) previews by its type.
  if (member.emit !== undefined && Object.hasOwn(TOKENS, member.emit)) return { kind: "token", property: member.emit };
  if (member.$type === "color") return { kind: "swatch", variable, css };
  if (member.$type === "fontFamily") return { kind: "font", variable, css };
  if (member.$type === "dimension") return { kind: "ruler", variable, css };
  return { kind: "text", css };
}

/** The real emitter numbers extra variables by member position, including preceding bound members. */
export function previewRows(members: Candidate["members"]): { id: string; member: ResolvedMember; spec: PreviewSpec }[] {
  return members.map(({ id, member }, index) => ({ id, member, spec: describePreview(member, index) }));
}
