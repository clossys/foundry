/**
 * The `clossys render` driver (system.md 12.4, 14.3): any candidate from any agent rendered as a
 * specimen, one candidate beside another (`--compare`), and the `clossys.render/1` result.
 *
 * Designer element candidates render to PNG through the specimen harness (thumbnails.ts), cached
 * by (candidate sha256, dependency pin-set hash, theme, width): the int2 key, unchanged. Director,
 * Writer, Publisher and Producer candidates render as text specimens (HTML): no model, no pin, no
 * network. Every render is written under `.clossys/renders/<agent>/<slot-id>/<candidate>/` with
 * its `index.json`; a compare is written under `.clossys/renders/compare/<a>--<b>/` with one
 * side-by-side `compare.html`.
 *
 * `--draft <file>` (Designer craft rung) renders an unsubmitted direction as the slot's next
 * candidate from a temporary copy of the consumer's records; the consumer's records are never
 * written, and the render lands under `.clossys/renders/`, never in the candidate folder.
 *
 * Until each agent's `src/specimens.ts` exists (after the landing bar), the specimen kinds live here.
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { copyFile, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { basename, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { pinSetHash, type PinSetEntry } from "../constitution/rules/r12.js";
import { readCandidate, readSlot, readSlotEntry, slotIndex, type SlotEntry } from "../records/slots.js";
import { CANDIDATE_NAME, MODEL_AGENTS, parseFrontmatter, type ModelAgent } from "../records/slot-model/index.js";
import { nextVersion, withDraftOverlay } from "../records/slot-write.js";
import type { RenderIndex } from "../records/types.js";
import { snapshotSpecimen, type SnapshotOptions, type SnapshotResult } from "./thumbnails.js";

/** A refusal of the caller's input (exit 2 at the CLI). */
export class RenderUsageError extends Error {
  constructor(message: string) { super(message); this.name = "RenderUsageError"; }
}

export const DEFAULT_RENDER_CACHE = join("node_modules", ".cache", "clossys", "render");
export const DEFAULT_RENDER_WIDTHS = [480] as const;
/** Bumped when what a cached render records changes. Part of the cache key: do not change. */
export const RENDER_CACHE_VERSION = "clossys.render/1";
/** Where every render is written, under the consumer root (system.md 12.4). */
export const RENDERS_DIR = join(".clossys", "renders");

// clossys.render/1 (system.md 12.4): the 0001 record type and schemas/render.json.
export type { RenderIndex } from "../records/types.js";
export type RenderSpecimenRow = RenderIndex["specimens"][number];
/** The specimen name of a compare's side-by-side file (`compare.html`), one row of the result. */
export const COMPARE_SPECIMEN = "compare";

const PRODUCER_VERSION = (() => {
  try { return (JSON.parse(readFileSync(fileURLToPath(new URL("../../package.json", import.meta.url)), "utf8")) as { version?: string }).version ?? "0.0.0"; } catch { return "0.0.0"; }
})();
const sha256 = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");
const exists = (path: string) => stat(path).then(() => true, () => false);
async function writeAtomic(path: string, data: string | Buffer) {
  const temp = `${path}.${process.pid}.tmp`;
  await writeFile(temp, data);
  await rename(temp, path);
}
const posix = (path: string) => path.split(sep).join("/");
const stemOf = (candidate: string) => candidate.replace(/\.(md|json)$/, "");

// ---------------------------------------------------------------------------------------------
// Designer: the int2 cached image render (key unchanged).

