/**
 * F4: `clossys migrate slots` — deterministic, idempotent store migration.
 *
 * Reads the old stores (agent `tree.json` + `cells/`, Designer `library/` +
 * `selection.json`) and writes the slot model beside them. No clock: every
 * `at` comes from the source (`updated`, selection history) or git. Running it
 * twice leaves the tree byte-identical. Old stores are never modified.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { sha256Hex } from "../records/hash.js";
import { readIa } from "../records/slots.js";
import {
  AGENT_KIND, DIRECTOR_PINNED_BY, IA_SCHEMA, MIGRATION_PINNED_BY, PAGE_SCHEMA, PUBLICATION_SCHEMA, SLOT_AGENTS, SLOT_SCHEMA,
  candidateName, deriveRefs, designerIa, directorIa, feedsIndex, iaPath, jsonBytes, serializeFrontmatter, slotPositions,
  slotRel, toSlotId, validateSlotDoc, withExtensions, writerIa,
  type FoundryIa, type FoundrySlot, type IaDoc, type IaLeafGroup, type IaNode, type PinDoc, type RawRefs, type SlotAgent, type SlotDoc, type SlotKind, type SourceDoc,
} from "../records/slot-model/index.js";
import { agentModule } from "../server/cells.js";
import { cmp, readDesignerContracts, readJsonFile, readLibrary, readOldStore, writerRecords, type LibraryVersion, type OldCell, type OldStore } from "./sources.js";

export interface PlannedCandidate { readonly name: string; readonly bytes: string }
export interface PlannedSlot {
  readonly id: string; readonly agent: SlotAgent; readonly kind: SlotKind;
  readonly contract: Readonly<Record<string, unknown>>;
  raw: { inputs: string[]; uses: string[] };
  readonly candidates: PlannedCandidate[];
  pin?: Omit<PinDoc, "sha256">;
}
export interface AgentPlan { readonly agent: SlotAgent; ia: IaDoc; readonly slots: Map<string, PlannedSlot>; readonly offIa: string[] }
export interface MigrationPlan {
  readonly consumer: string;
  readonly agents: Record<SlotAgent, AgentPlan>;
  /** Consumer-relative path -> bytes, in write order. */
  readonly files: Map<string, string>;
  /** Raw refs dropped by F10 because they name no IA slot. */
  readonly dropped: number;
  readonly old: OldStores;
}
export interface OldStores {
  readonly director: OldStore | null; readonly designer: OldStore | null; readonly writer: OldStore | null; readonly publisher: OldStore | null;
  readonly library: readonly LibraryVersion[]; readonly selection: Record<string, any> | null;
}

const EPOCH = "1970-01-01T00:00:00Z";
const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
const atOf = (updated: unknown) => typeof updated === "string" && /^\d{4}-\d{2}-\d{2}$/.test(updated) ? `${updated}T00:00:00Z` : undefined;

