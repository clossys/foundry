/** IA-first Studio gallery data. Empty slots never depend on a candidate or a route. */
import { hasAgentModel, hasPinFile as hasPinRecord, listSlots, readCandidate, readIa, readSlot, readSlotEntry, type SlotEntry } from '../records/slots.js';
import { type IaDoc, type NotNeeded, parseFrontmatter, validateCandidate, validateSlotDoc, type SlotAgent, type SlotKind, type SlotStateRejection } from '../records/slot-model/index.js';
import { parseWriterSlotBody } from '@clossys/writer/slot-body';
import { iaLabel, slotLabel, slotLabels } from '../records/slot-labels.js';
import { copyRef, type CopyText } from './copy-ref.js';
import { parseJson } from '../errors.js';

/** Why a slot card has nothing to show: an id Studio maps to Writer copy. */
export type SlotEmptyState = 'no-candidate' | 'no-pin';
export interface RecordSpecimenInput {
  /** `title` and `empty` are Writer copy references; Studio resolves them where it loads the detail. */
  kind: 'record'; name: string; title: CopyText; description: string; empty: CopyText;
  rows: { key: string; label: string; text: string }[];
}
export interface SlotGalleryCard {
  id: string; slug: string; name: string; version: number; kind: SlotKind;
  status: 'active' | 'draft' | 'missing' | 'failing'; records: number;
  candidate?: string; element?: string; specimen?: string; emptyState?: SlotEmptyState; excerpt: string[];
  /** Candidate files on disk (the "N options" state of an unpinned slot). */
  options: number;
  /** The loader's slot state: pinned, not-needed, or rejected (an error state). */
  state: SlotCardState;
}
export type SlotCardState = { state: 'pinned' } | { state: 'not-needed'; notNeeded: NotNeeded } | { state: 'rejected'; reason: SlotStateRejection };
/** The loader's decision, without the pin body (cards carry the candidate and version already). */
export function cardState(entry: SlotEntry): SlotCardState {
  const state = entry.state;
  return state.state === 'pinned' ? { state: 'pinned' } : state.state === 'not-needed' ? { state: 'not-needed', notNeeded: state.notNeeded } : { state: 'rejected', reason: state.reason };
}
export interface SlotGallerySection { id: string; label: string; level: 0 | 1 | 2; cards: SlotGalleryCard[] }
export const candidateVersion = (name: string) => Number(/-v(\d+)\.(?:md|json)$/.exec(name)?.[1] ?? 0);
export const hasAgentSlots = (consumer: string, agent: SlotAgent) => hasAgentModel(consumer, agent);

