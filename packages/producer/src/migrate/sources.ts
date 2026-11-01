/**
 * Old-store readers for `clossys migrate slots` (F4). Every reader is read-only;
 * old stores stay untouched until F8 deletes them.
 */
import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { agentModule } from "../server/cells.js";
import { validateSlotContract } from "../records/validate.js";
import type { SlotContract } from "../records/types.js";

export interface OldCell {
  readonly id: string;
  readonly version: number;
  readonly status: "draft" | "active" | "retired";
  readonly fields: Readonly<Record<string, unknown>>;
  /** Body text after the frontmatter, byte-for-byte. */
  readonly body: string;
  readonly source: string;
}
export interface OldTree { readonly raw: Record<string, any>; readonly active: Readonly<Record<string, number | null>> }
export interface OldStore { readonly root: string; readonly tree: OldTree; readonly cells: readonly OldCell[] }

const isDir = (path: string) => { try { const stat = lstatSync(path); return stat.isDirectory() && !stat.isSymbolicLink(); } catch { return false; } };
export const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
export const readJsonFile = (path: string): any => JSON.parse(readFileSync(path, "utf8"));

/** Legacy consumer contracts supply facts, never permission to extend the IA. */
export function readDesignerContracts(consumer: string): ReadonlyMap<string, SlotContract> {
  const root = join(consumer, "agents/designer/slot-contracts");
  const contracts = new Map<string, SlotContract>();
  if (!isDir(root)) return contracts;
  for (const name of readdirSync(root).sort()) {
    if (!name.endsWith(".json")) continue;
    const raw: unknown = readJsonFile(join(root, name));
    for (const value of Array.isArray(raw) ? raw : [raw]) {
      const checked = validateSlotContract(value);
      if (!checked.ok) throw new Error(`invalid Designer contract in ${name}`);
      if (contracts.has(checked.value.slot)) throw new Error(`duplicate Designer contract for ${checked.value.slot}`);
      contracts.set(checked.value.slot, checked.value);
    }
  }
  return contracts;
}

function bodyOf(source: string): string {
  const lines = source.split("\n");
  const close = lines.indexOf("---", 1);
  return lines.slice(close + 1).join("\n");
}

/** One cell-format store (`tree.json` + `cells/<id>/v<n>.md`); null when absent. */
export async function readOldStore(root: string): Promise<OldStore | null> {
  if (!existsSync(join(root, "tree.json"))) return null;
  const store = await agentModule("director", "cell-format/index.js");
  const raw = readJsonFile(join(root, "tree.json"));
  const cells: OldCell[] = isDir(join(root, "cells"))
    ? (await store.listCells(root) as { id: string; version: number; status: OldCell["status"]; source: string; document: { fields: Record<string, unknown> } }[])
      .map(cell => ({ id: cell.id, version: cell.version, status: cell.status, fields: cell.document.fields, source: cell.source, body: bodyOf(cell.source) }))
    : [];
  return { root, tree: { raw, active: (raw.active ?? {}) as Record<string, number | null> }, cells };
}

/** Writer record inside a cell body: `## locale`, `### key`, `<!-- meta -->`, text. */
export interface WriterRecord { readonly locale: string; readonly key: string; readonly meta: Record<string, unknown>; readonly text: string }
export function writerRecords(body: string): WriterRecord[] {
  const lines = body.split("\n"), out: WriterRecord[] = [];
  let locale = "";
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.startsWith("## ")) { locale = line.slice(3).trim(); continue; }
    if (!line.startsWith("### ")) continue;
    const key = line.slice(4).trim();
    const meta = /^<!-- (.+) -->$/.exec(lines[i + 1] ?? "");
    if (!meta) continue;
    i++;
    const text: string[] = [];
    while (i + 1 < lines.length && !lines[i + 1]!.startsWith("### ") && !lines[i + 1]!.startsWith("## ")) text.push(lines[++i]!);
    while (text.length && !text[text.length - 1]!.trim()) text.pop();
    out.push({ locale, key, meta: JSON.parse(meta[1]!) as Record<string, unknown>, text: text.join("\n") });
  }
  return out;
}

/** Designer library version: `library/<slot>/<element>/v<n>/{element.json, preview.json, payload}`. */
export interface LibraryVersion {
  readonly slot: string; readonly element: string; readonly version: number; readonly dir: string;
  readonly record: Record<string, any>; readonly preview: Record<string, any> | null;
  readonly payload: readonly { path: string; content: string }[];
}
export function readLibrary(libraryRoot: string): LibraryVersion[] {
  if (!isDir(libraryRoot)) return [];
  const out: LibraryVersion[] = [];
  for (const slot of readdirSync(libraryRoot).sort()) {
    if (!isDir(join(libraryRoot, slot))) continue;
    for (const element of readdirSync(join(libraryRoot, slot)).sort()) {
      if (!isDir(join(libraryRoot, slot, element))) continue;
      for (const name of readdirSync(join(libraryRoot, slot, element)).sort()) {
        const match = /^v([1-9]\d*)$/.exec(name);
        const dir = join(libraryRoot, slot, element, name);
        if (!match || !existsSync(join(dir, "element.json"))) continue;
        const record = readJsonFile(join(dir, "element.json"));
        const payload = (Array.isArray(record.payload) ? record.payload as string[] : []).map(path => ({ path, content: readFileSync(join(dir, path), "utf8") }));
        out.push({ slot, element, version: Number(match[1]), dir, record, preview: existsSync(join(dir, "preview.json")) ? readJsonFile(join(dir, "preview.json")) : null, payload });
      }
    }
  }
  return out.sort((a, b) => cmp(a.slot, b.slot) || cmp(a.element, b.element) || a.version - b.version);
}
