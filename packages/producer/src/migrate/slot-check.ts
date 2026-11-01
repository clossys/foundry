/**
 * `clossys migrate slots --check` / `--compare` and `clossys check --slots --readiness`.
 *
 * check: folder == IA position, one pin, pin hash matches, a single `source`
 * key, no candidate-side status, inputs/uses name real slots, no orphans.
 * compare: re-derive the old projections from the old stores and from the slot
 * model and diff them; 0 diffs is the migration's acceptance.
 */
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hashFiles, sha256Hex } from "../records/hash.js";
import {
  AGENT_KIND, CANDIDATES_DIR, IA_FILE, LEGACY_ENTRIES, PIN_FILE, SLOT_AGENTS, SLOT_FILE, agentDir, candidatesDir, iaPath,
  parseFrontmatter, sameJson, slotPositions, validateCandidate, validateIa, validatePin, validateSlotDoc,
  type IaDoc, type PinDoc, type SlotAgent, type SlotDoc, type SlotModelIssue,
} from "../records/slot-model/index.js";
import { listSlots, readiness, slotIndex, type Readiness } from "../records/slots.js";
import { agentModule } from "../server/cells.js";
import { cmp, readJsonFile, writerRecords } from "./sources.js";
import { readOldStores, writerHistoryName, type OldStores } from "./slots.js";

const isDir = (path: string) => { try { const stat = lstatSync(path); return stat.isDirectory() && !stat.isSymbolicLink(); } catch { return false; } };
const list = (path: string) => isDir(path) ? readdirSync(path).sort(cmp) : [];