const hasPinFile = (entry: SlotEntry) => hasPinRecord(entry.dir);

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
  const entry = readSlotEntry(consumer, agent, id);
  if (!entry) return undefined;
  if (!entry.pin && hasPinFile(entry)) return undefined;
  // A Director card shows its pin; a named Director candidate renders as a preview of its own bytes.
  const name = agent === 'director' ? candidate ?? entry.pin?.candidate : candidate ?? shownCandidate(entry);
  if (agent === 'director' && !name) return undefined;
  // An unreadable or invalid slot document is an error for the caller, not an absent record.
  const doc = checkedSlot(consumer, agent, entry);
  const empty = copyRef(entry.candidates.length ? 'studio.no-pin' : 'studio.no-candidate');
  const out: RecordSpecimenInput = { kind: 'record', name: slotLabel(consumer, agent, id), title: copyRef(agent === 'director' ? 'studio.direction' : 'studio.strings'), description: '', empty, rows: [] };
  if (!name) return out;
  if (!entry.candidates.includes(name)) return undefined;
  let source;
  try { source = readCandidate(consumer, agent, id, name); } catch (error) {
    if (agent === 'director') return undefined;
    throw error;
  }
  if (validateCandidate(doc.kind, id, name, source.bytes).length) return undefined;
  if (agent === 'director' && entry.pin?.candidate === name && source.sha256 !== entry.pin.sha256) return undefined;
  if (entry.pin?.candidate === name && source.sha256 !== entry.pin.sha256) throw new Error(`Candidate hash mismatch: ${id}`);
  const parsed = parseFrontmatter(source.bytes);
  if (!parsed.ok) throw new Error(`Invalid record candidate: ${id}`);
  if (agent === 'writer') {
    out.rows = parseWriterSlotBody(parsed.value.body, parsed.value.fields.locales as readonly string[]).map((row, index) => ({
      // A row's label is its Writer record key, `<locale>/<context>`, as the detail's Key column shows it.
      key: `${index}`, label: `${row.locale}/${row.record.context}`,
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
/**
 * A structured row (a JSON rule or entry) reads as its value, not as its serialization: a format or
 * voice rule's value, a term, a pattern, a narrative's title, or a claim's first phrasing.
 */
function readable(text: string): string {
  if (!/^\s*\{/.test(text)) return text;
  // Plain text that starts with a brace is not JSON and reads as itself.
  const parsed = parseJson(text);
  const value = parsed.ok && parsed.value && typeof parsed.value === 'object' ? parsed.value as Record<string, unknown> : undefined;
  if (value) for (const key of ['value', 'text', 'description', 'rule', 'term', 'pattern', 'title']) if (typeof value[key] === 'string' && value[key]) return value[key] as string;
  const phrasing = Array.isArray(value?.phrasings) ? value.phrasings.find(entry => typeof entry === 'string' && entry) : undefined;
  return typeof phrasing === 'string' ? phrasing : text;
}

export function recordLead(input: RecordSpecimenInput | undefined, rows = 2, length = 220): string[] {
  return (input?.rows ?? []).slice(0, rows).map(row => {
    const text = readable(row.text).split('\n').map(line => line.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '').trim()).filter(Boolean).join(' ')
      .replace(/\*\*|__|`/g, '').replace(/\s+/g, ' ').trim();
    if (text.length <= length) return text;
    // Cut at a word boundary so a lead never ends inside a word, a citation or an id.
    const cut = text.slice(0, length - 1), space = cut.lastIndexOf(' ');
    return `${(space > 0 ? cut.slice(0, space) : cut).trimEnd()}…`;
  }).filter(Boolean);
}

/**
 * L1/L2 display order. Without `layers` it is the IA order with L0 from the
 * slot position; with `layers` each layer is a tab and an `<l1>/<l2>` ref
 * shows one L2 group as its own L1 (display only, folders never move).
 */
function displayOrder(consumer: string, ia: IaDoc, agent: SlotAgent) {
  const rows: { layer?: { id: string; label: string }; l1: { id: string; label: string }; group: IaDoc['nodes'][number]['children'][number] }[] = [];
  if (!ia.layers) {
    for (const node of ia.nodes) for (const group of node.children) rows.push({ l1: { id: node.id, label: iaLabel(consumer, agent, node.id) }, group });
    return rows;
  }
  const nodes = new Map(ia.nodes.map(node => [node.id, node]));
  for (const layer of ia.layers) for (const ref of layer.nodes) {
    const [l1 = '', l2] = ref.split('/');
    const node = nodes.get(l1);
    if (!node) throw new Error(`Invalid ${agent} IA layer: ${ref}`);
    const named = { id: layer.id, label: iaLabel(consumer, agent, layer.id) };
    if (l2 === undefined) for (const group of node.children) rows.push({ layer: named, l1: { id: node.id, label: iaLabel(consumer, agent, node.id) }, group });
    else {
      const group = node.children.find(child => child.id === l2);
      if (!group) throw new Error(`Invalid ${agent} IA layer: ${ref}`);
      rows.push({ layer: named, l1: { id: ref, label: iaLabel(consumer, agent, group.id) }, group });
    }
  }
  return rows;
}

/** One card per IA entry in exactly the IA order, even when slot.json is absent. */
export function slotGallery(consumer: string, agent: SlotAgent): { sections: SlotGallerySection[]; count: number } {
  const ia = readIa(consumer, agent);
  if (!ia) return { sections: [], count: 0 };
  const entries = new Map(listSlots(consumer, agent).map(entry => [entry.id, entry]));
  const label = slotLabels(consumer);
  const sections: SlotGallerySection[] = [];
  const section = (id: string, text: string, level: 0 | 1 | 2) => {
    let row = sections.find(row => row.id === id && row.level === level);
    if (!row) { row = { id, label: text, level, cards: [] }; sections.push(row); }
    return row;
  };
  for (const { layer, l1, group } of displayOrder(consumer, ia, agent)) for (const id of group.slots) {
    const entry = entries.get(id)!;
    const l0 = layer ?? { id: entry.position.l0 ?? agent, label: iaLabel(consumer, agent, entry.position.l0 ?? agent) };
    section(l0.id, l0.label, 0);
    section(l1.id, l1.label, 1);
    const target = section(`${l1.id}/${group.id}`, iaLabel(consumer, agent, group.id), 2);
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
    // A card shows the pin only; previews of other candidates live on the slot's detail route.
    if (!failing && ((agent === 'director' && entry.pin && (candidate === undefined || candidate === entry.pin.candidate)) || (agent === 'writer' && candidate && entry.pin?.candidate === candidate))) {
      // A record that cannot be projected marks the card failing instead of showing an empty lead.
      try { record = recordSpecimenInput(consumer, agent, id, candidate); } catch { failing = true; record = undefined; }
    }
    target.cards.push({ id, slug: id, name: label(agent, id), kind, version: candidate ? candidateVersion(candidate) : 0,
      status: failing ? 'failing' : missing ? 'missing' : entry.pin ? 'active' : 'draft', records: candidate && !failing ? 1 : 0,
      excerpt: recordLead(record), options: entry.candidates.length, state: cardState(entry), ...(candidate ? { candidate } : {}), ...(element ? { element, specimen: `${id}/${element}` } : {}), ...(!failing && (missing || !entry.pin) ? { emptyState: missing ? 'no-candidate' as const : 'no-pin' as const } : {}),
    });
  }
  return { sections, count: sections.reduce((n, row) => n + row.cards.length, 0) };
}
