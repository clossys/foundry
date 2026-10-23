import {
  isPrefixOf,
  type CatalogData, type ChangeSet, type Finding, type FillDoc, type FillMeta, type LibraryData, type Pick, type Placement, type PlacementNode, type Resolved, type ResolvedMember, type Selection,
} from "../catalog-core/index.js";
import { studioEngine, type StudioEngine } from "./engine.js";

/** The slot the Studio opens on when the host names none. */
export const DEFAULT_SLOT_ID = "tokens.accent-color";

/** The status tone of a card from its check counts. */
export const toneOf = (errors: number, notices: number): "danger" | "warning" | "success" => (errors > 0 ? "danger" : notices > 0 ? "warning" : "success");

/** What a pick applies to. `member` and `slot` are stored scopes; `node` is a placement node and is expanded into slot picks before it is stored. */
export type Scope = Pick["scope"] | "node";
export type Change = ChangeSet["changes"][number];

const byCodeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const metaOf = (doc: FillDoc): FillMeta => doc.$extensions["com.clossys.fill"];

/** Same shape as the `TreeView` node, declared here so the model does not depend on the atom. */
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
  for (const doc of [...catalog.fills, ...library.fills]) if (doc.$extensions["com.clossys.fill"].slot === slotId) visit(doc.tokens, "tokens");
  return [...ids].filter((id) => isPrefixOf(slotId, id)).sort(byCodeUnit);
}

/** The target a scope starts on when the user switches to it: the slot, the first member, or the innermost placement node. */
export function defaultTarget(input: { catalog: CatalogData; library: LibraryData; slotId: string; scope: Scope }): string {
  const targets = scopeTargets(input);
  return (input.scope === "node" ? targets[targets.length - 1] : targets[0]) ?? input.slotId;
}

export const pickAt = (selection: Selection, scope: Pick["scope"], target: string): Pick | undefined =>
  selection.picks.find((pick) => pick.scope === scope && pick.target === target);

/** Adds one change to the pending set. A later change to the same scope and target replaces the earlier one; a change that leaves the base selection as it is drops out. */
export function addChange(input: { base: Selection; changes: ChangeSet; change: Change; engine?: StudioEngine }): ChangeSet {
  const { base, changes, change, engine = studioEngine } = input;
  const same = (entry: Change): boolean =>
    (entry.op === "set" ? entry.pick.scope : entry.scope) === (change.op === "set" ? change.pick.scope : change.scope) &&
    (entry.op === "set" ? entry.pick.target : entry.target) === (change.op === "set" ? change.pick.target : change.target);
  const scope = change.op === "set" ? change.pick.scope : change.scope;
  const target = change.op === "set" ? change.pick.target : change.target;
  const existing = pickAt(base, scope, target);
  const noOp = change.op === "set" ? existing?.source === change.pick.source : existing === undefined;
  const kept = changes.changes.filter((entry) => !same(entry));
  return { baseHash: engine.selectionHash(base), changes: noOp ? kept : [...kept, change] };
}

/**
 * The stored changes for choosing `source` (or, with none, clearing) at a scope and target. A node is never stored: it becomes one slot
 * `set` per leaf under it that the source fills, or one slot `clear` per leaf.
 */
export function changesFor(input: { catalog: CatalogData; library: LibraryData; scope: Scope; target: string; source?: string }): Change[] {
  const { catalog, library, scope, target, source } = input;
  if (scope !== "node") return [source === undefined ? { op: "clear", scope, target } : { op: "set", pick: { scope, target, source } }];
  const leaves = allNodes(catalog.placements).find((node) => node.id === target)?.leaves ?? [];
  const docs = [...catalog.fills, ...library.fills];
  if (source === undefined) return leaves.map((leaf): Change => ({ op: "clear", scope: "slot", target: leaf }));
  return leaves
    .filter((leaf) => docs.some((doc) => metaOf(doc).slot === leaf && metaOf(doc).source === source))
    .map((leaf): Change => ({ op: "set", pick: { scope: "slot", target: leaf, source } }));
}

/** Adds several changes in order, each as `addChange` does. */
export function addChanges(input: { base: Selection; changes: ChangeSet; list: readonly Change[]; engine?: StudioEngine }): ChangeSet {
  const { base, list, engine } = input;
  return list.reduce((changes, change) => addChange({ base, changes, change, ...(engine ? { engine } : {}) }), input.changes);
}

/** A change set with nothing pending, made against `base`. */
export const emptyChanges = (base: Selection, engine: StudioEngine = studioEngine): ChangeSet => ({ baseHash: engine.selectionHash(base), changes: [] });

export const pendingCount = (changes: ChangeSet): number => changes.changes.length;

export function workingSelection(input: { base: Selection; changes: ChangeSet; engine?: StudioEngine }): Selection {
  const engine = input.engine ?? studioEngine;
  return input.changes.changes.length === 0 ? input.base : engine.applyChangeSet(input.base, input.changes);
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
  /** False for a reference fill and for a fill whose check has a C1 error. */
  readonly usable: boolean;
  readonly reason?: "reference" | "invalid";
  /** False when the fill has a C1 error: nothing from it may reach a style element. */
  readonly previewable: boolean;
  /** The working selection already picks this source at the current scope and target. */
  readonly selected: boolean;
  /** No pick touches this slot and this source wins the default chain. */
  readonly inUseByDefault: boolean;
}