/** The dependency pin set of one slot: every transitive `inputs` ∪ `uses` slot and its pinned sha256, sorted. */
export function dependencyPins(consumer: string, slot: string, index: ReadonlyMap<string, SlotEntry> = slotIndex(consumer)): { entries: PinSetEntry[]; unresolved: string[] } {
  const seen = new Set<string>(), unresolved = new Set<string>(), entries: PinSetEntry[] = [];
  const depsOf = (id: string): readonly string[] | undefined => {
    const entry = index.get(id);
    if (!entry) return undefined;
    try { const doc = readSlot(consumer, entry.agent, id); return [...doc.inputs, ...(doc.uses ?? [])]; } catch (error) { unresolved.add(`${id} (slot.json unreadable: ${error instanceof Error ? error.message : String(error)})`); return []; }
  };
  const visit = (id: string) => {
    for (const dep of depsOf(id) ?? []) {
      if (seen.has(dep) || dep === slot) continue;
      seen.add(dep);
      const entry = index.get(dep);
      if (!entry) { unresolved.add(`${dep} (no such slot)`); continue; }
      if (!entry.pin?.sha256) { unresolved.add(`${dep} (unpinned)`); continue; }
      entries.push({ slot: dep, sha256: entry.pin.sha256 });
      visit(dep);
    }
  };
  if (!index.has(slot)) throw new Error(`slot ${slot} is not in any agent's IA`);
  visit(slot);
  entries.sort((a, b) => (a.slot < b.slot ? -1 : a.slot > b.slot ? 1 : 0));
  return { entries, unresolved: [...unresolved].sort() };
}

/** The render cache key: candidate sha256, dependency pin-set hash, theme and width. */
export function renderKey(input: { candidateSha: string; pinSetHash: string; theme: string; width: number }): string {
  return createHash("sha256").update([RENDER_CACHE_VERSION, input.candidateSha, input.pinSetHash, input.theme, String(input.width)].join("\0")).digest("hex").slice(0, 32);
}

export interface RenderedWidth { readonly width: number; readonly key: string; readonly path: string; readonly cached: boolean }
export interface RenderResult {
  readonly slot: string;
  readonly candidate: string;
  readonly sha256: string;
  readonly pinSetHash: string;
  readonly dependencies: readonly PinSetEntry[];
  readonly theme: string;
  readonly cache: string;
  readonly renders: readonly RenderedWidth[];
  /** Set for a `--draft` render: the draft file it rendered (the candidate name is the one a submit would take). */
  readonly draft?: string;
}
export type Snapshot = (options: SnapshotOptions) => Promise<SnapshotResult>;

/** Renders one Designer candidate (or reuses its cached render). `snapshot` is the specimen harness; tests inject it. */
export async function renderCandidate(options: {
  readonly root: string; readonly slot: string; readonly candidate?: string; readonly theme?: string;
  readonly widths?: readonly number[]; readonly cache?: string;
  /** A draft direction's JSON file: rendered as the slot's next candidate from a temporary copy. */
  readonly draft?: string;
  readonly snapshot?: Snapshot;
}): Promise<RenderResult> {
  const consumer = join(options.root, "clossys");
  const index = slotIndex(consumer);
  const entry = index.get(options.slot);
  if (!entry) throw new RenderUsageError(`slot ${options.slot} is not in any agent's IA`);
  if (entry.agent !== "designer") throw new RenderUsageError(`${entry.agent}/${options.slot}: the image render covers Designer element candidates; copy renders inside its pinned frame and section, and every ${entry.agent} candidate renders as a text specimen with clossys render ${entry.agent}/${options.slot}`);
  if (options.draft !== undefined) {
    if (options.candidate !== undefined) throw new RenderUsageError("--draft and a candidate name are separate calls");
    let item: unknown;
    try { item = JSON.parse(readFileSync(resolve(options.root, options.draft), "utf8")); } catch { throw new RenderUsageError(`cannot read the draft ${options.draft} as JSON`); }
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new RenderUsageError(`the draft ${options.draft} is not an element item (a JSON object)`);
    const stem = (item as { name?: unknown }).name;
    const candidate = typeof stem === "string" ? `${stem}-v${nextVersion(entry.dir, entry.candidates)}.json` : "";
    if (!CANDIDATE_NAME.test(candidate)) throw new RenderUsageError(`the draft ${options.draft} names no element (its name must be a candidate stem)`);
    // A temporary copy of the consumer's records with the draft as the slot's next candidate: the
    // consumer's records are never written, and the harness reads the draft as it reads any candidate.
    return withDraftOverlay(consumer, "designer", options.slot, candidate, item, async copy =>
      ({ ...await renderAt(copy, options.root, { ...options, candidate }, slotIndex(copy)), draft: options.draft }));
  }
  if (options.candidate === undefined) throw new RenderUsageError("render needs <candidate> or --draft <file>");
  return renderAt(consumer, options.root, { ...options, candidate: options.candidate }, index);
}

