/**
 * The element certifier (R05, planner decision D1): a Designer candidate whose specimen mounts a
 * component is certified by rendering it on the server with the slot's contract fixture (W1-D's
 * `contract.fixture`), never with its own `meta.preview` and never with another candidate's. The
 * candidate's files are transpiled (TypeScript, JSX) and evaluated in a module system of its own:
 *
 * - a relative import resolves among the candidate's own files (by path or install path);
 * - `@/<path>` resolves to the candidate's own install paths, else to the pinned candidate of a slot
 *   slot.json `uses` names; resolving it elsewhere (a slot not in `uses`) is an `import` failure;
 * - a bare package must be declared in `dependencies` at an exact version (`name@x.y.z`) equal to the
 *   installed one; React itself (`react`, `react-dom`, `react/jsx-runtime`) is the host's;
 * - stylesheets evaluate to `{}`, other assets to their path, JSON to its value.
 *
 * Import failures are recorded and resolution falls through (to the installed package or any pinned
 * installer), so a render failure is still measured. The fixture tree's `$component` names another
 * export of the entry module or a `<package>.<Export>`; `{ "$copy": key }` is the pinned Writer copy.
 * A candidate whose specimen mounts no component (a theme, a font, an asset) needs no fixture. Which of these a
 * candidate gets is read from its registry type in one table (registry-types.ts), and its slot decides which types it
 * accepts (P1): a hook or lib item, in a hook or lib slot only, is never rendered; it is held to the code check
 * (`codeFit`). A registry type with no row, or one the slot does not accept, fails closed before any check.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, posix } from "node:path";
import ts from "typescript";
import { interactiveBackdropMetaIssues, previewFigureAltIssues, previewInteractiveBackdropIssues } from "@clossys/designer/catalog";
import { contractFixtureIssues, type ContractFixture } from "../../records/slot-model/contract-fixture.js";
import { designerComposedSlots } from "../../specimen/composed-slots.js";
import { dependencyPart } from "../../specimen/specimen-tree.js";
import { installPathOf, isObject, registryFiles, slotDoc, stringList } from "../checks/shared.js";
import type { CandidateRecord, SlotRecord } from "../types.js";
import { pinKey, type CertifyEnv } from "./env.js";
import { checkMountsFixture, CODE_ITEM_FILE_TYPES, elementCheckOf, HOOK_NAME, RegistryTypeError, slotAlwaysMountsFixture, type ElementCheck } from "./registry-types.js";
import { reason, type Reason } from "./types.js";

const HOST_MODULES = new Set(["react", "react-dom", "react-dom/server", "react/jsx-runtime", "react/jsx-dev-runtime"]);
const SUFFIXES = ["", ".tsx", ".ts", ".jsx", ".js", ".mjs", ".css", ".json", "/index.tsx", "/index.ts", "/index.jsx", "/index.js"];
const CODE = /\.(?:[cm]?[jt]sx?)$/;
const ASSET = /\.(?:svg|png|jpe?g|gif|webp|avif|ico|woff2?|ttf|otf|mp4|webm)$/i;
const EXACT = /^\d+\.\d+\.\d+$/;

type Require = NodeJS.Require;
const hosts = new Map<string, Require>();
/** The require React and installed packages come from: the workspace's node_modules, else the producer's own. */
export function hostRequire(root: string): Require {
  let hit = hosts.get(root);
  if (!hit) {
    hit = existsSync(join(root, "node_modules", "react", "package.json")) ? createRequire(join(root, "package.json")) : createRequire(import.meta.url);
    hosts.set(root, hit);
  }
  return hit;
}

const transpiled = new Map<string, string>();
function transpile(path: string, source: string): string {
  const key = createHash("sha256").update(path.endsWith("x") ? "x" : "s").update(source).digest("hex");
  let code = transpiled.get(key);
  if (code === undefined) {
    code = ts.transpileModule(source, {
      fileName: path,
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true, isolatedModules: true },
      reportDiagnostics: false,
    }).outputText;
    transpiled.set(key, code);
  }
  return code;
}

const packageName = (spec: string) => (spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0]!);