// ---------------- check ----------------
export function checkSlotModel(consumer: string): SlotModelIssue[] {
  const issues: SlotModelIssue[] = [];
  const ias = new Map<SlotAgent, IaDoc>();
  for (const agent of SLOT_AGENTS) {
    const path = iaPath(consumer, agent);
    if (!existsSync(path)) continue;
    let ia: unknown;
    try { ia = readJsonFile(path); } catch { issues.push({ code: "ia-invalid", path: `agents/${agent}/${IA_FILE}`, message: "ia.json is not JSON" }); continue; }
    const found = validateIa(ia, `agents/${agent}/${IA_FILE}`);
    issues.push(...found);
    if (!found.length) ias.set(agent, ia as IaDoc);
  }
  if (!ias.size && !issues.length) return [{ code: "ia-invalid", path: "agents", message: "no agents/<agent>/ia.json: run clossys migrate slots" }];
  const known = new Set<string>(), where = new Map<string, { agent: SlotAgent; l1: string; l2: string }>();
  for (const [agent, ia] of ias) for (const [id, position] of slotPositions(agent, ia)) { known.add(id); where.set(id, { agent, l1: position.l1, l2: position.l2 }); }

  for (const [agent, ia] of ias) {
    const positions = slotPositions(agent, ia);
    const base = agentDir(consumer, agent);
    for (const [id, position] of positions) {
      const rel = `agents/${agent}/${position.l1}/${position.l2}/${id}`;
      const dir = join(base, position.l1, position.l2, id);
      if (!isDir(dir)) { issues.push({ code: "slot-missing", path: rel, message: `IA slot ${id} has no folder at its IA position` }); continue; }
      let doc: SlotDoc | undefined;
      try {
        const value = readJsonFile(join(dir, SLOT_FILE));
        const found = validateSlotDoc(value, `${rel}/${SLOT_FILE}`);
        issues.push(...found);
        if (!found.length) doc = value as SlotDoc;
      } catch { issues.push({ code: "slot-invalid", path: `${rel}/${SLOT_FILE}`, message: "slot.json is missing or not JSON" }); }
      if (doc) {
        if (doc.id !== id || doc.agent !== agent || doc.ia.l1 !== position.l1 || doc.ia.l2 !== position.l2 || doc.ia.order !== position.order || (doc.ia.l0 ?? undefined) !== position.l0) {
          issues.push({ code: "slot-mismatch", path: `${rel}/${SLOT_FILE}`, message: `slot.json disagrees with ia.json position for ${id}` });
        }
        if (!AGENT_KIND[agent].includes(doc.kind)) issues.push({ code: "slot-mismatch", path: `${rel}/${SLOT_FILE}`, message: `kind ${doc.kind} does not belong to ${agent}` });
        for (const key of ["inputs", "uses"] as const) for (const ref of doc[key]) if (!known.has(ref)) issues.push({ code: "ref-unknown", path: `${rel}/${SLOT_FILE}`, message: `${key} names ${ref}, which is not an IA slot` });
      }
      const names = list(candidatesDir(dir));
      if (doc) for (const name of names) {
        const bytes = readFileSync(join(candidatesDir(dir), name), "utf8");
        issues.push(...validateCandidate(doc.kind, id, name, bytes, `${rel}/${CANDIDATES_DIR}/${name}`));
      }
      const pins = list(dir).filter(name => /^pin.*\.json$/.test(name));
      if (pins.some(name => name !== PIN_FILE)) issues.push({ code: "pin-invalid", path: rel, message: `one pin only: pin.json (found ${pins.join(", ")})` });
      if (pins.includes(PIN_FILE)) {
        let pin: PinDoc | undefined;
        try {
          const value = readJsonFile(join(dir, PIN_FILE));
          const found = validatePin(value, `${rel}/${PIN_FILE}`);
          issues.push(...found);
          if (!found.length) pin = value as PinDoc;
        } catch { issues.push({ code: "pin-invalid", path: `${rel}/${PIN_FILE}`, message: "pin.json is not JSON" }); }
        if (pin) {
          if (!names.includes(pin.candidate)) issues.push({ code: "pin-candidate", path: `${rel}/${PIN_FILE}`, message: `pinned candidate ${pin.candidate} does not exist` });
          else if (sha256Hex(readFileSync(join(candidatesDir(dir), pin.candidate))) !== pin.sha256) issues.push({ code: "pin-hash", path: `${rel}/${PIN_FILE}`, message: `${pin.candidate} bytes do not match the pinned sha256` });
        }
      }
      for (const name of list(dir)) if (![SLOT_FILE, PIN_FILE, CANDIDATES_DIR].includes(name) && !/^pin.*\.json$/.test(name)) issues.push({ code: "orphan", path: `${rel}/${name}`, message: `unexpected entry in slot folder ${id}` });
    }
    // Orphans: folders the IA does not place (legacy stores excepted until F8).
    const l1s = new Map(ia.nodes.map(node => [node.id, new Map(node.children.map(child => [child.id, new Set(child.slots)]))]));
    for (const l1 of list(base)) {
      if (l1 === IA_FILE || LEGACY_ENTRIES[agent].includes(l1)) continue;
      const l2s = l1s.get(l1);
      if (!l2s) { issues.push({ code: "orphan", path: `agents/${agent}/${l1}`, message: `${l1} is not an L1 of the ${agent} IA` }); continue; }
      for (const l2 of list(join(base, l1))) {
        const slots = l2s.get(l2);
        if (!slots) { issues.push({ code: "orphan", path: `agents/${agent}/${l1}/${l2}`, message: `${l2} is not an L2 under ${l1}` }); continue; }
        for (const slot of list(join(base, l1, l2))) {
          if (slots.has(slot)) continue;
          const home = where.get(slot);
          if (home) issues.push({ code: "ia-path", path: `agents/${agent}/${l1}/${l2}/${slot}`, message: `${slot} belongs at agents/${home.agent}/${home.l1}/${home.l2}` });
          else issues.push({ code: "orphan", path: `agents/${agent}/${l1}/${l2}/${slot}`, message: `${slot} is not a slot of the ${agent} IA` });
        }
      }
    }
  }
  return issues.sort((a, b) => cmp(a.path, b.path) || cmp(a.code, b.code));
}

// ---------------- compare ----------------
export interface CompareDiff { readonly agent: SlotAgent; readonly code: `compare-${SlotAgent}`; readonly message: string }
interface ModelSlot { id: string; dir: string; pin: PinDoc | null; candidates: readonly string[] }
const modelSlots = (consumer: string, agent: SlotAgent) => new Map<string, ModelSlot>(listSlots(consumer, agent).map(entry => [entry.id, entry]));
const pinnedBytes = (slot: ModelSlot | undefined): string | undefined => {
  if (!slot?.pin || !slot.candidates.includes(slot.pin.candidate)) return undefined;
  return readFileSync(join(candidatesDir(slot.dir), slot.pin.candidate), "utf8");
};
const versionOf = (name: string) => Number(/-v(\d+)\.(md|json)$/.exec(name)?.[1] ?? 0);