/** Cards for one slot: the consumer first, then foundry, then the other sources by id. */
export function buildCandidates(input: {
  catalog: CatalogData; library: LibraryData; working: Selection; slotId: string; scope: Scope; target: string; engine?: StudioEngine;
}): Candidate[] {
  const { catalog, library, working, slotId, scope, target, engine = studioEngine } = input;
  const docs = [...catalog.fills, ...library.fills].filter((doc) => metaOf(doc).slot === slotId);
  const rank = (source: string): number => (source === library.source.id ? 0 : source === "foundry" ? 1 : 2);
  const sources = [...new Set(docs.map((doc) => metaOf(doc).source))].sort((a, b) => rank(a) - rank(b) || byCodeUnit(a, b));
  const defaultSource = working.defaultChain.find((source) => docs.some((doc) => metaOf(doc).source === source && metaOf(doc).mode !== "reference"));
  const touched = working.picks.some((pick) => isPrefixOf(pick.target, slotId) || isPrefixOf(slotId, pick.target));
  return sources.map((source, index): Candidate => {
    const doc = docs.find((entry) => metaOf(entry).source === source) as FillDoc;
    const fill = metaOf(doc);
    const changes = changesFor({ catalog, library, scope, target, source });
    const selection = engine.applyChangeSet(working, { baseHash: engine.selectionHash(working), changes });
    const leaves = scope === "node" ? allNodes(catalog.placements).find((node) => node.id === target)?.leaves ?? [] : [];
    // A reference fill never resolves, so the preview treats it as an implementation; the check still reports the pick as rejected.
    const asPreview = (list: readonly FillDoc[]): FillDoc[] => list.map((entry) => metaOf(entry).source === source && metaOf(entry).slot === slotId && metaOf(entry).mode === "reference"
      ? { ...entry, $extensions: { "com.clossys.fill": { ...metaOf(entry), mode: "implementation" as const } } } : entry);
    const resolved = engine.resolve({ catalog: { ...catalog, fills: asPreview(catalog.fills) }, library: { ...library, fills: asPreview(library.fills) }, selection });
    const checked = engine.check({ catalog, library, selection });
    const members = Object.entries(resolved.members).filter(([, member]) => member.slot === slotId).sort(([a], [b]) => byCodeUnit(a, b));
    // A node pick also takes in this source's fills for the other leaves under the node, so their findings count too.
    const findings = checked.findings.filter((finding) => finding.subject === fill.id || finding.subject === target || finding.subject === slotId || isPrefixOf(slotId, finding.subject)
      || leaves.some((leaf) => finding.subject === `${source}/${leaf}`));
    const invalid = findings.some((finding) => finding.code === "C1" && finding.severity === "error");
    const reference = fill.mode === "reference" || findings.some((finding) => finding.code === "C7");
    return {
      index, source, fill, members: members.map(([id, member]) => ({ id, member })),
      resolved: { ...resolved, members: Object.fromEntries(members) },
      findings, errors: findings.filter((finding) => finding.severity === "error").length, notices: findings.filter((finding) => finding.severity === "notice").length,
      usable: !reference && !invalid, ...(reference ? { reason: "reference" as const } : invalid ? { reason: "invalid" as const } : {}),
      previewable: !invalid,
      selected: changes.length > 0 && changes.every((change) => change.op === "set" && pickAt(working, change.pick.scope, change.pick.target)?.source === change.pick.source),
      inUseByDefault: !touched && defaultSource === source,
    };
  });
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
  | { readonly kind: "text"; readonly css: string };

/** Which renderer a member gets. Bound members read the real token; unbound ones read `--studio-m-<index>`. Motion values stay text (no animation in this slice). */
export function describePreview(member: ResolvedMember, unboundIndex: number): PreviewSpec {
  const variable = `--studio-m-${unboundIndex}`;
  const css = member.css.light;
  if (member.$type === "duration" || member.$type === "cubicBezier") return { kind: "text", css };
  if (member.emit !== undefined) return { kind: "token", property: member.emit };
  if (member.$type === "color") return { kind: "swatch", variable, css };
  if (member.$type === "fontFamily") return { kind: "font", variable, css };
  if (member.$type === "dimension") return { kind: "ruler", variable, css };
  return { kind: "text", css };
}

/** Every member of a card with its renderer. The unbound index counts only unbound members of the slot, in id order, which is how `emit` names `--studio-m-<index>`. */
export function previewRows(members: Candidate["members"]): { id: string; member: ResolvedMember; spec: PreviewSpec }[] {
  let unbound = 0;
  return members.map(({ id, member }) => ({ id, member, spec: describePreview(member, member.emit === undefined ? unbound++ : 0) }));
}