function gitAt(path: string): string | undefined {
  try {
    const out = execFileSync("git", ["log", "-1", "--format=%cI", "--", path], { cwd: dirname(path), encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    return out ? new Date(out).toISOString().replace(/\.\d{3}Z$/, "Z") : undefined;
  } catch { return undefined; }
}

/** `source` from legacy provenance keys (cites, links, sources, originKinds, lineage). */
function sourceFrom(kind: "derived" | "registry" | "original" | undefined, refs: readonly string[], extra: Partial<SourceDoc> = {}): SourceDoc {
  const ref = [...new Set(refs)].sort(cmp);
  const resolved = kind ?? (ref.length ? "derived" : "original");
  return { kind: resolved === "original" || ref.length ? resolved : "original", ref, ...extra };
}

function emptyPlan(foundry: FoundryIa | null, agent: SlotAgent, ia: IaDoc): AgentPlan {
  const slots = new Map<string, PlannedSlot>();
  for (const [id] of slotPositions(agent, ia)) {
    const slot = foundry?.slots.get(id);
    slots.set(id, {
      id, agent, kind: slot?.kind ?? AGENT_KIND[agent][0]!, contract: slot?.contract ?? {},
      raw: { inputs: [...(slot?.declaredInputs ?? [])], uses: [...(slot?.declaredUses ?? [])] }, candidates: [],
    });
  }
  return { agent, ia, slots, offIa: [] };
}

function existingExtensions(consumer: string, agent: SlotAgent): string[] {
  return [...(readIa(consumer, agent)?.extensions ?? [])];
}

// ---------- Director ----------
function planDirector(consumer: string, store: OldStore | null): { plan: AgentPlan; feeds: [string, string[]][] } {
  const foundry = directorIa();
  const plan = emptyPlan(foundry, "director", withExtensions("director", foundry.ia, existingExtensions(consumer, "director")));
  const feeds: [string, string[]][] = [...foundry.slots.values()].map(slot => [slot.id, [...slot.feeds]]);
  for (const cell of store?.cells ?? []) {
    const slot = plan.slots.get(cell.id);
    if (!slot) { if (!plan.offIa.includes(cell.id)) plan.offIa.push(cell.id); continue; }
    const name = candidateName("brief", cell.version, "md");
    const fields: Record<string, unknown> = {
      slot: cell.id,
      source: sourceFrom(undefined, strings(cell.fields.cites)),
      feeds: strings(cell.fields.feeds),
      functions: strings(cell.fields.functions),
      ...(typeof cell.fields.note === "string" ? { note: cell.fields.note } : {}),
    };
    slot.candidates.push({ name, bytes: serializeFrontmatter(fields, cell.body) });
    if (store!.tree.active[cell.id] === cell.version) {
      slot.pin = { candidate: name, pinnedBy: DIRECTOR_PINNED_BY, at: atOf(cell.fields.updated) ?? EPOCH };
      feeds.push([cell.id, strings(cell.fields.feeds)]);
    }
  }
  return { plan, feeds };
}

// ---------- Designer ----------
const PIN_LAYERS = new Set(["themes", "assets"]);
function lineageSource(record: Record<string, any>): SourceDoc {
  const lineage = record.lineage ?? {};
  const mode = String(lineage.mode ?? "original");
  const refs = Object.entries(lineage).filter(([key]) => key !== "mode").flatMap(([, value]) => {
    if (typeof value === "string") return [value];
    // Library lineage references and parents are structured identities. Keep
    // each complete value in the single source field rather than dropping it.
    if (value !== null && typeof value === "object") return [JSON.stringify(value)];
    return [];
  });
  const kind = mode === "original" || mode === "authored" ? "original" : mode === "derived" || mode === "customized" ? "derived" : "registry";
  return {
    ...sourceFrom(kind, kind === "original" ? [] : (refs.length ? refs : [`lineage:${mode}`])),
    ...(typeof record.hash === "string" ? { hash: record.hash } : {}),
    ...(typeof record.license?.spdx === "string" ? { license: record.license.spdx } : {}),
  };
}
function elementCandidate(version: LibraryVersion): string {
  let item: Record<string, any> | undefined;
  if (version.payload.length === 1 && version.payload[0]!.path.endsWith(".json")) {
    try {
      const parsed = JSON.parse(version.payload[0]!.content);
      if (parsed && typeof parsed.name === "string" && typeof parsed.type === "string"
        && (Array.isArray(parsed.files) || parsed.type === "registry:theme" || parsed.type === "registry:font")) item = { ...parsed, files: parsed.files ?? [] };
    } catch { /* not a registry item: inlined below */ }
  }
  item ??= { name: version.element, type: String(version.record.kind ?? "registry:item"), files: version.payload.map(file => ({ path: file.path, type: "registry:file", content: file.content })) };
  const { lineage: _lineage, hash: _hash, payload: _payload, version: _version, schema: _schema, ...element } = version.record;
  const { meta: itemMeta, ...rest } = item;
  return jsonBytes({ ...rest, meta: { ...(itemMeta ?? {}), slot: version.slot, source: lineageSource(version.record), element, ...(version.preview ? { preview: version.preview } : {}) } });
}
async function designerCellCandidate(cell: OldCell): Promise<string> {
  const profile = await agentModule("designer", "library-cli/cells.js");
  const parsed = profile.parseLibraryCell(cell.source, `cells/${cell.id}/v${cell.version}.md`) as { fill: unknown; rationale: string | null; originKinds: string[]; sources: string[] };
  const kinds = parsed.originKinds;
  const kind = kinds.includes("adopted") ? "registry" : kinds.includes("derived") ? "derived" : kinds.length ? "original" : undefined;
  return jsonBytes({
    name: cell.id,
    type: cell.id.startsWith("themes.") ? "registry:theme" : "registry:item",
    files: [{ path: `clossys/${cell.id}.json`, type: "registry:file", content: jsonBytes(parsed.fill) }],
    meta: { slot: cell.id, source: sourceFrom(kind, parsed.sources), ...(parsed.rationale ? { rationale: parsed.rationale } : {}) },
  });
}
async function planDesigner(consumer: string, store: OldStore | null, library: readonly LibraryVersion[], selection: Record<string, any> | null): Promise<AgentPlan> {
  const base = designerIa();
  const slots = new Map(base.slots);
  const foundry = { ...base, slots };
  // Only the existing owner-signed extension list grants membership. Contracts
  // and selection records on their own must never admit a new IA slot.
  const extensions = existingExtensions(consumer, "designer");
  const contracts = readDesignerContracts(consumer);
  for (const id of extensions) {
    if (foundry.slots.has(id)) continue;
    const contract = contracts.get(id);
    if (contract) slots.set(id, {
      id, kind: "element", contract, declaredInputs: [], declaredUses: [], feeds: [],
    });
  }
  const plan = emptyPlan(foundry, "designer", withExtensions("designer", foundry.ia, extensions));
  const off = (id: string) => { if (!plan.offIa.includes(id)) plan.offIa.push(id); };
  for (const cell of store?.cells ?? []) {
    const slot = plan.slots.get(cell.id);
    if (!slot) { off(cell.id); continue; }
    const name = candidateName("cell", cell.version, "json");
    slot.candidates.push({ name, bytes: await designerCellCandidate(cell) });
    // D2: themes and assets keep their old-cell pins; components, sections, frames come in unpinned.
    if (store!.tree.active[cell.id] === cell.version && PIN_LAYERS.has(cell.id.split(".")[0]!)) {
      slot.pin = { candidate: name, pinnedBy: MIGRATION_PINNED_BY, at: atOf(cell.fields.updated) ?? EPOCH };
    }
  }
  for (const version of library) {
    const slot = plan.slots.get(version.slot);
    if (!slot) { off(version.slot); continue; }
    const bytes = elementCandidate(version);
    slot.candidates.push({ name: candidateName(version.element, version.version, "json"), bytes });
    const item = JSON.parse(bytes);
    const dependencies = Array.isArray(version.record.deps?.elements) ? version.record.deps.elements : [];
    slot.raw.uses.push(...strings(item.registryDependencies), ...dependencies.flatMap((dep: unknown) =>
      typeof dep === "string" ? [dep] : dep !== null && typeof dep === "object" && typeof (dep as { slot?: unknown }).slot === "string" ? [(dep as { slot: string }).slot] : []));
  }
  // D3: the selection pin wins.
  const history = new Map<string, Record<string, any>>((Array.isArray(selection?.history) ? selection!.history : []).map((event: Record<string, any>) => [event.id, event]));
  for (const [id, pin] of Object.entries((selection?.pins ?? {}) as Record<string, Record<string, any>>)) {
    const slot = plan.slots.get(id);
    if (!slot) { off(id); continue; }
    const name = candidateName(String(pin.element), Number(pin.version), "json");
    if (!slot.candidates.some(candidate => candidate.name === name)) continue;
    slot.pin = { candidate: name, pinnedBy: MIGRATION_PINNED_BY, at: typeof history.get(pin.event)?.at === "string" ? history.get(pin.event)!.at : EPOCH };
  }
  for (const slot of plan.slots.values()) slot.candidates.sort((a, b) => cmp(a.name, b.name));
  return plan;
}

// ---------- Writer ----------
/** Stable per-source identity; history candidates are never pinned by migration. */
export const writerHistoryName = (cell: Pick<OldCell, "id" | "version">) => candidateName(`history.${cell.id}`, cell.version, "md");

function stringsBody(locales: string[], records: { locale: string; key: string; id: unknown; bindings: unknown; text: string }[]): string {
  let body = "";
  for (const locale of locales) {
    body += `\n## ${locale}\n`;
    for (const record of records.filter(row => row.locale === locale)) {
      body += `\n### ${record.key}\n<!-- ${JSON.stringify({ id: record.id, bindings: record.bindings })} -->\n${record.text}\n`;
    }
  }
  return body;
}
function planWriter(consumer: string, store: OldStore | null): AgentPlan {
  const foundry = writerIa();
  const plan = emptyPlan(foundry, "writer", withExtensions("writer", foundry.ia, existingExtensions(consumer, "writer")));
  // Preserve each source version independently of the active merged snapshot.
  // A historic record can disappear from the latest version or move between
  // leaves; taking only active + latest loses those earlier options.
  for (const cell of store?.cells ?? []) {
    const leaves = new Map<string, { locales: string[]; records: { locale: string; key: string; id: unknown; bindings: unknown; text: string }[] }>();
    for (const record of writerRecords(cell.body)) {
      const leaf = typeof record.meta.leaf === "string" ? record.meta.leaf : undefined;
      if (!leaf || !plan.slots.has(leaf)) {
        const id = leaf ?? `${cell.id}#${record.key}`;
        if (!plan.offIa.includes(id)) plan.offIa.push(id);
        continue;
      }
      const group = leaves.get(leaf) ?? { locales: [], records: [] };
      leaves.set(leaf, group);
      if (!group.locales.includes(record.locale)) group.locales.push(record.locale);
      group.records.push({ locale: record.locale, key: record.key, id: record.meta.id, bindings: record.meta.bindings ?? [], text: record.text });
    }
    for (const [leaf, group] of leaves) plan.slots.get(leaf)!.candidates.push({
      name: writerHistoryName(cell),
      bytes: serializeFrontmatter({
        slot: leaf, locales: group.locales,
        source: sourceFrom(undefined, strings(cell.fields.links), { hash: sha256Hex(cell.source) }),
      }, stringsBody(group.locales, group.records)),
    });
  }
  // D5: one candidate per leaf, merging the active records of every cell. Cells
  // with no active version contribute their latest version to a separate draft.
  const groups = new Map<string, { pinned: boolean; refs: string[]; locales: string[]; records: { locale: string; key: string; id: unknown; bindings: unknown; text: string }[]; updated: string[] }>();
  const latest = new Map<string, OldCell>();
  for (const cell of store?.cells ?? []) if ((latest.get(cell.id)?.version ?? 0) < cell.version) latest.set(cell.id, cell);
  // A newer draft above the active version is kept as the leaf's draft candidate.
  const chosen = [...latest.keys()].sort(cmp).flatMap(id => {
    const active = store!.tree.active[id];
    const cell = typeof active === "number" ? store!.cells.find(row => row.id === id && row.version === active) : undefined;
    const newest = latest.get(id)!;
    return [...(cell ? [{ cell, active: true }] : []), ...(newest !== cell ? [{ cell: newest, active: false }] : [])];
  });
  for (const { cell, active } of chosen) for (const record of writerRecords(cell.body)) {
    const leaf = typeof record.meta.leaf === "string" ? record.meta.leaf : undefined;
    if (!leaf || !plan.slots.has(leaf)) { const id = leaf ?? `${cell.id}#${record.key}`; if (!plan.offIa.includes(id)) plan.offIa.push(id); continue; }
    const key = `${leaf}\0${active ? "migrated" : "draft"}`;
    const group = groups.get(key) ?? { pinned: active, refs: [], locales: [], records: [], updated: [] };
    groups.set(key, group);
    group.refs.push(...strings(cell.fields.links));
    if (!group.locales.includes(record.locale)) group.locales.push(record.locale);
    group.records.push({ locale: record.locale, key: record.key, id: record.meta.id, bindings: record.meta.bindings ?? [], text: record.text });
    if (typeof cell.fields.updated === "string") group.updated.push(cell.fields.updated);
  }
  for (const [key, group] of [...groups].sort(([a], [b]) => cmp(a, b))) {
    const [leaf, base] = key.split("\0") as [string, string];
    const slot = plan.slots.get(leaf)!;
    const name = candidateName(base, 1, "md");
    const fields = { slot: leaf, locales: group.locales, source: sourceFrom(undefined, group.refs) };
    slot.candidates.push({ name, bytes: serializeFrontmatter(fields, stringsBody(group.locales, group.records)) });
    if (group.pinned) slot.pin = { candidate: name, pinnedBy: MIGRATION_PINNED_BY, at: atOf([...group.updated].sort(cmp).at(-1)) ?? EPOCH };
  }
  return plan;
}

// ---------- Publisher ----------
const PAGE_BLOCKS = ["Constructs", "Manifest", "Actions", "Route"] as const;
const PAGE_DROP = new Set(["id", "version", "status", "updated", "links", "confirmed", "title", "path", "slug", "frame", "sections"]);
/** Copy bullets and fenced JSON blocks of a Publisher page cell. */
export function pageBlocks(body: string): { copy: Record<string, string>; blocks: Record<string, unknown> } {
  const lines = body.split("\n"), copy: Record<string, string> = {}, blocks: Record<string, unknown> = {};
  let heading = "";
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const h = /^## (.+)$/.exec(line);
    if (h) { heading = h[1]!; continue; }
    if (heading === "Copy") {
      // `- key: writer:<cell>` binds copy slot `key` to Writer key `key`; `- slot = key: writer:<cell>` binds `slot` to `key`.
      const bullet = /^- ([^:]+): writer:(.+)$/.exec(line);
      if (bullet) { const spec = bullet[1]!.trim(), equals = spec.indexOf(" = "); copy[equals >= 0 ? spec.slice(0, equals).trim() : spec] = `${bullet[2]!.trim()}#${equals >= 0 ? spec.slice(equals + 3).trim() : spec}`; }
      continue;
    }
    if (line === "```json" && (PAGE_BLOCKS as readonly string[]).includes(heading)) {
      const content: string[] = [];
      while (++i < lines.length && lines[i] !== "```") content.push(lines[i]!);
      blocks[heading] = JSON.parse(content.join("\n"));
    }
  }
  return { copy, blocks };
}
interface PublisherTreeNode { id: string; name: string; entry?: Record<string, unknown>; cells?: string[]; children?: PublisherTreeNode[] }
function planPublisher(consumer: string, store: OldStore | null): AgentPlan {
  const raw = store?.tree.raw;
  if (!raw || !Array.isArray(raw.tree)) {
    let ia: IaDoc = { schema: IA_SCHEMA, source: "consumer#agents/publisher/tree.json", extensions: [], nodes: [] };
    try { ia = readJsonFile(iaPath(consumer, "publisher")) as IaDoc; } catch { /* no Publisher store yet */ }
    return emptyPlan(null, "publisher", ia);
  }
  const publications = new Map<string, Record<string, any>>((Array.isArray(raw.meta?.publications) ? raw.meta.publications : []).map((pub: Record<string, any>) => [pub.id, pub]));
  const nodes: IaNode[] = [];
  const kinds = new Map<string, SlotKind>();
  for (const top of raw.tree as PublisherTreeNode[]) {
    const children: IaLeafGroup[] = [];
    const walk = (node: PublisherTreeNode) => {
      if ((node.cells ?? []).length) children.push({ id: node.id, label: node.name, slots: [...node.cells!] });
      for (const child of node.children ?? []) walk(child);
    };
    for (const child of top.children ?? []) walk(child);
    if (top.cells?.length) children.unshift({ id: `${top.id}.root`, label: top.name, slots: [...top.cells] });
    if (publications.has(top.id)) { children.push({ id: "publication", label: "Publication", slots: [`publication.${top.id}`] }); kinds.set(`publication.${top.id}`, "publication"); }
    nodes.push({ id: top.id, label: top.name, children });
  }
  const ia: IaDoc = { schema: IA_SCHEMA, source: "consumer#agents/publisher/tree.json", extensions: [], nodes };
  const plan = emptyPlan(null, "publisher", ia);
  for (const [id, kind] of kinds) plan.slots.set(id, { ...plan.slots.get(id)!, kind });
  const pubOf = new Map<string, Record<string, any>>();
  for (const top of raw.tree as PublisherTreeNode[]) {
    const pub = publications.get(top.id);
    if (!pub) continue;
    const visit = (node: PublisherTreeNode) => { for (const id of node.cells ?? []) pubOf.set(id, pub); for (const child of node.children ?? []) visit(child); };
    visit(top);
  }
  const pageUpdated = new Map<string, string[]>();
  for (const cell of store!.cells) {
    const slot = plan.slots.get(cell.id);
    if (!slot) { if (!plan.offIa.includes(cell.id)) plan.offIa.push(cell.id); continue; }
    const f = cell.fields as Record<string, any>;
    const { copy, blocks } = pageBlocks(cell.body);
    const pub = pubOf.get(cell.id);
    const fields = Object.fromEntries(Object.entries(f).filter(([key]) => !PAGE_DROP.has(key)));
    const actionSections = (Array.isArray(blocks.Actions) ? blocks.Actions as Record<string, any>[] : []).map(action => action?.module?.section).filter((value): value is string => typeof value === "string");
    const nav = pub?.entryMeta?.[cell.id]?.pin;
    const candidate = {
      schema: PAGE_SCHEMA,
      ...(typeof f.path === "string" ? { path: f.path } : { slug: f.slug }),
      title: f.title,
      frame: typeof f.frame === "string" ? f.frame : null,
      sections: strings(f.sections),
      copy,
      ...(nav === undefined ? {} : { nav }),
      meta: {
        source: sourceFrom(undefined, strings(f.links)),
        entry: { fields, blocks, ...(pub ? { publication: pub.id, entryId: pub.entryIds?.[cell.id], ...(pub.entryMeta?.[cell.id] === undefined ? {} : { entryMeta: pub.entryMeta[cell.id] }) } : {}) },
      },
    };
    const name = candidateName("page", cell.version, "json");
    slot.candidates.push({ name, bytes: jsonBytes(candidate) });
    slot.raw.uses = [...new Set([...slot.raw.uses, ...(candidate.frame ? [candidate.frame] : []), ...candidate.sections, ...actionSections, ...Object.values(copy).map(ref => ref.slice(0, ref.indexOf("#")))])];
    if (store!.tree.active[cell.id] === cell.version) {
      slot.pin = { candidate: name, pinnedBy: MIGRATION_PINNED_BY, at: atOf(f.updated) ?? EPOCH };
      if (pub && typeof f.updated === "string") pageUpdated.set(pub.id, [...(pageUpdated.get(pub.id) ?? []), f.updated]);
    }
  }
  for (const top of raw.tree as PublisherTreeNode[]) {
    const pub = publications.get(top.id);
    if (!pub) continue;
    const id = `publication.${top.id}`, slot = plan.slots.get(id)!;
    const { id: _id, format, entryOrder, routePack, entryIds: _ids, entryMeta: _meta, ...header } = pub;
    const pages = [...pubOf].filter(([, owner]) => owner === pub).map(([page]) => page);
    const candidate = {
      schema: PUBLICATION_SCHEMA, format, entryOrder: strings(entryOrder), ...(routePack === undefined ? {} : { routePack }),
      meta: { source: sourceFrom("derived", ["publisher:tree.json"]), tree: top, ...(Object.keys(header).length ? { header } : {}) },
    };
    const name = candidateName("publication", 1, "json");
    slot.candidates.push({ name, bytes: jsonBytes(candidate) });
    slot.raw.uses = pages;
    const updated = [...(pageUpdated.get(top.id) ?? [])].sort(cmp).at(-1);
    slot.pin = { candidate: name, pinnedBy: MIGRATION_PINNED_BY, at: atOf(updated) ?? gitAt(join(store!.root, "tree.json")) ?? EPOCH };
  }
  return plan;
}

/** Read every old store under `<consumer>` (the `clossys/` workspace folder). */
export async function readOldStores(consumer: string): Promise<OldStores> {
  const agents = join(consumer, "agents");
  const director = await readOldStore(join(agents, "director")) ?? await readOldStore(join(agents, "strategist"));
  const selectionPath = join(consumer, "selection.json");
  return {
    director, designer: await readOldStore(join(agents, "designer")), writer: await readOldStore(join(agents, "writer")), publisher: await readOldStore(join(agents, "publisher")),
    library: readLibrary(join(consumer, "library")), selection: existsSync(selectionPath) ? readJsonFile(selectionPath) : null,
  };
}

/** Slot declarations become authored data after migration; refresh only their generated metadata. */
function existingWiring(consumer: string, rel: string, generated: SlotDoc): Pick<SlotDoc, "inputs" | "uses"> | undefined {
  let existing: SlotDoc;
  try { existing = readJsonFile(join(consumer, rel, "slot.json")) as SlotDoc; }
  catch { return undefined; }
  if (validateSlotDoc(existing).length || existing.id !== generated.id || existing.agent !== generated.agent || existing.kind !== generated.kind
    || existing.ia.l0 !== generated.ia.l0 || existing.ia.l1 !== generated.ia.l1 || existing.ia.l2 !== generated.ia.l2) return undefined;
  // Order and contract are generated. Unresolved refs remain visible to the
  // model checks rather than being replaced with guesses from legacy stores.
  return { inputs: existing.inputs, uses: existing.uses };
}

/** Build the full, deterministic migration plan. Pure apart from reads. */
export async function planMigration(consumer: string): Promise<MigrationPlan> {
  const old = await readOldStores(consumer);
  const director = planDirector(consumer, old.director);
  const agents: Record<SlotAgent, AgentPlan> = {
    director: director.plan,
    designer: await planDesigner(consumer, old.designer, old.library, old.selection),
    writer: planWriter(consumer, old.writer),
    publisher: planPublisher(consumer, old.publisher),
  };
  const known = new Set(SLOT_AGENTS.flatMap(agent => [...agents[agent].slots.keys()]));
  const ctx = { known, feeds: feedsIndex(director.feeds, known) };
  const files = new Map<string, string>();
  let dropped = 0;
  for (const agent of SLOT_AGENTS) {
    const plan = agents[agent];
    plan.offIa.sort(cmp);
    files.set(`agents/${agent}/ia.json`, jsonBytes(plan.ia));
    const positions = slotPositions(agent, plan.ia);
    for (const [id, position] of positions) {
      const slot = plan.slots.get(id)!;
      const derived = deriveRefs(agent, slot.kind, id, slot.raw as RawRefs, ctx);
      dropped += derived.dropped.length;
      const doc: SlotDoc = { schema: SLOT_SCHEMA, id, agent, ia: position, kind: slot.kind, contract: slot.contract, inputs: derived.inputs, uses: derived.uses };
      const rel = `agents/${agent}/${slotRel(position, id)}`;
      files.set(`${rel}/slot.json`, jsonBytes({ ...doc, ...existingWiring(consumer, rel, doc) }));
      for (const candidate of slot.candidates) files.set(`${rel}/candidates/${candidate.name}`, candidate.bytes);
      if (slot.pin) {
        const bytes = slot.candidates.find(candidate => candidate.name === slot.pin!.candidate)!.bytes;
        const pin: PinDoc = { candidate: slot.pin.candidate, sha256: sha256Hex(bytes), pinnedBy: slot.pin.pinnedBy, at: slot.pin.at };
        files.set(`${rel}/pin.json`, jsonBytes(pin));
      }
    }
  }
  return { consumer, agents, files, dropped, old };
}

export interface WriteResult { readonly written: string[]; readonly unchanged: number; readonly kept: string[] }
/**
 * Write the plan. IA and slot metadata are refreshed, with authored wiring
 * preserved by planMigration. An existing candidate or pin.json with different bytes is kept (never
 * overwritten) and reported, so re-running never reverts later authoring.
 */
export function writePlan(plan: MigrationPlan): WriteResult {
  const written: string[] = [], kept: string[] = [];
  let unchanged = 0;
  for (const [rel, bytes] of plan.files) {
    const path = join(plan.consumer, ...rel.split("/"));
    const current = existsSync(path) ? readFileSync(path, "utf8") : undefined;
    if (current === bytes) { unchanged++; continue; }
    const generated = rel.endsWith("/ia.json") || rel.endsWith("/slot.json");
    if (current !== undefined && !generated) { kept.push(rel); continue; }
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, bytes);
    written.push(rel);
  }
  return { written, unchanged, kept };
}

export const consumerRel = (consumer: string, path: string) => relative(consumer, path).split(sep).join("/");
export type { FoundrySlot };
export { toSlotId };
