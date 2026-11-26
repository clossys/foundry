/**
 * When code may author a candidate (DET-STEPS round 2, planner D5 "Adopt = A"): `code:adopt` installs the
 * source-ladder stock item byte-exact into a slot whose contract adopts byte-exact, and the normal certify gate
 * (the submit guard, then the run's certify or check step) judges it like any candidate. Every other candidate is the
 * agent seat's to create.
 *
 * A byte-exact adopt slot (codeAdoptSlotRefusal) is a Designer slot of the components layer (ref-verbatim
 * byteExactAdoption: components are adopted, never crafted) whose standard is `adopt-first`, that is not a consumer
 * asset (Designer provenance.json consumerAssets: the consumer's own original) and whose family offers one option.
 * Its stock item (stockItemOf) is the reference-manifest row of registry shadcn-aria or diceui that ships the slot's
 * contract fixture file; code installs only into a slot that holds no live candidate, and only when every package the
 * item imports is in the consumer's lockfile. With no stock item, a held candidate or an unlocked import, the agent
 * creates.
 *
 * Dependencies (CP1-DEPS): before it installs the item, the adopt step adds the npm packages the item imports and the
 * lockfile lacks to the consumer's root package.json and runs npm install there (records/adopt-dependencies.ts), as
 * `publish --install` does for its substrate. stockDependencyPlan names them: only packages the pinned registry entry
 * declares (the item row's `dependencies`, plus its registry's `registry:style` rows at the same version, the base
 * every item of that registry is written against), each a valid npm package name, at the range the publish collector
 * (`substrateDependencies`) gives. An import the entry does not declare, or an invalid name, refuses the change.
 *
 * The writer (records/slot-write.ts writeCandidate) accepts `--by code:adopt` only when codeAdoptRefusal finds
 * nothing: the slot rule, then the item is the stock item exactly (registry lineage, rung L1 with its seed, every
 * file byte-exact to the normalized reference). R03.2 flags any submit by code:adopt that fails the same rule.
 *
 * Token fallbacks (D5-2D, remainder 2 option b): a consumer adoption writes every bare token read with the value the
 * consumer's pinned `themes.*` slots declare (read/theme-pins.ts pinnedThemeReader), never a package value; a name the
 * pins do not declare refuses the adoption (UndeclaredTokenFallbackError). The reference is normalized through the
 * same reader, so the comparison stays byte-exact, and the item records the reader's source and each written file's
 * sha256 (meta.refVerbatim.reader, outputSha256).
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { isBuiltin } from "node:module";
import { dirname, join } from "node:path";
import { substrateDependencies } from "@clossys/publisher/install";
import { byteExactAdoption, normalizedSeedFile, type DeclaredFallbackReader } from "@clossys/designer/ref-verbatim";
import { packagePath } from "../package-path.js";
import { pinnedThemeReader } from "../read/theme-pins.js";
import { readSlot } from "./slots.js";
import { readStandard } from "./standards.js";

/** Who authors a code-adopted candidate (its submit event's `by`). */
export const CODE_ADOPT = "code:adopt";
/** The command a code-adopted candidate's header names as its creator. */
export const CODE_ADOPT_CLI = "clossys settle adopt";
/** The skill a code adopt's submit event cites: the step it settles (the Designer's candidates step). */
export const CODE_ADOPT_SKILL = "packages/designer/actions/designer.candidates/skill.md";
/** The ladder rung a code adopt submits: the Designer's L1, stock adopted unmodified. */
export const CODE_ADOPT_RUNG = "L1";
/** The registries whose stock items code installs (the seeder's and the source ladder's stock rung). */
export const STOCK_REGISTRIES: readonly string[] = ["shadcn-aria", "diceui"];
export const REFERENCE_MANIFEST = "packages/designer/references/manifest.json";
export const PROVENANCE_RULE = "packages/designer/src/catalog/rules/provenance.json";