const installedVersions = new Map<string, string | undefined>();
/** The installed version of a package as the host resolves it (node_modules lookup, no `exports` gate). */
export function installedVersion(require: Require, name: string): string | undefined {
  const paths = require.resolve.paths(name) ?? [];
  const key = `${paths[0] ?? ""}\0${name}`;
  if (installedVersions.has(key)) return installedVersions.get(key);
  let version: string | undefined;
  for (const dir of paths) {
    const file = join(dir, name, "package.json");
    if (!existsSync(file)) continue;
    try { const doc = JSON.parse(readFileSync(file, "utf8")) as { version?: unknown }; version = typeof doc.version === "string" ? doc.version : undefined; } catch { /* unreadable */ }
    break;
  }
  installedVersions.set(key, version);
  return version;
}

interface Payload {
  readonly slot: string;
  readonly files: readonly { path: string; type?: string; target?: string; content: string }[];
  readonly byPath: ReadonlyMap<string, { path: string; content: string }>;
  readonly byInstall: ReadonlyMap<string, { path: string; content: string }>;
  readonly declared: ReadonlyMap<string, string | undefined>;
}

function payloadOf(slot: string, candidate: CodeCandidate): Payload {
  const files = registryFiles(candidate);
  const byPath = new Map<string, { path: string; content: string }>(), byInstall = new Map<string, { path: string; content: string }>();
  for (const file of files) {
    byPath.set(posix.normalize(file.path), file);
    const install = installPathOf(file);
    if (install) byInstall.set(install, file);
  }
  const declared = new Map<string, string | undefined>();
  const deps = isObject(candidate.json) ? stringList(candidate.json.dependencies) : [];
  for (const raw of deps) {
    const at = raw.indexOf("@", raw.startsWith("@") ? 1 : 0);
    declared.set(at > 0 ? raw.slice(0, at) : raw, at > 0 ? raw.slice(at + 1) : undefined);
  }
  return { slot, files, byPath, byInstall, declared };
}

const lookup = (map: ReadonlyMap<string, { path: string; content: string }>, base: string) => {
  for (const suffix of SUFFIXES) { const hit = map.get(`${base}${suffix}`); if (hit) return hit; }
  return undefined;
};

/** The part of a candidate the module system and the code check read: its registry item. */
export type CodeCandidate = Pick<CandidateRecord, "json">;

/**
 * What the module system and the code check read beyond the candidate: the gate's CertifyEnv satisfies it, and the
 * specimen certifier (library-source.ts) builds one from a consumer's own pins, so both run the same code check.
 */
export interface CodeEnv {
  readonly root: string;
  /** `designer:<slot-id>` → the live slot's sha-matching pinned candidate. */
  readonly pins: ReadonlyMap<string, { readonly candidate: CodeCandidate }>;
  /** Install path → the live Designer slots whose pinned candidate installs a file there. */
  readonly installers: ReadonlyMap<string, readonly string[]>;
  /** Pinned Writer copy: key → text. */
  readonly copy: ReadonlyMap<string, string>;
  /**
   * The composed Designer slots (FCR: a frames.* or sections.* slot with no reference adoptable in the selected style
   * and engine, whose contract fixture is the file and export of its own pinned, certified composition); the installed
   * Designer package's derived set (`designerComposedSlots`) when absent.
   */
  readonly composed?: ReadonlySet<string>;
}

/** One certification's module system: the primary candidate plus the pinned payloads it reaches. */
class Modules {
  readonly failures: Reason[] = [];
  private readonly cache = new Map<string, { exports: unknown }>();
  private readonly payloads = new Map<string, Payload>();
  constructor(private readonly primary: Payload, private readonly uses: ReadonlySet<string>, private readonly env: CodeEnv, private readonly host: Require) {}

  private fail(message: string) { if (!this.failures.some(item => item.message === message)) this.failures.push(reason("import", message)); }

  private pinnedPayload(slot: string): Payload | undefined {
    if (this.payloads.has(slot)) return this.payloads.get(slot);
    const pinned = this.env.pins.get(pinKey("designer", slot));
    const payload = pinned ? payloadOf(slot, pinned.candidate) : undefined;
    if (payload) this.payloads.set(slot, payload);
    return payload;
  }