function compareDirector(consumer: string, old: OldStores, diff: (message: string) => void): void {
  const model = modelSlots(consumer, "director");
  const expected = new Map<string, number>();
  for (const [id, version] of Object.entries(old.director?.tree.active ?? {})) if (typeof version === "number" && model.has(id)) expected.set(id, version);
  for (const [id, slot] of model) {
    const want = expected.get(id);
    if (want === undefined) { if (slot.pin) diff(`${id}: pinned in the slot model but not active in the old tree`); continue; }
    if (slot.pin?.candidate !== `brief-v${want}.md`) { diff(`${id}: old active v${want}, model pin ${slot.pin?.candidate ?? "none"}`); continue; }
    const cell = old.director!.cells.find(row => row.id === id && row.version === want)!;
    const parsed = parseFrontmatter(pinnedBytes(slot) ?? "");
    if (!parsed.ok || parsed.value.body !== (cell.body.startsWith("\n") ? cell.body : `\n${cell.body}`)) diff(`${id}: pinned brief body differs from the old active cell`);
  }
}

async function compareDesigner(consumer: string, old: OldStores, diff: (message: string) => void): Promise<void> {
  const model = modelSlots(consumer, "designer");
  const expected = new Map<string, { candidate: string; check: (bytes: string) => string | undefined }>();
  const profile = old.designer?.cells.length ? await agentModule("designer", "library-cli/cells.js") : undefined;
  for (const [id, version] of Object.entries(old.designer?.tree.active ?? {})) {
    if (typeof version !== "number" || !model.has(id) || !["themes", "assets"].includes(id.split(".")[0]!)) continue;
    const cell = old.designer!.cells.find(row => row.id === id && row.version === version);
    // An active pointer without a cell file has nothing to migrate; the plan leaves it unpinned too.
    if (!cell) { if (model.get(id)?.pin) diff(`${id}: pinned but the old active cell v${version} does not exist`); continue; }
    const fill = profile.parseLibraryCell(cell.source, `cells/${id}/v${version}.md`).fill;
    expected.set(id, { candidate: `cell-v${version}.json`, check: bytes => sameJson(JSON.parse(JSON.parse(bytes).files[0].content), fill) ? undefined : "fill differs from the old active cell" });
  }
  for (const [id, pin] of Object.entries((old.selection?.pins ?? {}) as Record<string, Record<string, any>>)) {
    if (!model.has(id)) continue;
    const version = old.library.find(row => row.slot === id && row.element === pin.element && row.version === pin.version);
    if (!version) continue;
    expected.set(id, { candidate: `${pin.element}-v${pin.version}.json`, check: bytes => {
      if (hashFiles(version.dir, version.payload.map(file => file.path)) !== pin.hash) return "old library payload no longer matches its selection hash";
      return JSON.parse(bytes).meta?.source?.hash === pin.hash ? undefined : "candidate source.hash differs from the selection hash";
    } });
  }
  for (const [id, slot] of model) {
    const want = expected.get(id);
    if (!want) { if (slot.pin) diff(`${id}: pinned in the slot model but pinned by no old store`); continue; }
    if (slot.pin?.candidate !== want.candidate) { diff(`${id}: old pin ${want.candidate}, model pin ${slot.pin?.candidate ?? "none"}`); continue; }
    const problem = want.check(pinnedBytes(slot) ?? "{}");
    if (problem) diff(`${id}: ${problem}`);
  }
}