interface ManifestFile { readonly path: string; readonly sha256?: string }
export interface ManifestRow {
  readonly registry: string; readonly name: string; readonly version: string; readonly type: string; readonly dir: string;
  readonly hash: string; readonly license: string; readonly files: readonly ManifestFile[]; readonly slots?: readonly string[];
  /** The npm packages the registry entry declares (`name` or `name@range`, as shadcn lists them). */
  readonly dependencies?: readonly string[];
}
export interface StockItem {
  readonly row: ManifestRow;
  readonly ref: string;
  readonly seed: string;
  readonly item: { readonly name: string; readonly type: string; readonly dependencies: readonly string[]; readonly files: readonly { path: string; type: string; content: string }[]; readonly meta: Record<string, unknown> };
}

const refIdOf = (row: ManifestRow): string => `${row.registry}/${row.name}@${row.version}`;
const sha256 = (text: string): string => createHash("sha256").update(text, "utf8").digest("hex");
const readJson = (file: string): unknown => JSON.parse(readFileSync(file, "utf8")) as unknown;
const manifestOf = (root: string): { items: ManifestRow[] } => readJson(packagePath(root, REFERENCE_MANIFEST)) as { items: ManifestRow[] };
const referencesDirOf = (root: string): string => dirname(packagePath(root, REFERENCE_MANIFEST));

/** Why `designer/<slotId>` is not a byte-exact adopt slot code may author into, or undefined when it is one. */
export function codeAdoptSlotRefusal(root: string, agent: string, slotId: string): string | undefined {
  const at = `${agent}/${slotId}`;
  if (agent !== "designer") return `${at} is not a byte-exact adopt slot: only a Designer components slot adopts byte-exact`;
  if (byteExactAdoption(slotId, undefined) === undefined) return `${at} is not a byte-exact adopt slot: it is not of the components layer, so its candidates may be crafted`;
  let doc: ReturnType<typeof readSlot>;
  try { doc = readSlot(join(root, "clossys"), "designer", slotId); }
  catch (error) { return `${at} is not a byte-exact adopt slot: its slot.json cannot be read (${error instanceof Error ? error.message : String(error)})`; }
  if (doc.standard === undefined) return `${at} is not a byte-exact adopt slot: it names no standard`;
  const standard = readStandard(root, "designer", doc.standard);
  if (standard.doc?.mode !== "adopt-first") return `${at} is not a byte-exact adopt slot: its standard ${doc.standard} is not adopt-first`;
  let consumerAssets: readonly string[];
  try { consumerAssets = ((readJson(packagePath(root, PROVENANCE_RULE)) as { consumerAssets?: { slots?: string[] } }).consumerAssets?.slots) ?? []; }
  catch (error) { return `${at} is not a byte-exact adopt slot: ${PROVENANCE_RULE} cannot be read (${error instanceof Error ? error.message : String(error)})`; }
  if (consumerAssets.includes(slotId)) return `${at} is not a byte-exact adopt slot: it is a consumer asset (the consumer's own original, no registry ships it)`;
  const options = doc.family?.options ?? 1;
  if (options !== 1) return `${at} is not a byte-exact adopt slot: its family offers ${options} options, and code installs one stock item`;
  return undefined;
}