async function renderAt(consumer: string, root: string, options: {
  readonly slot: string; readonly candidate: string; readonly theme?: string; readonly widths?: readonly number[]; readonly cache?: string;
  readonly snapshot?: Snapshot;
}, index: ReadonlyMap<string, SlotEntry>): Promise<RenderResult> {
  const entry = index.get(options.slot)!;
  const name = CANDIDATE_NAME.exec(options.candidate);
  if (!name || name[3] !== "json") throw new RenderUsageError(`${options.candidate} is not an element candidate name (<element>-v<n>.json)`);
  if (!entry.candidates.includes(options.candidate)) throw new RenderUsageError(`${options.slot} has no candidate ${options.candidate}`);
  const { sha256: candidateSha } = readCandidate(consumer, "designer", options.slot, options.candidate);
  const deps = dependencyPins(consumer, options.slot, index);
  if (deps.unresolved.length) throw new Error(`${options.slot}: render needs every dependency pinned; unresolved: ${deps.unresolved.join(", ")}`);
  const hash = pinSetHash(deps.entries);
  const theme = options.theme ?? "light";
  const cache = resolve(root, options.cache ?? DEFAULT_RENDER_CACHE);
  const widths = [...new Set(options.widths?.length ? options.widths : DEFAULT_RENDER_WIDTHS)];
  await mkdir(cache, { recursive: true });
  const renders: RenderedWidth[] = [];
  const missing: { width: number; key: string; path: string }[] = [];
  for (const width of widths) {
    const key = renderKey({ candidateSha, pinSetHash: hash, theme, width });
    const path = join(cache, `${key}.png`);
    if (await exists(path)) renders.push({ width, key, path, cached: true });
    else missing.push({ width, key, path });
  }
  if (missing.length) {
    const snapshot = await (options.snapshot ?? snapshotSpecimen)({
      records: [consumer], element: `${options.slot}/${name[1]}`, version: Number(name[2]), theme,
      widths: missing.map(row => row.width), workspace: root, cwd: root,
    });
    for (const row of missing) {
      const thumb = snapshot.thumbnails.find(candidate => candidate.width === row.width);
      if (!thumb) throw new Error(`${options.slot}/${options.candidate}: the specimen harness rendered no ${row.width}px image`);
      await writeAtomic(row.path, await readFile(thumb.path));
      await writeAtomic(join(cache, `${row.key}.json`), `${JSON.stringify({ schema: RENDER_CACHE_VERSION, slot: options.slot, candidate: options.candidate, sha256: candidateSha, pinSetHash: hash, dependencies: deps.entries, theme, width: row.width, specimen: { key: thumb.key, path: thumb.path, health: thumb.health ?? null } }, null, 2)}\n`);
      renders.push({ width: row.width, key: row.key, path: row.path, cached: false });
    }
  }
  renders.sort((a, b) => a.width - b.width);
  return { slot: options.slot, candidate: options.candidate, sha256: candidateSha, pinSetHash: hash, dependencies: deps.entries, theme, cache, renders };
}

// ---------------------------------------------------------------------------------------------
// Refs: `<agent>/<slot-id>` (every candidate) or `<agent>/<slot-id>/<candidate>`.

export interface RenderRef { readonly agent: ModelAgent; readonly slot: string; readonly candidate?: string }