function compareWriter(consumer: string, old: OldStores, diff: (message: string) => void): void {
  const model = modelSlots(consumer, "writer");
  const tuple = (leaf: string, row: { locale: string; key: string; id: unknown; bindings: unknown; text: string }) => JSON.stringify([leaf, row.locale, row.key, row.id, row.bindings ?? [], row.text]);
  // Compare every source version, including retired versions and records no
  // longer present in either the active snapshot or the newest draft. Arrays
  // retain multiplicity, so dropping one of two equal records is detected.
  for (const cell of old.writer?.cells ?? []) {
    const expected = new Map<string, string[]>();
    for (const record of writerRecords(cell.body)) {
      const leaf = record.meta.leaf;
      if (typeof leaf !== "string" || !model.has(leaf)) {
        diff(`${cell.id}@${cell.version}: historical record has no declared Writer slot`);
        continue;
      }
      const rows = expected.get(leaf) ?? [];
      expected.set(leaf, rows);
      rows.push(tuple(leaf, { locale: record.locale, key: record.key, id: record.meta.id, bindings: record.meta.bindings, text: record.text }));
    }
    for (const [leaf, records] of expected) {
      const slot = model.get(leaf)!, name = writerHistoryName(cell);
      if (!slot.candidates.includes(name)) { diff(`${cell.id}@${cell.version}: historical candidate missing from ${leaf}`); continue; }
      const parsed = parseFrontmatter(readFileSync(join(candidatesDir(slot.dir), name), "utf8"));
      if (!parsed.ok) { diff(`${cell.id}@${cell.version}: historical candidate unreadable in ${leaf}`); continue; }
      const refs = [...new Set(Array.isArray(cell.fields.links) ? cell.fields.links.filter((ref): ref is string => typeof ref === "string") : [])].sort(cmp);
      const source = parsed.value.fields.source as Record<string, unknown> | undefined;
      if (source?.hash !== sha256Hex(cell.source) || !sameJson(source?.ref, refs)) diff(`${cell.id}@${cell.version}: historical source bytes or references differ in ${leaf}`);
      const actual = writerRecords(parsed.value.body).map(record => tuple(leaf, { locale: record.locale, key: record.key, id: record.meta.id, bindings: record.meta.bindings, text: record.text }));
      if (!sameJson(records.sort(cmp), actual.sort(cmp))) diff(`${cell.id}@${cell.version}: historical record bytes or multiplicity differ in ${leaf}`);
    }
  }
  const before = new Set<string>(), after = new Set<string>();
  for (const [id, version] of Object.entries(old.writer?.tree.active ?? {})) {
    if (typeof version !== "number") continue;
    const cell = old.writer!.cells.find(row => row.id === id && row.version === version);
    if (!cell) continue;
    for (const record of writerRecords(cell.body)) {
      const leaf = record.meta.leaf;
      if (typeof leaf === "string" && model.has(leaf)) before.add(tuple(leaf, { locale: record.locale, key: record.key, id: record.meta.id, bindings: record.meta.bindings, text: record.text }));
    }
  }
  for (const [id, slot] of model) {
    const bytes = pinnedBytes(slot);
    if (!bytes) continue;
    const parsed = parseFrontmatter(bytes);
    if (!parsed.ok) { diff(`${id}: pinned candidate unreadable`); continue; }
    for (const record of writerRecords(parsed.value.body)) after.add(tuple(id, { locale: record.locale, key: record.key, id: record.meta.id, bindings: record.meta.bindings, text: record.text }));
  }
  for (const row of before) if (!after.has(row)) diff(`old active record missing from pinned candidates: ${row}`);
  for (const row of after) if (!before.has(row)) diff(`pinned record not active in the old store: ${row}`);
}

