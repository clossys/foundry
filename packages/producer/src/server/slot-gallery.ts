/** IA-first Studio gallery data. Empty slots never depend on a candidate or a route. */
import { existsSync, lstatSync } from 'node:fs';
import { join } from 'node:path';
import { listSlots, readCandidate, readIa, readSlot, type SlotEntry } from '../records/slots.js';
import { iaPath, pinFile, type IaDoc, parseFrontmatter, validateCandidate, validateSlotDoc, type SlotAgent, type SlotKind } from '../records/slot-model/index.js';
import { parseWriterSlotBody } from '@clossys/writer/slot-body';

export type SlotEmptyState = 'No candidate' | 'No pin';
export interface RecordSpecimenInput {
  kind: 'record'; name: string; title: string; description: string; empty: string;
  rows: { key: string; label: string; text: string }[];
}
export interface SlotGalleryCard {
  id: string; slug: string; name: string; version: number; kind: SlotKind;
  status: 'active' | 'draft' | 'missing' | 'failing'; records: number;
  candidate?: string; element?: string; specimen?: string; emptyState?: SlotEmptyState; excerpt: string[];
  /** Candidate files on disk (the "N options" state of an unpinned slot). */
  options: number;
}
export interface SlotGallerySection { id: string; label: string; level: 0 | 1 | 2; cards: SlotGalleryCard[] }
export const candidateVersion = (name: string) => Number(/-v(\d+)\.(?:md|json)$/.exec(name)?.[1] ?? 0);
export const hasAgentSlots = (consumer: string, agent: SlotAgent) => existsSync(iaPath(consumer, agent));
const label = (id: string) => id.replace(/[.-]/g, ' ').replace(/^\w/, c => c.toUpperCase());