export function parseRenderRef(ref: string): RenderRef {
  const parts = ref.split("/");
  const agent = parts[0] as ModelAgent;
  if (parts.length < 2 || parts.length > 3 || !(MODEL_AGENTS as readonly string[]).includes(agent) || !parts[1]) {
    throw new RenderUsageError(`${ref} is not a render ref (<agent>/<slot-id>[/<candidate>], agent one of ${MODEL_AGENTS.join(", ")})`);
  }
  if (parts.length === 3 && !CANDIDATE_NAME.test(parts[2]!)) throw new RenderUsageError(`${parts[2]} is not a candidate name (<name>-v<n>.md|json)`);
  return { agent, slot: parts[1], ...(parts.length === 3 ? { candidate: parts[2]! } : {}) };
}
export const formatRef = (ref: RenderRef) => [ref.agent, ref.slot, ...(ref.candidate ? [ref.candidate] : [])].join("/");

// ---------------------------------------------------------------------------------------------
// Text specimen kinds (Director, Writer, Publisher, Producer).

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
const cellText = (value: unknown) => typeof value === "string" ? value : JSON.stringify(value);

/** The specimen kind each agent's candidates render as, by candidate format. */
export const TEXT_SPECIMEN_KINDS: Readonly<Record<Exclude<ModelAgent, "designer">, { readonly md: string; readonly json: string }>> = {
  director: { md: "brief", json: "brief-data" },
  writer: { md: "copy", json: "lexicon" },
  publisher: { md: "page-notes", json: "page" },
  producer: { md: "loop", json: "loop-data" },
};

export interface TextSpecimen { readonly specimen: string; readonly locale?: string; readonly title: string; readonly tables: readonly { readonly label: string; readonly rows: readonly (readonly [string, string])[] }[]; readonly prose?: string }

/** Flatten a JSON value into (path, value) rows. */
function flatten(value: unknown, prefix = ""): [string, string][] {
  if (value && typeof value === "object") {
    const entries = Array.isArray(value) ? value.map((item, index) => [String(index), item] as const) : Object.entries(value);
    if (!entries.length) return [[prefix || "(root)", Array.isArray(value) ? "[]" : "{}"]];
    return entries.flatMap(([key, item]) => flatten(item, prefix ? `${prefix}.${key}` : key));
  }
  return [[prefix || "(root)", cellText(value)]];
}

/** Writer copy per locale: `## <locale>` sections of `### <key>` records (the native Writer body). */
function writerLocales(body: string, locales: readonly string[]): Map<string, [string, string][]> {
  const out = new Map<string, [string, string][]>();
  let locale: string | undefined, key: string | undefined, lines: string[] = [];
  const flush = () => { if (locale && key) out.get(locale)!.push([key, lines.join("\n").trim()]); key = undefined; lines = []; };
  for (const line of body.split(/\r?\n/)) {
    if (line.startsWith("## ")) { flush(); locale = line.slice(3).trim(); if (!out.has(locale)) out.set(locale, []); continue; }
    if (line.startsWith("### ")) { flush(); key = line.slice(4).trim(); continue; }
    if (/^<!-- .* -->$/.test(line)) continue;
    if (key) lines.push(line);
  }
  flush();
  for (const wanted of locales) if (!out.has(wanted)) out.set(wanted, []);
  return out;
}