const scalar = (value: unknown, serialize: (value: unknown) => string) => Array.isArray(value) ? `[${value.map(serialize).join(", ")}]` : serialize(value);
async function rebuildPublisher(consumer: string, root: string): Promise<boolean> {
  const store = await agentModule("director", "cell-format/index.js");
  const model = modelSlots(consumer, "publisher");
  const tree: Record<string, any>[] = [], publications: Record<string, any>[] = [], active: Record<string, number> = {};
  const pages = new Map<string, { version: number; doc: Record<string, any> }>();
  for (const [id, slot] of model) {
    const bytes = pinnedBytes(slot);
    if (!bytes || !id.startsWith("page.")) continue;
    pages.set(id, { version: versionOf(slot.pin!.candidate), doc: JSON.parse(bytes) });
  }
  for (const [id, slot] of model) {
    const bytes = pinnedBytes(slot);
    if (!bytes || !id.startsWith("publication.")) continue;
    const doc = JSON.parse(bytes), pubId = id.slice("publication.".length);
    const prune = (node: Record<string, any>): Record<string, any> => ({ ...node, ...(node.cells ? { cells: (node.cells as string[]).filter(cell => pages.has(cell)) } : {}), ...(node.children ? { children: (node.children as Record<string, any>[]).map(prune) } : {}) });
    tree.push(prune(doc.meta.tree));
    const entryIds: Record<string, string> = {}, entryMeta: Record<string, unknown> = {};
    for (const [page, { doc: pageDoc }] of pages) if (pageDoc.meta?.entry?.publication === pubId) {
      entryIds[page] = pageDoc.meta.entry.entryId;
      if (pageDoc.meta.entry.entryMeta !== undefined) entryMeta[page] = pageDoc.meta.entry.entryMeta;
    }
    publications.push({ id: pubId, format: doc.format, entryIds, entryOrder: doc.entryOrder, entryMeta, ...(doc.meta.header ?? {}), ...(doc.routePack === undefined ? {} : { routePack: doc.routePack }) });
  }
  if (!publications.length) return false;
  for (const [id, { version, doc }] of pages) {
    if (!publications.some(pub => pub.id === doc.meta?.entry?.publication)) continue;
    active[id] = version;
    const front: Record<string, unknown> = { id, version, status: "active", updated: "2000-01-01", links: [], confirmed: "msg:slot-model-compare#U1", ...doc.meta.entry.fields, title: doc.title, ...(doc.path === undefined ? { slug: doc.slug } : { path: doc.path }), ...(doc.frame ? { frame: doc.frame, sections: doc.sections } : {}) };
    let body = "## Copy\n" + Object.entries(doc.copy as Record<string, string>).map(([key, target]) => `- ${key}: writer:${target}\n`).join("");
    for (const heading of ["Constructs", "Manifest", "Actions", "Route"]) if (doc.meta.entry.blocks?.[heading] !== undefined) body += `\n## ${heading}\n\`\`\`json\n${JSON.stringify(doc.meta.entry.blocks[heading], null, 2)}\n\`\`\`\n`;
    const source = `---\n${Object.entries(front).filter(([, value]) => value !== undefined).map(([key, value]) => `${key}: ${scalar(value, v => store.serializeScalar(v))}`).join("\n")}\n---\n\n${body}`;
    mkdirSync(join(root, "cells", id), { recursive: true });
    writeFileSync(join(root, "cells", id, `v${version}.md`), source);
  }
  writeFileSync(join(root, "tree.json"), `${JSON.stringify({ schemaVersion: 1, tree, active, retired: [], meta: { publications } }, null, 2)}\n`);
  return true;
}
function projections(root: string): Map<string, unknown> {
  const out = new Map<string, unknown>();
  for (const dir of ["content-map", "route-pack"]) for (const name of list(join(root, dir))) out.set(`${dir}/${name}`, readJsonFile(join(root, dir, name)));
  return out;
}
async function comparePublisher(consumer: string, old: OldStores, diff: (message: string) => void): Promise<void> {
  const model = modelSlots(consumer, "publisher");
  for (const [id, version] of Object.entries(old.publisher?.tree.active ?? {})) {
    if (typeof version !== "number" || !model.has(id)) continue;
    const pin = model.get(id)!.pin;
    if (pin?.candidate !== `page-v${version}.json`) diff(`${id}: old active v${version}, model pin ${pin?.candidate ?? "none"}`);
  }
  for (const [id, slot] of model) if (id.startsWith("page.") && slot.pin && old.publisher?.tree.active[id] !== versionOf(slot.pin.candidate)) diff(`${id}: pinned in the slot model but not active in the old tree`);
  if (!old.publisher || !(old.publisher.tree.raw.meta?.publications ?? []).length) return;
  const compiler = await agentModule("publisher", "content-map/cells.js");
  // The publisher compiler refuses symlinked paths; macOS tmpdir sits under the /var symlink.
  const work = realpathSync(mkdtempSync(join(tmpdir(), "clossys-slot-compare-")));
  try {
    const before = join(work, "old"), after = join(work, "model");
    mkdirSync(before); mkdirSync(after);
    cpSync(join(old.publisher.root, "tree.json"), join(before, "tree.json"));
    if (existsSync(join(old.publisher.root, "cells"))) cpSync(join(old.publisher.root, "cells"), join(before, "cells"), { recursive: true });
    let oldMaps: Map<string, unknown>;
    try { await compiler.compileContentMaps(before, { agentRoots: {} }); oldMaps = projections(before); }
    catch (error) { diff(`old Publisher store does not compile: ${(error as Error).message}`); return; }
    let newMaps = new Map<string, unknown>();
    try { if (await rebuildPublisher(consumer, after)) { await compiler.compileContentMaps(after, { agentRoots: {} }); newMaps = projections(after); } }
    catch (error) { diff(`slot-model Publisher projection does not compile: ${(error as Error).message}`); return; }
    for (const [path, value] of oldMaps) {
      if (!newMaps.has(path)) diff(`${path}: missing from the slot-model projection`);
      else if (!sameJson(value, newMaps.get(path))) diff(`${path}: slot-model projection differs from the old projection`);
    }
    for (const path of newMaps.keys()) if (!oldMaps.has(path)) diff(`${path}: not produced by the old store`);
  } finally { rmSync(work, { recursive: true, force: true }); }
}

