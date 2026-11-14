/**
 * `clossys render <slot> <candidate>`: one Designer candidate rendered in context through the
 * specimen harness, for P2 craft (slot-constitution 5b, step 3) and its blind critic.
 *
 * The render is cached by (candidate sha256, dependency pin-set hash): the dependency pin set is
 * (slot id, pinned sha256) for every slot in the candidate's slot's transitive dependency closure
 * (slot.json `inputs` ∪ `uses`, the R07 dependency set), hashed as R12 hashes the whole pin set. A
 * key already in the cache renders nothing; a repin of any dependency, or new candidate bytes, is a
 * new key. A dependency that is missing, unreadable or unpinned is refused (exit 1): a render over
 * an unresolved dependency would be cached under a key that does not name what it shows.
 *
 * Only Designer element candidates render here; copy renders inside its pinned frame and section
 * (a Writer slot is refused with exit 2 and that note).
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pinSetHash, type PinSetEntry } from "../constitution/rules/r12.js";
import { readCandidate, readSlot, slotIndex, type SlotEntry } from "../records/slots.js";
import { CANDIDATE_NAME } from "../records/slot-model/index.js";
import { snapshotSpecimen, type SnapshotOptions, type SnapshotResult } from "../specimen/thumbnails.js";
import { CliUsageError } from "./args.js";
import { discoverRoot } from "./root.js";

export const RENDER_USAGE = "Usage: clossys render <slot> <candidate> [--root <dir>] [--theme <t>] [--width <px,px>] [--cache <dir>] [--json]\n"
  + "  renders one Designer candidate through the specimen harness, cached by (candidate sha256, dependency pin-set hash)";
export const DEFAULT_RENDER_CACHE = join("node_modules", ".cache", "clossys", "render");
export const DEFAULT_RENDER_WIDTHS = [480] as const;
/** Bumped when what a cached render records changes. */
export const RENDER_CACHE_VERSION = "clossys.render/1";

export interface RenderArgs {
  readonly slot?: string;
  readonly candidate?: string;
  readonly root?: string;
  readonly theme?: string;
  readonly widths: readonly number[];
  readonly cache?: string;
  readonly help: boolean;
}

export function parseRenderArgs(argv: readonly string[]): RenderArgs {
  const positional: string[] = [];
  let root: string | undefined, theme: string | undefined, cache: string | undefined, help = false;
  const widths: number[] = [];
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]!;
    const value = (): string => {
      const next = argv[++index];
      if (!next || next.startsWith("--")) throw new CliUsageError(`${arg} requires a value`);
      return next;
    };
    switch (arg) {
      case "--help": help = true; break;
      case "--json": break;
      case "--root": root = value(); break;
      case "--theme": theme = value(); break;
      case "--cache": cache = value(); break;
      case "--width":
        for (const part of value().split(",")) {
          if (!/^\d{3,4}$/.test(part) || Number(part) < 200 || Number(part) > 3840) throw new CliUsageError("--width must be 200-3840 (comma-separated)");
          widths.push(Number(part));
        }
        break;
      default:
        if (arg.startsWith("--")) throw new CliUsageError(`unknown argument ${arg}`);
        positional.push(arg);
    }
  }
  if (positional.length > 2) throw new CliUsageError(`unexpected ${positional[2]}`);
  return { ...(positional[0] ? { slot: positional[0] } : {}), ...(positional[1] ? { candidate: positional[1] } : {}), ...(root ? { root } : {}), ...(theme ? { theme } : {}), ...(cache ? { cache } : {}), widths, help };
}

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
}
export interface RenderCliResult { exitCode: 0 | 1 | 2; message: string; output?: RenderResult }

const exists = (path: string) => stat(path).then(() => true, () => false);
async function writeAtomic(path: string, data: string | Buffer) {
  const temp = `${path}.${process.pid}.tmp`;
  await writeFile(temp, data);
  await rename(temp, path);
}