/** The text specimens of one non-Designer candidate. */
export function textSpecimens(agent: Exclude<ModelAgent, "designer">, slot: string, candidate: string, bytes: string): TextSpecimen[] {
  const format = candidate.endsWith(".json") ? "json" : "md";
  const specimen = TEXT_SPECIMEN_KINDS[agent][format];
  const title = `${agent}/${slot}/${candidate}`;
  if (format === "json") {
    let value: unknown;
    try { value = JSON.parse(bytes); } catch { return [{ specimen, title, tables: [], prose: bytes }]; }
    return [{ specimen, title, tables: [{ label: "fields", rows: flatten(value) }] }];
  }
  const parsed = parseFrontmatter(bytes);
  const fields = parsed.ok ? parsed.value.fields : {};
  const body = parsed.ok ? parsed.value.body : bytes;
  const meta = { label: "frontmatter", rows: Object.entries(fields).map(([key, value]) => [key, cellText(value)] as const) };
  if (agent === "writer") {
    const locales = Array.isArray(fields.locales) ? (fields.locales as unknown[]).filter((item): item is string => typeof item === "string") : [];
    const byLocale = writerLocales(body, locales);
    if (byLocale.size) return [...byLocale].map(([locale, rows]) => ({ specimen, locale, title, tables: [meta, { label: `copy (${locale})`, rows }] }));
  }
  return [{ specimen, title, tables: [meta], prose: body }];
}

export function textSpecimenHtml(specimen: TextSpecimen): string {
  const tables = specimen.tables.filter(table => table.rows.length).map(table =>
    `<table><caption>${escapeHtml(table.label)}</caption><tbody>${table.rows.map(([key, value]) => `<tr><th scope="row">${escapeHtml(key)}</th><td>${escapeHtml(value)}</td></tr>`).join("")}</tbody></table>`).join("\n");
  const prose = specimen.prose?.trim() ? `<pre>${escapeHtml(specimen.prose.trim())}</pre>` : "";
  return `<!doctype html>\n<html lang="${escapeHtml(specimen.locale ?? "en")}"><head><meta charset="utf-8"><title>${escapeHtml(specimen.title)}</title>`
    + `<style>body{font:14px/1.5 system-ui,sans-serif;margin:24px;color:#18181b;background:#fff}table{border-collapse:collapse;margin:0 0 16px;width:100%}caption{text-align:left;font-weight:600;padding:4px 0}th,td{border:1px solid #e4e4e7;padding:4px 8px;text-align:left;vertical-align:top}th{width:30%;font-weight:500}pre{white-space:pre-wrap;font:inherit}</style>`
    + `</head><body><h1>${escapeHtml(specimen.title)}</h1>\n<p>${escapeHtml(specimen.specimen)}${specimen.locale ? ` &middot; ${escapeHtml(specimen.locale)}` : ""}</p>\n${tables}\n${prose}\n</body></html>\n`;
}

// ---------------------------------------------------------------------------------------------
// The driver.

export interface RenderRefOptions {
  readonly root: string;
  readonly ref: string;
  readonly compare?: string;
  readonly theme?: string;
  readonly widths?: readonly number[];
  readonly cache?: string;
  readonly snapshot?: Snapshot;
  readonly now?: () => Date;
}
interface RenderedCandidate { readonly agent: ModelAgent; readonly slot: string; readonly candidate: string; readonly inputs: readonly string[]; readonly rows: RenderSpecimenRow[]; readonly files: string[] }

const indexOf = (options: { ref: string; compare?: string; inputs: readonly string[]; specimens: RenderSpecimenRow[]; now: () => Date }): RenderIndex => ({
  schema: "clossys.render/1", ref: options.ref, ...(options.compare ? { compare: options.compare } : {}),
  inputsSha256: sha256([...options.inputs].sort().join("\n")), renderedAt: options.now().toISOString(),
  by: { actor: "code", cli: "clossys render", version: PRODUCER_VERSION }, specimens: options.specimens,
});

