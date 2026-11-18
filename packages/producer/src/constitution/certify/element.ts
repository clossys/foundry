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
 * A candidate whose specimen mounts no component (a theme, a font, an asset) needs no fixture.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, posix } from "node:path";
import ts from "typescript";
import { specimenKindOf } from "@clossys/publisher/specimen";
import { contractFixtureIssues, type ContractFixture } from "../../records/slot-model/contract-fixture.js";
import { dependencyPart } from "../../specimen/specimen-tree.js";
import { installPathOf, isObject, registryFiles, slotDoc, stringList } from "../checks/shared.js";
import type { CandidateRecord, SlotRecord } from "../types.js";
import { pinKey, type CertifyEnv } from "./env.js";
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

function payloadOf(slot: string, candidate: CandidateRecord): Payload {
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

/** One certification's module system: the primary candidate plus the pinned payloads it reaches. */
class Modules {
  readonly failures: Reason[] = [];
  private readonly cache = new Map<string, { exports: unknown }>();
  private readonly payloads = new Map<string, Payload>();
  constructor(private readonly primary: Payload, private readonly uses: ReadonlySet<string>, private readonly env: CertifyEnv, private readonly host: Require) {}

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
    const name = packageName(spec);
    if (owner === this.primary) {
      if (!owner.declared.has(name)) this.fail(`imports ${name}, which dependencies does not declare`);
      else {
        const want = owner.declared.get(name);
        if (!want || !EXACT.test(want)) this.fail(`declares ${name}${want ? `@${want}` : ""} without an exact version`);
        else {
          const have = installedVersion(this.host, name);
          if (have !== want) this.fail(`declares ${name}@${want} but ${have ? `${have} is` : "none is"} installed`);
        }
      }
    }
    return this.host(spec);
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

/** Whether the specimen of this candidate mounts a component (`visual`), or why its kind is unknown. */
export function mountsComponent(slot: SlotRecord, candidate: CandidateRecord): boolean | Reason {
  const item = candidate.json;
  try { return specimenKindOf({ id: `${slot.id}/${candidate.name}`, kind: isObject(item) ? item.type : undefined, layer: slot.id.split(".")[0] }) === "visual"; }
  catch (error) { return reason("invalid", (error as Error).message); }
}

/**
 * Fit of an interactive backdrop (foundry-build-0048 A4): a descriptor `meta.backdrop` over a Foundry
 * component, no code, so there is nothing of the consumer's to mount. Its envelope and param schema are
 * already judged by validateCandidate (certifyFit runs it first); what is left is the slot: it fits
 * only when the contract lists the component under `interactive.components`.
 */
function certifyInteractiveBackdrop(slot: SlotRecord, backdrop: unknown, contract: Readonly<Record<string, unknown>>): Reason[] {
  const allowed = isObject(contract.interactive) ? stringList(contract.interactive.components) : [];
  const component = isObject(backdrop) ? backdrop.component : undefined;
  if (typeof component === "string" && allowed.includes(component)) return [];
  return [reason("invalid", `slot ${slot.id} contract.interactive lists ${allowed.join(", ") || "no interactive backdrop"}, not ${JSON.stringify(component ?? null)}`)];
}

/** Fit failures of an element candidate against `contract` (its fixture); empty when it renders. */
export function certifyElement(slot: SlotRecord, candidate: CandidateRecord, contract: Readonly<Record<string, unknown>>, env: CertifyEnv): Reason[] {
  const mounts = mountsComponent(slot, candidate);
  if (mounts !== true && mounts !== false) return [mounts];
  const meta = isObject(candidate.json) ? candidate.json.meta : undefined;
  if (isObject(meta) && Object.hasOwn(meta, "backdrop")) return certifyInteractiveBackdrop(slot, meta.backdrop, contract);
  if (!mounts) return [];
  if (contract.fixture === undefined) return [reason("no-fixture", `slot ${slot.id} declares no contract fixture (slot.json contract.fixture)`)];
  const invalid = contractFixtureIssues(contract);
  if (invalid.length) return invalid.map(issue => reason("fixture", issue.message));
  const fixture = contract.fixture as ContractFixture;
  const reasons: Reason[] = [];
  for (const key of fixture.inputs?.copy ?? []) if (!env.copy.has(key)) reasons.push(reason("copy", `fixture input copy ${key} is no pinned Writer key`));
  for (const id of fixture.inputs?.slots ?? []) if (!env.pins.has(pinKey("designer", id))) reasons.push(reason("fixture", `fixture input slot ${id} is no pinned Designer slot`));
  const primary = payloadOf(slot.id, candidate);
  const entry = primary.byPath.get(posix.normalize(fixture.fixtures.file));
  if (!entry) return [...reasons, reason("fixture", `the candidate ships no ${fixture.fixtures.file}, which the contract fixture mounts`)];
  const doc = slotDoc(slot) ?? {};
  const host = hostRequire(env.root);
  const modules = new Modules(primary, new Set(stringList(doc.uses)), env, host);
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