export async function compareSlotModel(consumer: string, old?: OldStores): Promise<CompareDiff[]> {
  const stores = old ?? await readOldStores(consumer);
  const diffs: CompareDiff[] = [];
  const sink = (agent: SlotAgent) => (message: string) => diffs.push({ agent, code: `compare-${agent}`, message });
  if (existsSync(iaPath(consumer, "director"))) compareDirector(consumer, stores, sink("director"));
  if (existsSync(iaPath(consumer, "designer"))) await compareDesigner(consumer, stores, sink("designer"));
  if (existsSync(iaPath(consumer, "writer"))) compareWriter(consumer, stores, sink("writer"));
  if (existsSync(iaPath(consumer, "publisher"))) await comparePublisher(consumer, stores, sink("publisher"));
  return diffs;
}

// ---------------- coverage + readiness ----------------
export interface AgentCoverage { readonly agent: SlotAgent; readonly slots: number; readonly withCandidate: number; readonly pinned: number; readonly inputsUndeclared: number; readonly blocked: readonly { slot: string; readiness: Readiness }[] }
export function slotCoverage(consumer: string): AgentCoverage[] {
  const index = slotIndex(consumer);
  return SLOT_AGENTS.filter(agent => existsSync(iaPath(consumer, agent))).map(agent => {
    const entries = listSlots(consumer, agent);
    const blocked: { slot: string; readiness: Readiness }[] = [];
    let undeclared = 0;
    for (const entry of entries) {
      if (!existsSync(join(entry.dir, SLOT_FILE))) continue;
      const ready = readiness(consumer, agent, entry.id, index);
      if (ready.blockedBy.some(row => row.reason === "inputs-undeclared")) undeclared++;
      if (!ready.ready) blocked.push({ slot: entry.id, readiness: ready });
    }
    return { agent, slots: entries.length, withCandidate: entries.filter(entry => entry.candidates.length).length, pinned: entries.filter(entry => entry.pin).length, inputsUndeclared: undeclared, blocked };
  });
}

export function formatCoverage(rows: readonly AgentCoverage[], withReadiness: boolean): string {
  const lines = rows.map(row => `${row.agent}: ${row.slots} slots / ${row.withCandidate} with candidate / ${row.pinned} pinned; inputs-undeclared ${row.inputsUndeclared}`);
  if (withReadiness) for (const row of rows) {
    const blockers = new Map<string, number>();
    for (const { readiness: ready } of row.blocked) for (const by of ready.blockedBy) if (by.reason !== "inputs-undeclared") blockers.set(`${by.slot} (${by.reason})`, (blockers.get(`${by.slot} (${by.reason})`) ?? 0) + 1);
    const top = [...blockers].sort((a, b) => b[1] - a[1] || cmp(a[0], b[0]));
    lines.push(`${row.agent} blocked-by: ${top.length ? top.map(([slot, count]) => `${slot} x${count}`).join(", ") : "none"}`);
  }
  return lines.join("\n");
}