async function renderOne(options: RenderRefOptions, ref: RenderRef, candidate: string, draft?: string): Promise<RenderedCandidate> {
  const now = options.now ?? (() => new Date());
  const rows: RenderSpecimenRow[] = [], files: string[] = [];
  const outOf = async (name: string) => { const dir = join(options.root, RENDERS_DIR, ref.agent, ref.slot, stemOf(name)); await mkdir(dir, { recursive: true }); return dir; };
  let inputs: string[], out: string;
  if (ref.agent === "designer") {
    const result = await renderCandidate({
      root: options.root, slot: ref.slot, ...(draft !== undefined ? { draft } : { candidate }),
      ...(options.theme ? { theme: options.theme } : {}), ...(options.widths ? { widths: options.widths } : {}),
      ...(options.cache ? { cache: options.cache } : {}), ...(options.snapshot ? { snapshot: options.snapshot } : {}),
    });
    candidate = result.candidate;
    out = await outOf(candidate);
    inputs = [`${ref.slot}/${result.candidate}:${result.sha256}`, `pin-set:${result.pinSetHash}`, `theme:${result.theme}`];
    for (const row of result.renders) {
      const file = join(out, `element-${row.width}.png`);
      await copyFile(row.path, file);
      files.push(file);
      rows.push({ candidate: result.candidate, specimen: "element", width: row.width, png: posix(relative(options.root, file)) });
    }
  } else {
    const bytes = readFileSync(join(textCandidatesDir(options.root, ref), candidate), "utf8");
    const candidateSha = sha256(bytes);
    out = await outOf(candidate);
    inputs = [`${ref.slot}/${candidate}:${candidateSha}`];
    for (const specimen of textSpecimens(ref.agent, ref.slot, candidate, bytes)) {
      const file = join(out, `${specimen.specimen}${specimen.locale ? `-${specimen.locale}` : ""}.html`);
      await writeAtomic(file, textSpecimenHtml(specimen));
      files.push(file);
      rows.push({ candidate, specimen: specimen.specimen, ...(specimen.locale ? { locale: specimen.locale } : {}), html: posix(relative(options.root, file)) });
    }
  }
  const index = indexOf({ ref: formatRef({ ...ref, candidate }), inputs, specimens: rows, now });
  await writeAtomic(join(out, "index.json"), `${JSON.stringify(index, null, 2)}\n`);
  return { agent: ref.agent, slot: ref.slot, candidate, inputs, rows, files };
}

/**
 * A text specimen reads only the candidate's bytes, so a Director, Writer, Publisher or Producer
 * slot renders from its folder (`clossys/agents/<agent>/<slot-id>/candidates/`) without loading the
 * agent's IA. Designer renders go through the slot index (the dependency pin set is part of the key).
 */
function textCandidatesDir(root: string, ref: RenderRef): string {
  return join(root, "clossys", "agents", ref.agent, ref.slot, "candidates");
}

/** The candidates a ref names: one, or every candidate of the slot. */
function candidatesOf(root: string, ref: RenderRef): string[] {
  let names: readonly string[];
  if (ref.agent === "designer") {
    const entry = readSlotEntry(join(root, "clossys"), ref.agent, ref.slot);
    if (!entry) throw new RenderUsageError(`${ref.agent}/${ref.slot} is not in ${ref.agent}'s IA`);
    names = entry.candidates;
  } else {
    const dir = textCandidatesDir(root, ref);
    if (!existsSync(dir)) throw new RenderUsageError(`${ref.agent}/${ref.slot} has no candidates folder`);
    names = readdirSync(dir).filter(name => CANDIDATE_NAME.test(name)).sort();
  }
  if (ref.candidate) {
    if (!names.includes(ref.candidate)) throw new RenderUsageError(`${ref.agent}/${ref.slot} has no candidate ${ref.candidate}`);
    return [ref.candidate];
  }
  if (!names.length) throw new RenderUsageError(`${ref.agent}/${ref.slot} has no candidates`);
  return [...names];
}

