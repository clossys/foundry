/** IA-first Studio gallery data. Empty slots never depend on a candidate or a route. */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { listSlots, readCandidate, readIa, readSlot, type SlotEntry } from '../records/slots.js';
import { iaPath, parseFrontmatter, type SlotAgent, type SlotKind } from '../records/slot-model/index.js';
import { writerRecords } from '../migrate/sources.js';

export type SlotEmptyState = 'No candidate' | 'No pin';
export interface RecordSpecimenInput {
  kind: 'record'; name: string; title: string; description: string; empty: string;
  rows: { key: string; label: string; text: string }[];
}
export interface SlotGalleryCard {
  id: string; slug: string; name: string; version: number; kind: SlotKind;
  status: 'active' | 'draft' | 'missing' | 'failing'; records: number;
  candidate?: string; element?: string; specimen?: string; emptyState?: SlotEmptyState; excerpt: string[];
  specimenUrl?: string;
}
export interface SlotGallerySection { id: string; label: string; level: 0 | 1 | 2; cards: SlotGalleryCard[] }
export const candidateVersion = (name: string) => Number(/-v(\d+)\.(?:md|json)$/.exec(name)?.[1] ?? 0);
export const hasAgentSlots = (consumer: string, agent: SlotAgent) => existsSync(iaPath(consumer, agent));
const label = (id: string) => id.replace(/[.-]/g, ' ').replace(/^\w/, c => c.toUpperCase());

/** The pin wins; an invalid pin never silently falls back to a newer candidate. */
export function shownCandidate(entry: SlotEntry): string | undefined {
  return entry.pin ? (entry.candidates.includes(entry.pin.candidate) ? entry.pin.candidate : undefined) : entry.candidates.at(-1);
}

/** Director brief and Writer strings -> the existing Studio specimen component's input. */
export function recordSpecimenInput(consumer: string, agent: 'director' | 'writer', id: string, candidate?: string): RecordSpecimenInput | undefined {
  const entry = listSlots(consumer, agent).find(row => row.id === id);
  if (!entry) return undefined;
  const name = candidate ?? shownCandidate(entry);
  const empty = entry.candidates.length ? 'No pin' : 'No candidate';
  const out: RecordSpecimenInput = { kind: 'record', name: id, title: agent === 'director' ? 'Direction' : 'Strings', description: '', empty, rows: [] };
  if (!name) return out;
  if (!entry.candidates.includes(name)) return undefined;
  const source = readCandidate(consumer, agent, id, name);
  if (entry.pin?.candidate === name && source.sha256 !== entry.pin.sha256) throw new Error(`Candidate hash mismatch: ${id}`);
  const parsed = parseFrontmatter(source.bytes);
  if (!parsed.ok) throw new Error(`Invalid record candidate: ${id}`);
  if (agent === 'writer') {
    out.rows = writerRecords(parsed.value.body).map((row, index) => ({ key: `${index}`, label: `${row.locale}: ${row.key}`, text: row.text || JSON.stringify(row.meta) }));
  } else {
    const sections = parsed.value.body.split(/^## /m).slice(1);
    out.rows = sections.map((section, index) => { const newline = section.indexOf('\n'); return { key: `${index}`, label: newline < 0 ? section : section.slice(0, newline), text: newline < 0 ? '' : section.slice(newline + 1).trim() }; });
  }
  return out;
}

export function recordSpecimenHref(agent: 'director' | 'writer', id: string, candidate?: string): string {
  return `/__specimen?${new URLSearchParams({ agent, slot: id, ...(candidate ? { candidate } : {}) })}`;
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
  for (const node of ia.nodes) for (const group of node.children) for (const id of group.slots) {
    const entry = entries.get(id)!;
    const layer = entry.position.l0 ?? agent;
    section(layer, label(layer), 0);
    section(node.id, node.label, 1);
    const target = section(`${node.id}/${group.id}`, group.label, 2);
    const candidate = shownCandidate(entry);
    const missing = !entry.candidates.length;
    let kind: SlotKind = agent === 'director' ? 'brief' : agent === 'writer' ? 'strings' : agent === 'designer' ? 'element' : 'page';
    let failing = !!entry.pin && !candidate;
    try { kind = readSlot(consumer, agent, id).kind; } catch { failing = true; }
    if (candidate && entry.pin && readCandidate(consumer, agent, id, candidate).sha256 !== entry.pin.sha256) failing = true;
    let element: string | undefined;
    if (!failing && candidate && agent === 'designer') {
      const item = JSON.parse(readCandidate(consumer, agent, id, candidate).bytes);
      if (typeof item.name === 'string') element = item.name;
    }
    target.cards.push({ id, slug: id, name: label(id), kind, version: candidate ? candidateVersion(candidate) : 0,
      status: failing ? 'failing' : missing ? 'missing' : entry.pin ? 'active' : 'draft', records: candidate && !failing ? 1 : 0,
      excerpt: [], ...(candidate ? { candidate } : {}), ...(element ? { element, specimen: `${id}/${element}` } : {}), ...(missing || !entry.pin ? { emptyState: missing ? 'No candidate' as const : 'No pin' as const } : {}),
      ...(!failing && (agent === 'director' || agent === 'writer') ? { specimenUrl: recordSpecimenHref(agent, id, candidate) } : {}),
    });
  }
  return { sections, count: sections.reduce((n, row) => n + row.cards.length, 0) };
}