  /** `@/<spec>` from `owner`: its own install paths, else a `uses` slot's pin, else (a failure for the primary) any pinned installer. */
  private alias(spec: string, owner: Payload): { payload: Payload; file: { path: string; content: string } } | undefined {
    const own = lookup(owner.byInstall, spec);
    if (own) return { payload: owner, file: own };
    const installers = SUFFIXES.flatMap(suffix => this.env.installers.get(`${spec}${suffix}`) ?? []);
    for (const slot of installers) {
      if (!this.uses.has(slot) && owner === this.primary) continue;
      const payload = this.pinnedPayload(slot);
      const file = payload && lookup(payload.byInstall, spec);
      if (payload && file) return { payload, file };
    }
    for (const slot of installers) {
      const payload = this.pinnedPayload(slot);
      const file = payload && lookup(payload.byInstall, spec);
      if (payload && file) {
        if (owner === this.primary) this.fail(`imports @/${spec} from slot ${slot}, which slot.json uses does not list`);
        return { payload, file };
      }
    }
    return undefined;
  }

  require(spec: string, from: { path: string }, owner: Payload): unknown {
    if (HOST_MODULES.has(spec)) return this.host(spec);
    if (spec.startsWith(".") || spec.startsWith("/")) {
      const base = posix.normalize(posix.join(posix.dirname(from.path), spec));
      const own = lookup(owner.byPath, base);
      if (own) return this.load(own, owner);
      const install = [...owner.byInstall.entries()].find(([, file]) => file === from)?.[0];
      const viaInstall = install ? lookup(owner.byInstall, posix.normalize(posix.join(posix.dirname(install), spec))) : undefined;
      if (viaInstall) return this.load(viaInstall, owner);
      throw new Error(`${from.path}: cannot resolve ${spec}`);
    }
    if (spec.startsWith("@/")) {
      const hit = this.alias(spec.slice(2), owner);
      if (hit) return this.load(hit.file, hit.payload);
      if (owner === this.primary) this.fail(`imports ${spec}, which neither the candidate nor a pinned slot installs`);
      throw new Error(`${from.path}: cannot resolve ${spec}`);
    }
    if (owner === this.primary) this.checkPackage(packageName(spec), owner);
    return this.host(spec);
  }

  /** A bare package the primary imports: declared in `dependencies` at an exact version equal to the installed one. */
  private checkPackage(name: string, owner: Payload) {
    if (!owner.declared.has(name)) return this.fail(`imports ${name}, which dependencies does not declare`);
    const want = owner.declared.get(name);
    if (!want || !EXACT.test(want)) return this.fail(`declares ${name}${want ? `@${want}` : ""} without an exact version`);
    const have = installedVersion(this.host, name);
    if (have !== want) this.fail(`declares ${name}@${want} but ${have ? `${have} is` : "none is"} installed`);
  }

  /**
   * Whether `spec`, imported by `from` of the primary, resolves without loading it (a code item's every import, the
   * dynamic ones too): a host module; a file the candidate ships; an `@/` path a `uses` slot's pin installs; a package
   * declared at an exact version equal to the installed one. Each miss is recorded as an import failure.
   */
  resolves(spec: string, from: { path: string }, owner: Payload): void {
    if (HOST_MODULES.has(spec)) return;
    if (spec.startsWith(".") || spec.startsWith("/")) {
      const base = posix.normalize(posix.join(posix.dirname(from.path), spec));
      if (lookup(owner.byPath, base)) return;
      const install = [...owner.byInstall.entries()].find(([, file]) => file === from)?.[0];
      if (install && lookup(owner.byInstall, posix.normalize(posix.join(posix.dirname(install), spec)))) return;
      return this.fail(`${from.path} imports ${spec}, which the candidate does not ship`);
    }
    if (spec.startsWith("@/")) {
      if (!this.alias(spec.slice(2), owner)) this.fail(`imports ${spec}, which neither the candidate nor a pinned slot installs`);
      return;
    }
    this.checkPackage(packageName(spec), owner);
  }