/** Render a ref (and, with `compare`, a second candidate beside it); returns the `clossys.render/1` result. */
export async function renderRef(options: RenderRefOptions & { readonly draft?: string }): Promise<RenderIndex> {
  const now = options.now ?? (() => new Date());
  const ref = parseRenderRef(options.ref);
  if (options.draft !== undefined) {
    if (ref.agent !== "designer") throw new RenderUsageError("--draft renders a Designer craft direction; it needs a designer/<slot-id> ref");
    if (ref.candidate) throw new RenderUsageError("--draft and a candidate name are separate calls");
    if (options.compare) throw new RenderUsageError("--draft and --compare are separate calls");
    const entry = slotIndex(join(options.root, "clossys")).get(ref.slot);
    if (!entry || entry.agent !== "designer") throw new RenderUsageError(`designer/${ref.slot} is not in designer's IA`);
    // The draft's candidate name (the slot's next) is resolved by renderCandidate.
    const one = await renderOne(options, ref, "", options.draft);
    return indexOf({ ref: formatRef({ ...ref, candidate: one.candidate }), inputs: one.inputs, specimens: one.rows, now });
  }
  const rendered: RenderedCandidate[] = [];
  for (const candidate of candidatesOf(options.root, ref)) rendered.push(await renderOne(options, ref, candidate));
  if (!options.compare) return indexOf({ ref: options.ref, inputs: rendered.flatMap(row => row.inputs), specimens: rendered.flatMap(row => row.rows), now });

  const other = parseRenderRef(options.compare);
  if (!ref.candidate || !other.candidate) throw new RenderUsageError("--compare takes two candidate refs (<agent>/<slot-id>/<candidate>)");
  const b = await renderOne(options, other, candidatesOf(options.root, other)[0]!);
  const a = rendered[0]!;
  const dir = join(options.root, RENDERS_DIR, "compare", `${stemOf(a.candidate)}--${stemOf(b.candidate)}`);
  await mkdir(dir, { recursive: true });
  const specimens: RenderSpecimenRow[] = [];
  const columns: string[] = [];
  for (const side of [a, b]) {
    const cells: string[] = [];
    for (const row of side.rows) {
      const source = resolve(options.root, (row.png ?? row.html)!);
      const ext = row.png ? "png" : "html";
      const name = `${stemOf(side.candidate)}${side.agent === "designer" ? "" : `-${row.specimen}`}${row.locale ? `-${row.locale}` : ""}${row.width ? `-${row.width}` : ""}.${ext}`;
      await copyFile(source, join(dir, name));
      const path = posix(relative(options.root, join(dir, name)));
      specimens.push({ ...row, ...(row.png ? { png: path } : { html: path }) });
      cells.push(row.png
        ? `<figure><img src="${escapeHtml(name)}" alt="${escapeHtml(`${side.candidate} ${row.width}px`)}"><figcaption>${escapeHtml(`${row.width}px`)}</figcaption></figure>`
        : `<figure><iframe src="${escapeHtml(name)}" title="${escapeHtml(`${side.candidate} ${row.specimen}${row.locale ? ` ${row.locale}` : ""}`)}"></iframe><figcaption>${escapeHtml(`${row.specimen}${row.locale ? ` ${row.locale}` : ""}`)}</figcaption></figure>`);
    }
    columns.push(`<section><h2>${escapeHtml(formatRef({ agent: side.agent, slot: side.slot, candidate: side.candidate }))}</h2>${cells.join("")}</section>`);
  }
  const combined = join(dir, "compare.html");
  await writeAtomic(combined, `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(`${basename(a.candidate)} vs ${basename(b.candidate)}`)}</title>`
    + `<style>body{font:14px/1.5 system-ui,sans-serif;margin:24px;background:#fff;color:#18181b}main{display:grid;grid-template-columns:1fr 1fr;gap:24px}img{max-width:100%;border:1px solid #e4e4e7}iframe{width:100%;height:480px;border:1px solid #e4e4e7}figure{margin:0 0 16px}</style>`
    + `</head><body><main>${columns.join("")}</main></body></html>\n`);
  specimens.push({ candidate: a.candidate, specimen: COMPARE_SPECIMEN, html: posix(relative(options.root, combined)) });
  const result = indexOf({ ref: options.ref, compare: options.compare, inputs: [...a.inputs, ...b.inputs], specimens, now });
  await writeAtomic(join(dir, "index.json"), `${JSON.stringify(result, null, 2)}\n`);
  return result;
}