const HOST = new Set(["react", "react-dom"]);
/** The npm packages a file imports (bare specifiers, by package name), the host's React aside (the seeder's rule). */
export function importedPackages(text: string): string[] {
  const names = new Set<string>();
  for (const match of text.matchAll(/\b(?:import|export)\s+(?:type\s+)?(?:[^'"`;]*?\sfrom\s+)?["']([^"']+)["']/g)) {
    const spec = match[1]!;
    if (spec.startsWith(".") || spec.startsWith("/") || spec.startsWith("@/")) continue;
    const name = spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0]!;
    if (!HOST.has(name)) names.add(name);
  }
  return [...names].sort();
}

/** The reason an adopted item gives (the seeder's designerReason): the Director traits the slot reads that it realises. */
function reasonOf(root: string, doc: ReturnType<typeof readSlot>, what: string): string {
  const standard = doc.standard === undefined ? undefined : readStandard(root, "designer", doc.standard);
  const params = ((standard?.doc?.requirements ?? []) as readonly { check?: string; params?: { traits?: string[]; required?: string[] } }[]).find(item => item.check === "derive.director")?.params ?? {};
  const inputs = new Set(doc.inputs ?? []);
  const cited = [...new Set([...(params.traits ?? []).filter(id => inputs.has(id)), ...(params.required ?? [])])];
  if (!cited.length && inputs.has("identity.visual.style")) cited.push("identity.visual.style");
  if (!cited.length) return `${what[0]!.toUpperCase()}${what.slice(1)}.`;
  return `Realises ${cited.map(id => `director:${id}`).join(", ")}: ${what}.`;
}

/**
 * The stock item code installs into `designer/<slotId>`, or why there is none (the agent creates): the manifest row of
 * a stock registry that ships the contract fixture file (the row that maps the slot, else the one named after the
 * file, else the first), its .tsx files normalized to the consumer's components.json, its imports at the consumer's
 * locked versions.
 */
export function stockItemOf(root: string, slotId: string): { readonly stock: StockItem } | { readonly none: string } {
  const found = stockFilesOf(root, slotId);
  if ("none" in found) return found;
  const { row, ref, doc, files, reader } = found;
  const locked = lockedPackages(root);
  const imports = [...new Set(files.flatMap(each => importedPackages(each.content)))].sort();
  const unlocked = imports.filter(name => locked[name] === undefined);
  if (unlocked.length) return { none: `${ref} imports ${unlocked.join(", ")}, which the consumer lockfile does not hold` };
  const item = {
    name: slotId.split(".").at(-1)!,
    type: row.type,
    dependencies: imports.map(name => `${name}@${locked[name]!}`),
    files,
    meta: {
      slot: slotId,
      source: { kind: "registry", ref: [ref], hash: row.hash, license: row.license },
      refVerbatim: {
        files: Object.fromEntries(files.map(each => [each.path, each.path])),
        reader: reader.source,
        outputSha256: Object.fromEntries(files.map(each => [each.path, sha256(each.content)])),
      },
      element: { slot: slotId, reason: reasonOf(root, doc, `stock ${ref}, adopted unmodified by code`) },
    },
  };
  return { stock: { row, ref, seed: `${row.registry}/${row.name}`, item } };
}

/** The version the consumer's root package-lock.json holds for each package it installs (`packages["node_modules/<name>"]`). */
export function lockedPackages(root: string): Record<string, string> {
  const lockFile = join(root, "package-lock.json");
  const packages = existsSync(lockFile) ? ((readJson(lockFile) as { packages?: Record<string, { version?: unknown }> }).packages ?? {}) : {};
  const out: Record<string, string> = {};
  for (const [path, entry] of Object.entries(packages)) {
    if (!path.startsWith("node_modules/") || typeof entry?.version !== "string") continue;
    const name = path.slice("node_modules/".length);
    // Only a top-level install (node_modules/<name>), never one nested under another package.
    if (!name.includes("/node_modules/")) out[name] = entry.version;
  }
  return out;
}

interface StockFiles {
  readonly row: ManifestRow; readonly ref: string; readonly doc: ReturnType<typeof readSlot>; readonly manifest: { items: ManifestRow[] };
  readonly files: readonly { path: string; type: string; content: string }[]; readonly reader: DeclaredFallbackReader;
}

/** The stock row of `designer/<slotId>` and its .tsx files normalized to the consumer (stockItemOf, before the lockfile). */
function stockFilesOf(root: string, slotId: string): StockFiles | { readonly none: string } {
  const at = `designer/${slotId}`;
  const doc = readSlot(join(root, "clossys"), "designer", slotId);
  const file = ((doc.contract as { fixture?: { fixtures?: { file?: unknown } } }).fixture?.fixtures?.file);
  if (typeof file !== "string") return { none: `${at} has no contract fixture file, so no stock item ships it` };
  const manifest = manifestOf(root);
  const shipping = manifest.items.filter(row => STOCK_REGISTRIES.includes(row.registry) && row.files.some(each => each.path === file));
  // The source ladder, explicitly: the first registry of STOCK_REGISTRIES (shadcn-aria) that ships the fixture wins,
  // the partner (diceui) only when it does not; within one registry, the row naming this slot, then the row named
  // for the fixture file, then the first row in manifest order.
  const base = file.split("/").at(-1)!.replace(/\.tsx$/, "");
  const registry = STOCK_REGISTRIES.find(name => shipping.some(row => row.registry === name));
  const rows = shipping.filter(row => row.registry === registry);
  const row = rows.find(each => (each.slots ?? []).includes(slotId)) ?? rows.find(each => each.name === base) ?? rows[0];
  if (!row) return { none: `no ${STOCK_REGISTRIES.join(" or ")} stock item ships ${at}'s contract fixture ${file}` };
  const ref = refIdOf(row);
  const consumer = join(root, "clossys");
  // Every fallback the written file carries is the consumer's pinned value; an undeclared name throws (refused).
  const reader = pinnedThemeReader(consumer);
  const files = row.files.filter(each => each.path.endsWith(".tsx")).map(each => ({
    path: each.path, type: row.type, content: normalizedSeedFile(consumer, ref, each.path, { manifest, referencesDir: referencesDirOf(root), reader }),
  }));
  return { row, ref, doc, manifest, files, reader };
}

/** What the adopt step changes in the consumer's root package.json before it installs the stock item. */
export interface DependencyPlan {
  /** The pinned registry entry whose files import the packages. */
  readonly ref: string;
  /** The manifest rows whose `dependencies` declare what may be added: the entry, then its registry's style rows. */
  readonly declaredBy: readonly string[];
  /** The entries added to package.json `dependencies` (name to range, from substrateDependencies): imported, unlocked, not yet declared there. */
  readonly add: Readonly<Record<string, string>>;
  /** Every imported package the lockfile lacks: npm install runs in the consumer root when there is one. */
  readonly install: readonly string[];
}

/** npm's rule for a new package name (validate-npm-package-name): lowercase, url-safe, at most 214 characters, no leading `.`, `_` or `-`, not a Node builtin. */
const NPM_NAME = /^(?:@[a-z0-9~][a-z0-9._~-]*\/)?[a-z0-9~][a-z0-9._~-]*$/;
/** A range code writes: what the collector gives a bare entry (`latest`) or one exact, caret or tilde version. Never a URL, path, git or tag spec. */
const NPM_RANGE = /^(?:latest|[~^]?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/;
/** Why `name` is not a valid npm package name, or undefined. */
export function npmNameIssue(name: string): string | undefined {
  if (!name.length || name.length > 214) return `${JSON.stringify(name)} is not an npm package name (1 to 214 characters)`;
  if (!NPM_NAME.test(name)) return `${JSON.stringify(name)} is not an npm package name (lowercase, url-safe, no leading . _ or -)`;
  if (isBuiltin(name) || name === "node_modules" || name === "favicon.ico") return `${JSON.stringify(name)} is not an npm package name (a reserved or Node builtin name)`;
  return undefined;
}

/**
 * The package.json change the adopt of `designer/<slotId>`'s stock item needs: every package its normalized files
 * import that the consumer lockfile lacks, each declared by the pinned registry entry (the row's `dependencies`, or its
 * registry's `registry:style` rows at the same version), each a valid npm name at the publish collector's range. An
 * undeclared import or an invalid name refuses, as does a needed change with no root package.json. `none`: no stock
 * item, so nothing to install for.
 */
export function stockDependencyPlan(root: string, slotId: string): { readonly plan: DependencyPlan } | { readonly refused: string } | { readonly none: string } {
  const found = stockFilesOf(root, slotId);
  if ("none" in found) return found;
  const { row, ref, manifest, files } = found;
  const styles = manifest.items.filter(each => each.registry === row.registry && each.version === row.version && each.type === "registry:style" && each !== row);
  const declaring = [row, ...styles];
  // The one collector `publish --install` uses: a registry entry's `name@range` keeps its range, a bare name is `latest`.
  const declared = substrateDependencies(declaring.map(each => ({ dependencies: each.dependencies ?? [] })));
  const locked = lockedPackages(root);
  const imports = [...new Set(files.flatMap(each => importedPackages(each.content)))].sort();
  const install = imports.filter(name => locked[name] === undefined);
  const declaredBy = declaring.map(refIdOf);
  const plan = { ref, declaredBy };
  if (!install.length) return { plan: { ...plan, add: {}, install } };
  const undeclared = install.filter(name => !Object.hasOwn(declared, name));
  if (undeclared.length) return { refused: `${ref} imports ${undeclared.join(", ")}, which the consumer lockfile does not hold and ${declaredBy.join(", ")} do${declaredBy.length === 1 ? "es" : ""} not declare; code adds only declared dependencies` };
  const invalid = install.flatMap(name => {
    const issue = npmNameIssue(name);
    if (issue) return [issue];
    return NPM_RANGE.test(declared[name]!) ? [] : [`${name}@${declared[name]} is not a version code writes (latest, or one exact, ^ or ~ version)`];
  });
  if (invalid.length) return { refused: `${ref}: ${invalid.join("; ")}; nothing is added` };
  const manifestFile = join(root, "package.json");
  if (!existsSync(manifestFile)) return { refused: `${ref} imports ${install.join(", ")}, which the consumer lockfile does not hold, and the consumer has no root package.json to declare them in` };
  let pkg: { dependencies?: Record<string, unknown>; devDependencies?: Record<string, unknown> };
  try { pkg = readJson(manifestFile) as typeof pkg; } catch (error) { return { refused: `the consumer's package.json cannot be read: ${error instanceof Error ? error.message : String(error)}` }; }
  const held = (name: string) => Object.hasOwn(pkg.dependencies ?? {}, name) || Object.hasOwn(pkg.devDependencies ?? {}, name);
  const add = Object.fromEntries(install.filter(name => !held(name)).map(name => [name, declared[name]!]));
  return { plan: { ...plan, add, install } };
}

/**
 * Why a submit by code:adopt with the submit's `fields` (its ledger record) into `<agent>/<slotId>` is refused: the
 * slot is not a byte-exact adopt slot, it has no stock item, or the submit is not rung L1 with that item's seed. Else
 * the stock item. R03.2 judges every code:adopt submit event by it (R03.4 judges the files byte-exact).
 */
export function codeAdoptSubmitRefusal(root: string, agent: string, slotId: string, fields: Readonly<Record<string, unknown>> | undefined): string | { readonly stock: StockItem } {
  const slot = codeAdoptSlotRefusal(root, agent, slotId);
  if (slot !== undefined) return slot;
  let found: ReturnType<typeof stockItemOf>;
  try { found = stockItemOf(root, slotId); }
  catch (error) { return `${agent}/${slotId}'s stock item cannot be read: ${error instanceof Error ? error.message : String(error)}`; }
  if ("none" in found) return `${found.none}; code adopts only a stock item`;
  if (fields?.rung !== CODE_ADOPT_RUNG || fields.seed !== found.stock.seed) return `a code adopt submits rung ${CODE_ADOPT_RUNG} with seed ${found.stock.seed}, not rung ${String(fields?.rung)} seed ${String(fields?.seed)}`;
  return found;
}

/**
 * Why a submit by code:adopt of `content` (with the submit's `fields`) into `<agent>/<slotId>` is refused, or
 * undefined: the slot is a byte-exact adopt slot, and the item is that slot's stock item exactly (rung L1 and its seed,
 * registry lineage citing the row, every file mapped and byte-exact to the normalized reference).
 */
export function codeAdoptRefusal(root: string, agent: string, slotId: string, content: unknown, fields: Readonly<Record<string, unknown>> | undefined): string | undefined {
  const submit = codeAdoptSubmitRefusal(root, agent, slotId, fields);
  if (typeof submit === "string") return submit;
  const { stock } = submit;
  const item = content as { meta?: { source?: { kind?: unknown; ref?: unknown }; refVerbatim?: { files?: Record<string, unknown>; reader?: unknown; outputSha256?: Record<string, unknown> } }; files?: { path?: unknown; content?: unknown }[] } | undefined;
  const source = item?.meta?.source;
  if (source?.kind !== "registry" || JSON.stringify(source.ref) !== JSON.stringify([stock.ref])) return `a code adopt carries registry lineage citing ${stock.ref} only`;
  const given = item?.files ?? [];
  const mapped = item?.meta?.refVerbatim?.files ?? {};
  const expectedMeta = stock.item.meta.refVerbatim as { reader: string; outputSha256: Record<string, string> };
  if (item?.meta?.refVerbatim?.reader !== expectedMeta.reader) return `a code adopt names its fallback reader "${expectedMeta.reader}", not ${JSON.stringify(item?.meta?.refVerbatim?.reader)}`;
  const recorded = item?.meta?.refVerbatim?.outputSha256 ?? {};
  if (given.length !== stock.item.files.length) return `a code adopt ships the stock item's ${stock.item.files.length} file(s), not ${given.length}`;
  for (const expected of stock.item.files) {
    const file = given.find(each => each.path === expected.path);
    if (!file || mapped[expected.path] !== expected.path) return `a code adopt ships and maps ${expected.path} from ${stock.ref}`;
    if (file.content !== expected.content) return `a code adopt's ${expected.path} is not byte-exact to ${stock.ref}'s reference normalized through ${expectedMeta.reader}`;
    if (recorded[expected.path] !== expectedMeta.outputSha256[expected.path]) return `a code adopt records ${expected.path}'s output sha256 ${expectedMeta.outputSha256[expected.path]}, not ${String(recorded[expected.path])}`;
  }
  return undefined;
}

/**
 * The declared-fallback reader a candidate's adoption record names (meta.refVerbatim.reader), for the checks that
 * normalize its reference through the same reader: the consumer's pinned themes reader when it names that source,
 * else undefined (a package or legacy adoption, compared with the plain normalized reference). A reader the consumer
 * cannot supply is the check's refusal, never a substitute.
 */
export function adoptionReaderOf(consumer: string, item: unknown): DeclaredFallbackReader | undefined {
  const named = (item as { meta?: { refVerbatim?: { reader?: unknown } } } | undefined)?.meta?.refVerbatim?.reader;
  if (named === undefined) return undefined;
  const reader = pinnedThemeReader(consumer);
  if (named !== reader.source) throw new Error(`the adoption names the fallback reader ${JSON.stringify(named)}; this consumer supplies only "${reader.source}"`);
  return reader;
}

/** The fix a stale consumer adoption names (N1): its bytes are the adoption's own, so the pins moved after it. */
export const READOPT_HINT = "re-adopt it (code:adopt the stock item again) to take the consumer's current pinned theme values";

/**
 * Whether a consumer adoption's files are still the bytes it wrote (every `meta.refVerbatim.outputSha256` entry
 * matches its file): then a byte-exact failure against the reference normalized through the current pins means a
 * pinned `themes.*` value changed after the adoption, and the fix is re-adoption ({@link READOPT_HINT}), not an edit.
 */
export function adoptionUnchangedSinceWrite(item: unknown): boolean {
  const doc = item as { meta?: { refVerbatim?: { reader?: unknown; outputSha256?: Record<string, unknown> } }; files?: { path?: unknown; content?: unknown }[] } | undefined;
  const recorded = doc?.meta?.refVerbatim?.outputSha256;
  if (doc?.meta?.refVerbatim?.reader === undefined || !recorded || !Object.keys(recorded).length) return false;
  return Object.entries(recorded).every(([path, sha]) => {
    const file = doc.files?.find(each => each.path === path);
    return typeof file?.content === "string" && sha256(file.content) === sha;
  });
}