function hasPinFile(entry: SlotEntry): boolean {
  try { lstatSync(pinFile(entry.dir)); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
}

function checkedSlot(consumer: string, agent: SlotAgent, entry: SlotEntry) {
  const doc = readSlot(consumer, agent, entry.id);
  if (validateSlotDoc(doc).length || doc.id !== entry.id || doc.agent !== agent
    || doc.ia.l0 !== entry.position.l0 || doc.ia.l1 !== entry.position.l1 || doc.ia.l2 !== entry.position.l2 || doc.ia.order !== entry.position.order) {
    throw new Error(`Invalid slot: ${entry.id}`);
  }
  return doc;
}

/** The pin wins; an invalid pin never silently falls back to a newer candidate. */
export function shownCandidate(entry: SlotEntry): string | undefined {
  return entry.pin ? (entry.candidates.includes(entry.pin.candidate) ? entry.pin.candidate : undefined) : hasPinFile(entry) ? undefined : entry.candidates.at(-1);
}

/** Director brief and Writer strings -> the existing Studio specimen component's input. */
export function recordSpecimenInput(consumer: string, agent: 'director' | 'writer', id: string, candidate?: string): RecordSpecimenInput | undefined {
  const entry = listSlots(consumer, agent).find(row => row.id === id);
  if (!entry) return undefined;
  if (!entry.pin && hasPinFile(entry)) return undefined;
  const name = agent === 'director' ? entry.pin?.candidate : candidate ?? shownCandidate(entry);
  if (agent === 'director' && (!name || (candidate !== undefined && candidate !== name))) return undefined;
  let doc: ReturnType<typeof checkedSlot>;
  try { doc = checkedSlot(consumer, agent, entry); } catch { return undefined; }
  const empty = entry.candidates.length ? 'No pin' : 'No candidate';
  const out: RecordSpecimenInput = { kind: 'record', name: id, title: agent === 'director' ? 'Direction' : 'Strings', description: '', empty, rows: [] };
  if (!name) return out;
  if (!entry.candidates.includes(name)) return undefined;
  let source;
  try { source = readCandidate(consumer, agent, id, name); } catch (error) {
    if (agent === 'director') return undefined;
    throw error;
  }
  try {
    if (validateCandidate(doc.kind, id, name, source.bytes).length) return undefined;
    if (agent === 'director' && source.sha256 !== entry.pin!.sha256) return undefined;
  } catch { return undefined; }
  if (entry.pin?.candidate === name && source.sha256 !== entry.pin.sha256) throw new Error(`Candidate hash mismatch: ${id}`);
  const parsed = parseFrontmatter(source.bytes);
  if (!parsed.ok) throw new Error(`Invalid record candidate: ${id}`);
  if (agent === 'writer') {
    out.rows = parseWriterSlotBody(parsed.value.body, parsed.value.fields.locales as readonly string[]).map((row, index) => ({
      key: `${index}`, label: `${row.locale}: ${row.record.context}`,
      text: typeof row.record.text === 'string' ? row.record.text : JSON.stringify(row.record),
    }));
  } else {
    const sections = parsed.value.body.split(/^## /m).slice(1);
    out.rows = sections.map((section, index) => { const newline = section.indexOf('\n'); return { key: `${index}`, label: newline < 0 ? section : section.slice(0, newline), text: newline < 0 ? '' : section.slice(newline + 1).trim() }; });
  }
  return out;
}

/**
 * A record card's lead: the first rows' text as plain sentences, so a gallery card reads at card
 * size without framing the record page (the L3 route keeps the full-width render).
 */
/** A structured row (a JSON rule or entry) reads as its value, not as its serialization. */
function readable(text: string): string {
  if (!/^\s*\{/.test(text)) return text;
  try {
    const value = JSON.parse(text) as Record<string, unknown>;
    for (const key of ['value', 'text', 'description', 'rule']) if (typeof value[key] === 'string' && value[key]) return value[key] as string;
  } catch { /* plain text that starts with a brace */ }
  return text;
}

export function recordLead(input: RecordSpecimenInput | undefined, rows = 2, length = 220): string[] {
  return (input?.rows ?? []).slice(0, rows).map(row => {
    const text = readable(row.text).split('\n').map(line => line.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '').trim()).filter(Boolean).join(' ')
      .replace(/\*\*|__|`/g, '').replace(/\s+/g, ' ').trim();
    return text.length > length ? `${text.slice(0, length - 1).trimEnd()}…` : text;
  }).filter(Boolean);
}

/**
 * L1/L2 display order. Without `layers` it is the IA order with L0 from the
 * slot position; with `layers` each layer is a tab and an `<l1>/<l2>` ref
 * shows one L2 group as its own L1 (display only, folders never move).
 */
function displayOrder(ia: IaDoc, agent: SlotAgent) {
  const rows: { layer?: { id: string; label: string }; l1: { id: string; label: string }; group: IaDoc['nodes'][number]['children'][number] }[] = [];
  if (!ia.layers) {
    for (const node of ia.nodes) for (const group of node.children) rows.push({ l1: node, group });
    return rows;
  }
  const nodes = new Map(ia.nodes.map(node => [node.id, node]));
  for (const layer of ia.layers) for (const ref of layer.nodes) {
    const [l1 = '', l2] = ref.split('/');
    const node = nodes.get(l1);
    if (!node) throw new Error(`Invalid ${agent} IA layer: ${ref}`);
    if (l2 === undefined) for (const group of node.children) rows.push({ layer, l1: node, group });
    else {
      const group = node.children.find(child => child.id === l2);
      if (!group) throw new Error(`Invalid ${agent} IA layer: ${ref}`);
      rows.push({ layer, l1: { id: ref, label: group.label }, group });
    }
  }
  return rows;
}

/** One card per IA entry in exactly the IA order, even when slot.json is absent. */
export function slotGallery(consumer: string, agent: SlotAgent): { sections: SlotGallerySection[]; count: number } {
  const ia = readIa(consumer, agent);
  if (!ia) return { sections: [], count: 0 };
  const entries = new Map(listSlots(consumer, agent).map(entry => [entry.id, entry]));
  const sections: SlotGallerySection[] = [];
  const section = (id: string, text: string, level: 0 | 1 | 2) => {
    let row = sections.find(row => row.id === id && row.level === level);
    if (!row) { row = { id, label: text, level, cards: [] }; sections.push(row); }
    return row;
  };
  for (const { layer, l1, group } of displayOrder(ia, agent)) for (const id of group.slots) {
    const entry = entries.get(id)!;
    const l0 = layer ?? { id: entry.position.l0 ?? agent, label: label(entry.position.l0 ?? agent) };
    section(l0.id, l0.label, 0);
    section(l1.id, l1.label, 1);
    const target = section(`${l1.id}/${group.id}`, group.label, 2);
    const candidate = shownCandidate(entry);
    const missing = !entry.candidates.length;
    let kind: SlotKind = agent === 'director' ? 'brief' : agent === 'writer' ? 'strings' : agent === 'designer' ? 'element' : 'page';
    const pinPresent = hasPinFile(entry);
    let failing = pinPresent && (!entry.pin || !candidate);
    let element: string | undefined;
    try {
      kind = checkedSlot(consumer, agent, entry).kind;
      if (candidate) {
        const source = readCandidate(consumer, agent, id, candidate);
        if (validateCandidate(kind, id, candidate, source.bytes).length || (entry.pin && source.sha256 !== entry.pin.sha256)) failing = true;
        if (!failing && agent === 'writer') {
          const parsed = parseFrontmatter(source.bytes);
          if (!parsed.ok) failing = true;
          else parseWriterSlotBody(parsed.value.body, parsed.value.fields.locales as readonly string[]);
        }
        if (!failing && agent === 'designer') {
          const item = JSON.parse(source.bytes);
          const name = candidate.replace(/-v\d+\.json$/, '');
          if (item.name !== name || (item.meta?.element?.id !== undefined && item.meta.element.id !== name)
            || (item.meta?.element?.slot !== undefined && item.meta.element.slot !== id)) failing = true;
        }
      }
      if (!failing && candidate && agent === 'designer' && entry.pin?.candidate === candidate) {
        const item = JSON.parse(readCandidate(consumer, agent, id, candidate).bytes);
        if (typeof item.name === 'string') element = item.name;
      }
    } catch { failing = true; }
    let record: RecordSpecimenInput | undefined;
    if (!failing && (agent === 'director' || (agent === 'writer' && candidate && entry.pin?.candidate === candidate))) {
      try { record = recordSpecimenInput(consumer, agent, id, candidate); } catch { record = undefined; }
    }
    target.cards.push({ id, slug: id, name: label(id), kind, version: candidate ? candidateVersion(candidate) : 0,
      status: failing ? 'failing' : missing ? 'missing' : entry.pin ? 'active' : 'draft', records: candidate && !failing ? 1 : 0,
      excerpt: recordLead(record), options: entry.candidates.length, ...(candidate ? { candidate } : {}), ...(element ? { element, specimen: `${id}/${element}` } : {}), ...(!failing && (missing || !entry.pin) ? { emptyState: missing ? 'No candidate' as const : 'No pin' as const } : {}),
    });
  }
  return { sections, count: sections.reduce((n, row) => n + row.cards.length, 0) };
}