/** Renders one candidate (or reuses its cached render). `snapshot` is the specimen harness; tests inject it. */
export async function renderCandidate(options: {
  readonly root: string; readonly slot: string; readonly candidate: string; readonly theme?: string;
  readonly widths?: readonly number[]; readonly cache?: string;
  readonly snapshot?: (options: SnapshotOptions) => Promise<SnapshotResult>;
}): Promise<RenderResult> {
  const consumer = join(options.root, "clossys");
  const index = slotIndex(consumer);
  const entry = index.get(options.slot);
  if (!entry) throw new CliUsageError(`slot ${options.slot} is not in any agent's IA`);
  if (entry.agent !== "designer") throw new CliUsageError(`${entry.agent}/${options.slot}: render covers Designer element candidates; copy renders inside its pinned frame and section`);
  const name = CANDIDATE_NAME.exec(options.candidate);
  if (!name || name[3] !== "json") throw new CliUsageError(`${options.candidate} is not an element candidate name (<element>-v<n>.json)`);
  if (!entry.candidates.includes(options.candidate)) throw new CliUsageError(`${options.slot} has no candidate ${options.candidate}`);
  const { sha256 } = readCandidate(consumer, "designer", options.slot, options.candidate);
  const deps = dependencyPins(consumer, options.slot, index);
  if (deps.unresolved.length) throw new Error(`${options.slot}: render needs every dependency pinned; unresolved: ${deps.unresolved.join(", ")}`);
  const hash = pinSetHash(deps.entries);
  const theme = options.theme ?? "light";
  const cache = resolve(options.root, options.cache ?? DEFAULT_RENDER_CACHE);
  const widths = [...new Set(options.widths?.length ? options.widths : DEFAULT_RENDER_WIDTHS)];
  await mkdir(cache, { recursive: true });
  const renders: RenderedWidth[] = [];
  const missing: { width: number; key: string; path: string }[] = [];
  for (const width of widths) {
    const key = renderKey({ candidateSha: sha256, pinSetHash: hash, theme, width });
    const path = join(cache, `${key}.png`);
    if (await exists(path)) renders.push({ width, key, path, cached: true });
    else missing.push({ width, key, path });
  }
  if (missing.length) {
    const snapshot = await (options.snapshot ?? snapshotSpecimen)({
      records: [consumer], element: `${options.slot}/${name[1]}`, version: Number(name[2]), theme,
      widths: missing.map(row => row.width), workspace: options.root, cwd: options.root,
    });
    for (const row of missing) {
      const thumb = snapshot.thumbnails.find(candidate => candidate.width === row.width);
      if (!thumb) throw new Error(`${options.slot}/${options.candidate}: the specimen harness rendered no ${row.width}px image`);
      await writeAtomic(row.path, await readFile(thumb.path));
      await writeAtomic(join(cache, `${row.key}.json`), `${JSON.stringify({ schema: RENDER_CACHE_VERSION, slot: options.slot, candidate: options.candidate, sha256, pinSetHash: hash, dependencies: deps.entries, theme, width: row.width, specimen: { key: thumb.key, path: thumb.path, health: thumb.health ?? null } }, null, 2)}\n`);
      renders.push({ width: row.width, key: row.key, path: row.path, cached: false });
    }
  }
  renders.sort((a, b) => a.width - b.width);
  return { slot: options.slot, candidate: options.candidate, sha256, pinSetHash: hash, dependencies: deps.entries, theme, cache, renders };
}

export async function runRenderCli(argv: readonly string[], cwd = process.cwd(), snapshot?: (options: SnapshotOptions) => Promise<SnapshotResult>): Promise<RenderCliResult> {
  try {
    const args = parseRenderArgs(argv);
    if (args.help) return { exitCode: 0, message: RENDER_USAGE };
    if (!args.slot || !args.candidate) throw new CliUsageError("render needs <slot> <candidate>");
    const root = discoverRoot(resolve(cwd, args.root ?? "."));
    const output = await renderCandidate({ root, slot: args.slot, candidate: args.candidate, ...(args.theme ? { theme: args.theme } : {}), widths: args.widths, ...(args.cache ? { cache: args.cache } : {}), ...(snapshot ? { snapshot } : {}) });
    const lines = output.renders.map(row => `${row.cached ? "cached" : "rendered"} ${row.width}px ${row.path}`);
    return { exitCode: 0, message: [`${output.slot}/${output.candidate} sha256:${output.sha256.slice(0, 12)} pin-set:${output.pinSetHash.slice(0, 12)} (${output.dependencies.length} dependencies) ${output.theme}`, ...lines].join("\n"), output };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { exitCode: error instanceof CliUsageError ? 2 : 1, message: error instanceof CliUsageError ? `${message}\n${RENDER_USAGE}` : message };
  }
}