  load(file: { path: string; content: string }, owner: Payload): unknown {
    const id = `${owner.slot}\0${file.path}`;
    const cached = this.cache.get(id);
    if (cached) return cached.exports;
    if (/\.css$/i.test(file.path)) return {};
    if (ASSET.test(file.path)) return file.path;
    if (/\.json$/i.test(file.path)) return JSON.parse(file.content) as unknown;
    if (!CODE.test(file.path)) return file.content;
    const module = { exports: {} as unknown };
    this.cache.set(id, module);
    const code = transpile(file.path, file.content);
    const fn = new Function("exports", "require", "module", "__filename", "__dirname", code) as (e: unknown, r: (s: string) => unknown, m: unknown, f: string, d: string) => void;
    fn(module.exports, spec => this.require(spec, file, owner), module, file.path, posix.dirname(file.path));
    return module.exports;
  }
}

const isComponent = (value: unknown) => typeof value === "function" || (!!value && typeof value === "object" && "$$typeof" in value);

/**
 * The check this candidate is held to in its slot, whose contract is `contract` (registry-types.ts, the one table, and
 * the slot's class derived from `contract` and its layer), or why its type is unknown or not one the slot accepts.
 */
export function elementCheck(slot: SlotRecord, candidate: CandidateRecord, contract: Readonly<Record<string, unknown>>): ElementCheck | Reason {
  const item = candidate.json;
  try { return elementCheckOf(`${slot.id}/${candidate.name}`, isObject(item) ? item.type : undefined, slot.id.split(".")[0], contract); }
  catch (error) { return reason(error instanceof RegistryTypeError ? "registry-type" : "invalid", (error as Error).message); }
}

/**
 * Fit of an interactive backdrop (foundry-build-0048 A4, U23): the descriptor `meta.backdrop` rides on
 * the surface's own code candidate, which still mounts and renders like any other. It fits only when
 * the slot contract (the fixture) declares a backdrop-placed slot, and its descriptor names an adopted
 * component with every param inside that record's schema (`interactiveBackdropMetaIssues`, the same
 * check submit and compile run). No `meta.backdrop`, nothing to fit.
 */
function backdropFit(slot: SlotRecord, candidate: CandidateRecord, contract: Readonly<Record<string, unknown>>): Reason[] {
  // Pin-side, on every slot and independent of the validator: an interactive backdrop in the candidate's
  // own preview props would reach the mount unjudged, so it is refused (meta.backdrop is the only channel).
  const preview = previewInteractiveBackdropIssues(candidate.json);
  if (preview.length) return preview.map(message => reason("invalid", `slot ${slot.id}: ${message}`));
  return interactiveBackdropMetaIssues(candidate.json, slot.id, contract).map(message => reason("invalid", `slot ${slot.id}: ${message}`));
}

/**
 * Fit of a filled figure (U23 review N1): a figure the candidate's preview fills ships with its text
 * alternative present and non-blank, against the slot contract (`previewFigureAltIssues`, the same check
 * submit and install run).
 */
function figureAltFit(slot: SlotRecord, candidate: CandidateRecord, contract: Readonly<Record<string, unknown>>): Reason[] {
  return previewFigureAltIssues(candidate.json, slot.id, contract).map(message => reason("invalid", `slot ${slot.id}: ${message}`));
}

/**
 * Fit failures of an element candidate against `contract` (its fixture): its backdrop, if any, its figures' alt, and
 * the check its registry type is held to (registry-types.ts): a render for a visual item, the code check for a hook or
 * lib, nothing for an item that mounts no component; empty when it fits.
 */
export function certifyElement(slot: SlotRecord, candidate: CandidateRecord, contract: Readonly<Record<string, unknown>>, env: CertifyEnv): Reason[] {
  const check = elementCheck(slot, candidate, contract);
  const fit = typeof check !== "string" ? [check] : !checkMountsFixture(check) ? [] : check === "render" ? renderFit(slot, candidate, contract, env) : codeFit(slot.id, usesOf(slot), candidate, contract, env, check);
  return [...backdropFit(slot, candidate, contract), ...figureAltFit(slot, candidate, contract), ...fit];
}

/**
 * Whether the element certifier mounts `slot`'s contract fixture (owner D1, R01.3): for any candidate when every item
 * the slot accepts is held to a check that mounts it (`slotAlwaysMountsFixture`: component, section, frame, hook and lib
 * slots), else when one of the slot's own candidates is (`elementCheck`, the certifier's own choice, read through the
 * same `checkMountsFixture`). A token or asset slot holding only themes, fonts, files or SVGs mounts none, so needs none.
 */
export function elementMountsFixture(slot: SlotRecord, contract: Readonly<Record<string, unknown>>): boolean {
  if (slotAlwaysMountsFixture(slot.id.split(".")[0], contract)) return true;
  return slot.candidates.some(candidate => {
    const check = elementCheck(slot, candidate, contract);
    return typeof check === "string" && checkMountsFixture(check);
  });
}

/** What every fixture-held check (the render and the code check) starts from: the fixture, its inputs and the file it names. */
type FixtureStart = { readonly reasons: Reason[]; readonly fixture: ContractFixture; readonly primary: Payload; readonly entry: { path: string; content: string }; readonly modules: Modules; readonly host: Require };
/** The slots a slot's slot.json `uses` names, whose pins its candidates may import through `@/`. */
const usesOf = (slot: SlotRecord): readonly string[] => stringList((slotDoc(slot) ?? {}).uses);
function fixtureStart(slotId: string, uses: readonly string[], candidate: CodeCandidate, contract: Readonly<Record<string, unknown>>, env: CodeEnv): FixtureStart | Reason[] {
  if (contract.fixture === undefined) return [reason("no-fixture", `slot ${slotId} declares no contract fixture (slot.json contract.fixture)`)];
  const invalid = contractFixtureIssues(contract);
  if (invalid.length) return invalid.map(issue => reason("fixture", issue.message));
  const fixture = contract.fixture as ContractFixture;
  const reasons: Reason[] = [];
  for (const key of fixture.inputs?.copy ?? []) if (!env.copy.has(key)) reasons.push(reason("copy", `fixture input copy ${key} is no pinned Writer key`));
  for (const id of fixture.inputs?.slots ?? []) if (!env.pins.has(pinKey("designer", id))) reasons.push(reason("fixture", `fixture input slot ${id} is no pinned Designer slot`));
  const primary = payloadOf(slotId, candidate);
  const entry = primary.byPath.get(posix.normalize(fixture.fixtures.file));
  if (!entry) return [...reasons, reason("fixture", `the candidate ships no ${fixture.fixtures.file}, which the contract fixture mounts`)];
  reasons.push(...composedFixtureFit(slotId, fixture, env));
  const host = hostRequire(env.root);
  return { reasons, fixture, primary, entry, modules: new Modules(primary, new Set(uses), env, host), host };
}

/**
 * FCR: a composed slot's contract fixture is the file and export of its own pinned composition, so once the slot is
 * pinned the file the fixture mounts is one that pin ships (a fixture pointing anywhere else judges no composition).
 * Before its first pin the fixture is the one the create loop declared, and the candidate must ship it (fixtureStart).
 */
function composedFixtureFit(slotId: string, fixture: ContractFixture, env: CodeEnv): Reason[] {
  if (!(env.composed ?? designerComposedSlots()).has(slotId)) return [];
  const pinned = env.pins.get(pinKey("designer", slotId));
  if (!pinned || payloadOf(slotId, pinned.candidate).byPath.has(posix.normalize(fixture.fixtures.file))) return [];
  return [reason("fixture", `composed slot ${slotId}'s contract fixture mounts ${fixture.fixtures.file}, which its pinned composition does not ship`)];
}

const VOID_ELEMENTS = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
/** Elements (and roles) that scope a `<header>` out of the banner landmark (HTML-AAM: sectioning content and main). */
const BANNER_SCOPING = new Set(["article", "aside", "main", "nav", "section"]);
const BANNER_SCOPING_ROLES = new Set(["article", "complementary", "main", "navigation", "region"]);
const roleOf = (attributes: string): string | undefined => /\brole\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attributes)?.slice(1).find(value => value !== undefined)?.trim().split(/\s+/)[0]?.toLowerCase();

/**
 * The banner landmarks of rendered markup (`role="banner"`, or a `<header>` with no explicit role outside sectioning
 * content and main), and how many of them nest inside another banner. The frame standard admits frames as parts
 * (frames.site-shell places frames.site-header), and no banner landmark may nest inside another.
 */
export function bannerLandmarks(markup: string): { readonly banners: number; readonly nested: number } {
  const stack: { readonly tag: string; readonly banner: boolean; readonly scoping: boolean }[] = [];
  let banners = 0, nested = 0;
  for (const match of markup.matchAll(/<(\/?)([a-zA-Z][\w:-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g)) {
    const [, closing, rawTag, attributes = ""] = match;
    const tag = rawTag!.toLowerCase();
    if (closing) {
      const at = stack.map(item => item.tag).lastIndexOf(tag);
      if (at >= 0) stack.length = at;
      continue;
    }
    const role = roleOf(attributes);
    const scoped = stack.some(item => item.scoping);
    const banner = role === "banner" || (role === undefined && tag === "header" && !scoped);
    if (banner) { banners += 1; if (stack.some(item => item.banner)) nested += 1; }
    if (VOID_ELEMENTS.has(tag) || attributes.trimEnd().endsWith("/")) continue;
    stack.push({ tag, banner, scoping: BANNER_SCOPING.has(tag) || (role !== undefined && BANNER_SCOPING_ROLES.has(role)) });
  }
  return { banners, nested };
}

const exportedFunctions = (exports: unknown): string[] => (isObject(exports) || typeof exports === "function" ? Object.keys(exports as object).filter(key => typeof (exports as Record<string, unknown>)[key] === "function") : []);

/**
 * The code check of a hook or lib item (HOOK-SLOT), which is never rendered: held to the contract fixture like a
 * visual item (the file it names is shipped and the export it names is a function, a `use*` one for a hook); it ships
 * only the file types its kind may (`CODE_ITEM_FILE_TYPES`); every code file loads in the certifier's module system
 * and every module it imports, static or dynamic, resolves (a package only when declared at an exact version equal to
 * the installed one); every `registry:hook` file exports a function named `use*`, every lib file at least one function.
 */
function codeFit(slotId: string, uses: readonly string[], candidate: CodeCandidate, contract: Readonly<Record<string, unknown>>, env: CodeEnv, check: "hook" | "lib"): Reason[] {
  const start = fixtureStart(slotId, uses, candidate, contract, env);
  if (Array.isArray(start)) return start;
  const { reasons, fixture, primary, entry, modules } = start;
  const type = check === "hook" ? "registry:hook" : "registry:lib";
  const allowed = CODE_ITEM_FILE_TYPES[check];
  for (const file of primary.files) {
    if (typeof file.type !== "string" || !allowed.includes(file.type)) reasons.push(reason("hook", `a ${type} item ships ${file.path} as ${typeof file.type === "string" ? file.type : "no type"}; it may ship only ${allowed.join(" and ")} files, and is never rendered`));
  }
  const quiet = { error: console.error, warn: console.warn };
  console.error = () => {}; console.warn = () => {};
  try {
    for (const file of primary.files) {
      if (!CODE.test(file.path)) continue;
      let exports: unknown;
      try { exports = modules.load(file, primary); }
      catch (error) { reasons.push(reason("import", `loading ${file.path} throws: ${firstLine(error)}`)); continue; }
      for (const spec of importSpecifiers(file.path, file.content)) modules.resolves(spec, file, primary);
      const functions = exportedFunctions(exports);
      if (file.type === "registry:hook" && !functions.some(name => HOOK_NAME.test(name))) reasons.push(reason("hook", `${file.path} exports no function named use*, so it is no hook`));
      if (file.type === "registry:lib" && !functions.length) reasons.push(reason("hook", `${file.path} exports no function`));
      if (file === entry) {
        const name = fixture.fixtures.export;
        const value = isObject(exports) ? (exports as Record<string, unknown>)[name] : undefined;
        if (typeof value !== "function") reasons.push(reason("fixture", `${entry.path} exports no function ${name}, which the contract fixture names`));
        else if (check === "hook" && !HOOK_NAME.test(name)) reasons.push(reason("fixture", `the contract fixture names ${name}, which is no use* hook export`));
      }
    }
  } finally { console.error = quiet.error; console.warn = quiet.warn; }
  return [...reasons, ...modules.failures];
}

/**
 * The code check of a hook or lib item outside the gate (the specimen certifier, library-source.ts `certifyCandidate`):
 * the same `codeFit`, over a consumer's own pins (`env`), for a slot whose `uses` are given. The caller has already
 * read the check from the table for this slot (`elementCheckOf`), so `check` is the one its slot accepts.
 */
export function certifyCode(input: { readonly slot: string; readonly uses: readonly string[]; readonly item: unknown; readonly contract: Readonly<Record<string, unknown>>; readonly env: CodeEnv; readonly check: "hook" | "lib" }): Reason[] {
  return codeFit(input.slot, input.uses, { json: input.item }, input.contract, input.env, input.check);
}

/** Every module specifier a code file imports or re-exports, static or dynamic (`import()`, `require()`). */
function importSpecifiers(path: string, source: string): string[] {
  const info = ts.preProcessFile(source, true, true);
  return CODE.test(path) ? [...new Set(info.importedFiles.map(item => item.fileName))] : [];
}

/** Render fit of an element candidate against `contract` (its fixture); empty when it renders. */
function renderFit(slot: SlotRecord, candidate: CandidateRecord, contract: Readonly<Record<string, unknown>>, env: CertifyEnv): Reason[] {
  const start = fixtureStart(slot.id, usesOf(slot), candidate, contract, env);
  if (Array.isArray(start)) return start;
  const { reasons, fixture, primary, entry, modules, host } = start;
  const quiet = { error: console.error, warn: console.warn };
  console.error = () => {}; console.warn = () => {};
  try {
    let exports: Record<string, unknown>;
    try { exports = modules.load(entry, primary) as Record<string, unknown>; }
    catch (error) { return [...reasons, ...modules.failures, reason("render", `loading ${entry.path} throws: ${firstLine(error)}`)]; }
    const name = fixture.fixtures.export;
    const Component = exports?.[name] ?? (name === "default" ? exports : undefined);
    if (!isComponent(Component)) return [...reasons, ...modules.failures, reason("render", `${entry.path} exports no component ${name}`)];
    const React = host("react") as typeof import("react");
    const server = host("react-dom/server") as typeof import("react-dom/server");
    const tree = (value: unknown, key?: string): unknown => {
      if (Array.isArray(value)) return value.map((item, index) => tree(item, String(index)));
      if (!isObject(value)) return value;
      const keys = Object.keys(value);
      if (keys.length === 1 && keys[0] === "$copy" && typeof value.$copy === "string") {
        const text = env.copy.get(value.$copy);
        if (text === undefined) reasons.push(reason("copy", `fixture copy ${value.$copy} is no pinned Writer key`));
        return text ?? `[missing copy ${value.$copy}]`;
      }
      if ("$element" in value || "$asset" in value) throw new Error("a fixture tree mounts no other slot or asset");
      if (typeof value.$component === "string") {
        const part = componentOf(value.$component, exports, spec => modules.require(spec, entry, primary));
        if (!isComponent(part)) throw new Error(`fixture tree names ${value.$component}, which is no component`);
        const props = tree(value.props ?? {}) as Record<string, unknown>;
        const children = value.children === undefined ? [] : Array.isArray(value.children) ? value.children.map(item => tree(item)) : [tree(value.children)];
        return React.createElement(part as never, key === undefined ? props : { ...props, key }, ...(children as never[]));
      }
      return Object.fromEntries(Object.entries(value).map(([entryKey, item]) => [entryKey, tree(item)]));
    };
    let markup: string;
    try { markup = server.renderToString(React.createElement(Component as never, tree(fixture.fixtures.props) as never)); }
    catch (error) { return [...reasons, ...modules.failures, reason("render", `rendering ${name} with the contract fixture throws: ${firstLine(error)}`)]; }
    if (!markup.trim()) reasons.push(reason("render", `${name} renders nothing with the contract fixture`));
    if (slot.id.startsWith("frames.") && bannerLandmarks(markup).nested) reasons.push(reason("render", `${name} renders a banner landmark nested inside another banner with the contract fixture; a frame placing a frame keeps exactly one banner`));
    return [...reasons, ...modules.failures];
  } finally { console.error = quiet.error; console.warn = quiet.warn; }
}

function componentOf(name: string, exports: Record<string, unknown>, require: (spec: string) => unknown): unknown {
  if (Object.hasOwn(exports, name)) return exports[name];
  const part = dependencyPart(name);
  if (!part) return undefined;
  const module = require(part.module) as Record<string, unknown> | undefined;
  return module?.[part.export];
}

const firstLine = (error: unknown) => (error instanceof Error ? error.message : String(error)).split("\n")[0]!.slice(0, 240);

