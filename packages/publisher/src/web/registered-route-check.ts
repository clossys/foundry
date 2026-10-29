import * as fs from "node:fs/promises";
import { constants } from "node:fs";
import { join, resolve, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { resolve as resolveProfile, libraryHash, runtimeHash, emittedTokenProperties, checkConsumerRuntimeManifest } from "@clossys/designer/catalog";
import type { CompositeEngineInput, ConsumerRuntimeManifest } from "@clossys/designer/catalog";
import { deriveRouteRuntimeBinding, selectedRouteRuntimeManifest } from "../core/route-runtime.js";
import { consumerDogfoodSources, parseConsumerDogfoodContract, runConsumerDogfood } from "@clossys/designer/catalog/dogfood/node";
import { registeredDesignerQuerySources } from "./registered-route-query-source.js";
export { registeredDesignerQuerySources } from "./registered-route-query-source.js";
import { materializeRegisteredDesignerRoute } from "./registered-route-query.js";
import type { RegisteredDesignerQuery } from "./registered-route-query.js";
import type { RouteRuntimeMaterialization } from "../core/route-runtime.js";
import type { ConsumerInstanceLibrary } from "../core/instance-binding.js";
import type { InstanceRegistries } from "../core/instance-binding.js";
import type { PublisherPlanDraft } from "../planning/plan.js";
import type { PublisherPlanVersion } from "../planning/change-set.js";
import { projectRouteRegistry, routeProviderMount, routeServerLoader, routeSourcePath } from "../core/route-registry.js";
import type { RouteProviderMount, LegacyRouteRegistry as RouteRegistry, RouteSourceExport } from "../core/route-registry.js";
import { emitRegisteredRouteAdapter, emitRegisteredRoutePage, emitRegisteredRouteRegistryModule, registeredRouteRegistryPlacement } from "./registered-route-source.js";
export { emitCompleteRoutePage, emitRegisteredRouteAdapter, emitRegisteredRoutePage, emitRegisteredRouteRegistryModule, registeredRouteRegistryPlacement } from "./registered-route-source.js";
import { isCurrentRegisteredRouteSourceEvidence, recordRegisteredRouteSourceEvidence, registeredRouteSourceBootstrap } from "../core/route-source-evidence.js";
import type { RegisteredRouteSourceBootstrap, RegisteredRouteSourceEvidence } from "../core/route-source-evidence.js";
import { beginRegisteredRouteNodeTransaction, issueRegisteredRouteNodeCurrent } from "../core/route-node-current.js";
import { runtimeSnapshot } from "@clossys/designer/catalog";
import type { PlainRegisteredRouteProjection } from "../core/route-projection.js";
import type { RegisteredRouteRuntime, RegisteredRouteHeaderActions } from "./registered-route-binding.js";
const exec = promisify(execFile);
const sha = (contents: string): `sha256:${string}` => `sha256:${createHash("sha256").update(contents).digest("hex")}`;
async function immutableSourceIdentity(root: string, files: readonly { readonly file: string; readonly content: string }[]): Promise<RegisteredRouteSourceEvidence["identity"]> {
  const [{ stdout: head }, { stdout: tree }, { stdout: directory }] = await Promise.all([
    exec("git", ["-C", root, "rev-parse", "--verify", "HEAD"]), exec("git", ["-C", root, "rev-parse", "--verify", "HEAD^{tree}"]), exec("git", ["-C", root, "rev-parse", "--show-toplevel"]),
  ]);
  if (!/^[a-f0-9]{40}$/.test(head.trim()) || !/^[a-f0-9]{40}$/.test(tree.trim())) throw new Error("Exact immutable Git source identity unavailable");
  for (const file of files) {
    const absolute = resolve(root, file.file), local = relative(root, absolute);
    // External installed library closures are bound independently by the selected
    // runtime descriptors. Every consumer-authored source must match this tree.
    if (local.startsWith("..") || local.startsWith("/")) continue;
    const path = relative(directory.trim(), absolute).split("\\").join("/");
    const { stdout } = await exec("git", ["-C", directory.trim(), "ls-tree", head.trim(), "--", path]);
    const blob = /^100(?:644|755) blob ([a-f0-9]{40})\t/.exec(stdout)?.[1];
    const bytes = Buffer.from(file.content), actual = createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
    if (!blob || blob !== actual) throw new Error("Consumer source differs from the immutable artifact tree");
  }
  return { kind: "git", head: head.trim(), tree: tree.trim() };
}

/** Version 1 is owned by Designer and cannot establish route closure. This is a
 * separate, strict source-discovery mode using that same consumer scanner. */
export interface RegisteredRouteContract {
  readonly version: 2;
  readonly sources: Readonly<Record<string, string>>;
  /** `file` is the finite JSON control input the checker reads, kept outside the source
   * tree; `module` is the typed registry generated pages import, under it. */
  readonly registry: { readonly file: string; readonly export: "default"; readonly module: string };
  readonly routeRoots: readonly { readonly directory: string; readonly basePath: string }[];
}
export interface RegisteredRouteStyling { readonly engine: CompositeEngineInput; readonly manifest: ConsumerRuntimeManifest; readonly designer?: Readonly<Record<string, { readonly query: RegisteredDesignerQuery; readonly instanceLibrary: ConsumerInstanceLibrary }>> }
export interface RegisteredRouteFinding { readonly code: "RR1" | "RR2" | "RR3" | "RR4" | "RR5"; readonly file: string; readonly message: string }
const fields = (v: object, allowed: readonly string[]) => Object.keys(v).sort().join(",") === [...allowed].sort().join(",");
export function parseRegisteredRouteContract(value: unknown): RegisteredRouteContract {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Route contract must be an object");
  const c = value as RegisteredRouteContract;
  if (!fields(c, ["version", "sources", "registry", "routeRoots"]) || c.version !== 2 || !c.registry || !fields(c.registry, ["file", "export", "module"]) || c.registry.export !== "default" || !Array.isArray(c.routeRoots) || !c.routeRoots.length) throw new Error("Strict version 2 registry source and nonempty route roots required");
  registeredRouteRegistryPlacement(c.registry.file, c.registry.module);
  // Reuse HOST1's exact source-boundary validation, without weakening v1 fields.
  parseConsumerDogfoodContract({ version: 1, sources: c.sources, pages: ["contract-validation.tsx"] });
  if (Object.keys(c.sources).some(module => module === "@clossys/publisher" || module.startsWith("@clossys/publisher/"))) throw new Error("Publisher registered execution source cannot be remapped by the consumer");
  const roots = new Set<string>();
  for (const root of c.routeRoots as RegisteredRouteContract["routeRoots"]) {
    if (!root || !fields(root, ["directory", "basePath"]) || !routeSourcePath(root.directory) || !/^\/(?:[^/?#\\]+\/?)*$/.test(root.basePath) || root.basePath.includes("//") || root.basePath.split("/").some(p => p === "." || p === "..") || roots.has(root.directory)) throw new Error("Unique consumer route directories and canonical base paths required");
    roots.add(root.directory);
  }
  return c;
}
async function read(root: string, path: string): Promise<string> {
  if (!routeSourcePath(path)) throw new Error("Consumer-relative source path required");
  let at = root;
  for (const part of path.split("/")) { at = join(at, part); if ((await fs.lstat(at)).isSymbolicLink()) throw new Error("Route source symlinks are refused"); }
  const h = await fs.open(at, constants.O_RDONLY | constants.O_NOFOLLOW);
  try { if (!(await h.stat()).isFile()) throw new Error("Route source must be a regular file"); return new TextDecoder("utf-8", { fatal: true }).decode(await h.readFile()); }
  finally { await h.close(); }
}
/** Recognize a closed redirect-only form from real source. Anything more complex
 * remains executable/unsupported and needs registration; names never exempt it. */
export function redirectOnlyRoute(source: string): boolean {
  return /^\s*import\s*\{\s*(?:redirect|permanentRedirect)(?:\s+as\s+([A-Za-z_$][\w$]*))?\s*\}\s*from\s*["']next\/navigation["'];?\s*export\s+default\s+(?:async\s+)?function\s+[A-Za-z_$][\w$]*\s*\(\s*\)\s*\{\s*(?:return\s+)?(?:redirect|permanentRedirect|[A-Za-z_$][\w$]*)\(\s*["'][^"'\n]+["']\s*\);?\s*\}\s*$/.test(source) && (() => {
    const imported = /\{\s*(redirect|permanentRedirect)(?:\s+as\s+([A-Za-z_$][\w$]*))?\s*\}/.exec(source)!;
    const called = /\{\s*(?:return\s+)?([A-Za-z_$][\w$]*)\(/.exec(source.slice(source.indexOf("export default")));
    return called?.[1] === (imported[2] ?? imported[1]);
  })();
}
/** Only a closed document wrapper is classified as non-page infrastructure.
 * Any visual helper, additional component or executable wrapper stays refused. */
export function documentOnlyLayout(source: string): boolean {
  const prefix = source.replace(/^\s*(?:import\s+type\s*\{\s*ReactNode\s*\}\s*from\s*["']react["'];?\s*)?/, "");
  return /^\s*export\s+default\s+function\s+[A-Za-z_$][\w$]*\(\s*\{\s*children\s*\}\s*(?::\s*\{\s*children\s*:\s*(?:React\.)?ReactNode\s*;?\s*\})?\s*\)\s*\{\s*return\s*(?:children|\(?\s*<html(?:\s+lang=["'][a-zA-Z-]+["'])?>\s*<body>\s*\{children\}\s*<\/body>\s*<\/html>\s*\)?)\s*;?\s*\}\s*$/.test(prefix);
}
const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
/** The exact consumer-relative file a relative specifier names from `from`, or
 * undefined. No extension or index is inferred: an extensionless specifier resolves
 * by resolver order (a sibling `.js` or `.tsx` can win), so it names no one file. */
function relativeSpecifierFile(from: string, specifier: string): string | undefined {
  if (!/^\.\.?\//.test(specifier)) return undefined;
  const parts = from.split("/"); parts.pop();
  for (const part of specifier.split("/")) {
    if (part === "..") { if (!parts.length) return undefined; parts.pop(); }
    else if (part === "." || !part) return undefined;
    else parts.push(part);
  }
  return parts.join("/");
}
/** Recognize the one closed nonvisual provider module a registration names: its
 * single export returns exactly the registered original provider around children,
 * with allowlisted plain prop values, and the module renders no markup anywhere.
 *
 * Threat model: no code path in the module can reach a function value that did not
 * come from an allowlisted import. The module is parsed as a closed grammar with a
 * binding table, never matched as a set of refused patterns:
 * - value imports are exactly the registered component from its registered module and
 *   plain named hooks (`use*`, also as imported) from the route's registered runtime
 *   module by its exact path; any other import is type-only, so erased;
 * - every name (import, export function, `children`, body binding) is bound once, so
 *   no hook is ever shadowed or rebound;
 * - the one function's body is only `const` bindings, each initialized either by a
 *   registered hook call (with no argument, or only `data` for a loader route),
 *   or by a member read rooted at an earlier body binding; so nothing read from inputs, from a hook result,
 *   from a global or from another import is ever called;
 * - each mounted prop is a literal or a member read rooted at a body binding. */
function nonvisualRouteProvider(source: string, file: string, runtime: string | undefined, mount: RouteProviderMount, known: { readonly module: string; readonly component: string; readonly props: readonly string[] }, hasLoader = false): boolean {
  const id = "[A-Za-z_$][\\w$]*", component = escapeRegExp(known.component);
  const module = source.replace(/^\s*["']use client["'];?/, "");
  // An escape makes source text differ from the name it spells: `chil\u0064ren` is
  // `children`, `\u0057holeStudioProvider` is the provider and the key
  // `"inner\x48TML"` is "innerHTML", and so are the octal, line-continuation and
  // identity forms. No parser ships at runtime, so rather than decode, the module may
  // hold no backslash at all (comments included); every raw-text check below then
  // reads the names and keys the module actually resolves.
  if (module.includes("\\")) return false;
  // Direct eval can rebind `children` from computed text no check here can read.
  if (/(?<![\w$])eval(?![\w$])/.test(module)) return false;
  // Imperative or element-factory markup is never nonvisual, wherever it appears.
  if (/\b(?:createElement|cloneElement|createPortal|jsxs?|jsxDEV|dangerouslySetInnerHTML|innerHTML|outerHTML|insertAdjacentHTML|document)\b/.test(module)) return false;
  // Computed access reaches a property by text that check never reads
  // (`globalThis["docu" + "ment"]`, directly or through an alias). The global
  // object and the reflection, property-definition and code-building primitives are
  // refused by name...
  if (/(?<![\w$])(?:globalThis|window|self|global|Reflect|Object|Function)(?![\w$])/.test(module)) return false;
  // ...and every bracket holds only a plain string literal, which that check reads: a
  // member key on any receiver, a computed object key and an array literal alike. Only
  // a declaration's destructuring pattern binds names here rather than reading them, and
  // a bracket nested inside one (a default value) is still read on its own.
  for (const [, before, key] of module.matchAll(/([\w$]*)\s*\[([^\][]*)/g)) {
    if (/^(?:const|let|var)$/.test(before!)) continue;
    if (!/^\s*(?:"[^"\n]*"|'[^'\n]*')?\s*$/.test(key!)) return false;
  }
  // One unaliased import of the registered component from its original module, used only by the mount.
  const imports = module.match(new RegExp(`import\\s*\\{\\s*${component}\\s*\\}\\s*from\\s*["']${escapeRegExp(known.module)}["'];?`, "g")) ?? [];
  if (imports.length !== 1 || (module.match(new RegExp(`(?<![\\w$])${component}(?![\\w$])`, "g")) ?? []).length !== 3) return false;
  if ((module.match(/(?<![\w$])export(?![\w$])/g) ?? []).length !== 1) return false;
  // The module grammar is an allowlist, not a list of refused operations: import
  // declarations, then the one exported function, whose body (below) only binds reads.
  // No module-level statement runs anywhere else. Each import is read into the binding
  // table: a value import is the registered component or a registered runtime hook.
  const quoted = `(?:"[^"\\n]*"|'[^'\\n]*')`, hookName = /^use[A-Z][\w$]*$/;
  const declaration = new RegExp(`\\s*import\\s+(type\\s+)?(?:(${id})|\\*\\s*as\\s+(${id})|\\{([^{}]*)\\})\\s*from\\s*(${quoted})\\s*;`, "y");
  const taken = new Set<string>(hasLoader ? ["children", "data"] : ["children"]), hooks = new Set<string>();
  const bind = (name: string) => { if (taken.has(name)) return false; taken.add(name); return true; };
  let at = 0;
  for (let match = declaration.exec(module); match; declaration.lastIndex = at, match = declaration.exec(module)) {
    at = declaration.lastIndex;
    const [, typeOnly, defaultName, namespace, list, specifier] = match;
    const elements = list === undefined ? [] : list.split(",").map(part => part.trim());
    if (list !== undefined && elements.at(-1) === "") elements.pop();
    const names = elements.map(part => new RegExp(`^(${id})(?:\\s+as\\s+(${id}))?$`).exec(part));
    if (names.some(name => !name) || list !== undefined && !names.length) return false;
    const locals = [defaultName, namespace, ...names.map(name => name![2] ?? name![1])].filter((name): name is string => name !== undefined);
    if (!locals.every(bind)) return false;
    if (typeOnly) continue;
    const from = specifier!.slice(1, -1);
    if (from === known.module && names.length === 1 && !names[0]![2] && names[0]![1] === known.component) continue;
    // Hooks only from the route's registered runtime module, by its exact path.
    if (list === undefined || runtime === undefined || relativeSpecifierFile(file, from) !== runtime) return false;
    for (const name of names) { if (!hookName.test(name![1]!) || !hookName.test(name![2] ?? name![1]!)) return false; hooks.add(name![2] ?? name![1]!); }
  }
  const rest = module.slice(at);
  if (!/^\s*export\s/.test(rest)) return false;
  const head = mount.source.export === "default" ? `export\\s+default\\s+function(?:\\s+(${id}))?` : `export\\s+function\\s+(${escapeRegExp(mount.source.export)})`;
  // Loader data is the only additional provider input; a named type keeps its
  // consumer-owned payload contract explicit without opening arbitrary props.
  const parameters = hasLoader
    ? `\\{\\s*children\\s*,\\s*data\\s*\\}\\s*:\\s*\\{\\s*(?:readonly\\s+)?children\\s*:\\s*(?:React\\.)?ReactNode\\s*;\\s*(?:readonly\\s+)?data\\s*:\\s*${id}\\s*;?\\s*\\}`
    : `\\{\\s*children\\s*\\}\\s*(?::\\s*\\{\\s*children\\s*:\\s*(?:React\\.)?ReactNode\\s*;?\\s*\\})?`;
  const shape = new RegExp(`^\\s*${head}\\s*\\(\\s*${parameters}\\s*\\)\\s*\\{([\\s\\S]*?)(return\\s*<${component}((?:\\s+${id}=(?:\\{[^{}]*\\}|"[^"\\n]*"))*)\\s*>\\s*\\{children\\}\\s*<\\/${component}\\s*>\\s*;?)\\s*\\}\\s*$`).exec(rest);
  if (!shape) return false;
  const [, exported, body, mountText, attributes] = shape;
  if (exported !== undefined && !bind(exported)) return false;
  if (/(?<![\w$])(?:return|children)(?![\w$])/.test(body!)) return false;
  // The body is only `const` bindings, so nothing in it calls a method on, assigns to
  // (plain, compound, logical, `++`/`--`) or deletes from a value reached through its
  // inputs, by alias, destructuring or a nested function. Each binding is a new name or
  // a flat object/array pattern of new names, initialized by exactly one of:
  // - a call with no argument, or only the loader data (no callback or effect), whose callee
  //   is a registered hook import, by its own name, never rebound;
  // - a member read (`a`, `a.b`, `a["b"]`) rooted at a name an earlier statement bound.
  // A callee or root read from inputs, a hook result, a global or any other import is
  // refused, and so is every other statement or expression.
  const pattern = `(?:${id}|\\{\\s*${id}(?:\\s*,\\s*${id})*\\s*,?\\s*\\}|\\[\\s*${id}(?:\\s*,\\s*${id})*\\s*,?\\s*\\])`;
  const argument = hasLoader ? "(?:data)?" : "";
  const statement = new RegExp(`\\s*const\\s+(${pattern})\\s*=\\s*(${id})(\\s*\\(\\s*${argument}\\s*\\)|(?:\\s*\\.\\s*${id}|\\s*\\[\\s*${quoted}\\s*\\])*)\\s*;`, "y");
  const bound = new Set<string>();
  for (at = 0; /\S/.test(body!.slice(at));) {
    statement.lastIndex = at;
    const match = statement.exec(body!);
    if (!match) return false;
    const [, binding, root, access] = match;
    if (!(/^\s*\(/.test(access!) ? hooks.has(root!) : bound.has(root!))) return false;
    for (const [name] of binding!.matchAll(new RegExp(id, "g"))) { if (!bind(name)) return false; bound.add(name); }
    at = statement.lastIndex;
  }
  for (const [, name, value] of attributes!.matchAll(new RegExp(`(${id})=(\\{[^{}]*\\}|"[^"\\n]*")`, "g"))) {
    if (!known.props.includes(name!)) return false;
    if (!value!.startsWith("{")) continue;
    const prop = new RegExp(`^\\{\\s*(?:true|false|"[^"\\n]*"|(${id})(?:\\.${id})*)\\s*\\}$`).exec(value!);
    if (!prop || prop[1] !== undefined && !bound.has(prop[1])) return false;
  }
  // Outside the one mount, the module contains no JSX at all.
  return !/<\s*[A-Za-z/>]/.test(module.replace(mountText!, ""));
}
/** Closed lexical policy shared with the provider seam; no runtime TypeScript parser.
 * With no escape anywhere, an identifier's source text is its name, so the exact text
 * checks below cannot be forged by an escaped spelling. */
function closedLexicalFinding(source: string): string | undefined {
  if (/\\u/.test(source)) return "Unicode escapes are refused";
  if (/(?<![\w$])eval(?![\w$])/.test(source)) return "eval is refused";
  // The global object and the reflection and code-building primitives, as in the provider seam.
  if (/(?<![\w$])(?:globalThis|window|self|global|Reflect|Function)(?![\w$])/.test(source)) return "Global object, Reflect and Function access is refused";
  // On any receiver a bracket key must be a plain string literal (destructuring and array literals are not access).
  for (const [, before, key] of source.matchAll(/([\w$]+|[)\]}]|\?\.)\s*\[([^\]]*)/g)) {
    if (/^(?:const|let|var|return|typeof|in|of|case|new|void|delete|await|yield|throw|else|do)$/.test(before!)) continue;
    if (!/^\s*(?:"[^"\n]*"|'[^'\n]*')?\s*$/.test(key!)) return "Computed member access with a non-literal key is refused";
  }
  return undefined;
}
/** The registered loader module exports exactly one zero-argument loader under its
 * registered name. It is never a client module or server-action endpoint, and it
 * exports nothing else that a page could reach. Type-only exports are erased. */
function registeredLoaderModuleFinding(source: string, loader: RouteSourceExport): string | undefined {
  const lexical = closedLexicalFinding(source);
  if (lexical) return lexical;
  if (/(["'])use (?:server|client)\1/.test(source)) return "Loader module cannot be a client module or a server-action endpoint";
  if (/(?<![\w$.])(?:module|exports)\s*(?:\.|\[)/.test(source)) return "Loader module cannot assign CommonJS exports";
  const exports = [...source.matchAll(/(?<![\w$.])export(?![\w$])(?!\s+(?:type|interface)\s)/g)];
  if (exports.length !== 1) return "Loader module must export exactly the registered loader";
  const name = escapeRegExp(loader.export);
  const shape = loader.export === "default"
    ? /^export\s+default\s+(?:async\s+)?function(?:\s+[A-Za-z_$][\w$]*)?\s*\(\s*\)/
    : new RegExp(`^export\\s+(?:(?:async\\s+)?function\\s+${name}\\s*\\(\\s*\\)|const\\s+${name}\\s*=\\s*(?:async\\s*)?\\(\\s*\\)\\s*(?::[^=]*)?=>)`);
  return shape.test(source.slice(exports[0]!.index)) ? undefined : "Loader module does not export the registered zero-argument loader";
}
/** A route with a registered loader: its entry is the emitted server page, which may
 * import only the Publisher data check, the registered loader under its registered
 * name and the emitted client page, and calls nothing else (no fetch or dynamic
 * import). Exact emitted bytes are still compared in the RR4 loop. */
async function registeredServerLoaderFindings(root: string, route: RouteRegistry["routes"][number]): Promise<RegisteredRouteFinding[]> {
  if (!route?.composition || !("loader" in route.composition)) return [];
  const loader = routeServerLoader(route);
  if (!loader) return []; // RR1 already refuses the registration.
  const findings: RegisteredRouteFinding[] = [];
  try {
    const finding = registeredLoaderModuleFinding(await read(root, loader.file), loader);
    if (finding) findings.push({ code: "RR4", file: loader.file, message: `Registered server loader refused: ${finding}` });
  } catch (error) { findings.push({ code: "RR4", file: loader.file, message: `Registered server loader module is absent or invalid: ${(error as Error).message}` }); }
  try {
    const page = await read(root, route.entry.file), lexical = closedLexicalFinding(page);
    // Every import or re-export specifier, bare side-effect imports included.
    const specifiers = [...page.matchAll(/(?<![\w$.])(?:import|export)(?![\w$])[^;"']*?(["'])([^"'\n]*)\1/g)].map(match => match[2]);
    const expected = emitRegisteredRouteAdapter(route), wanted = [...expected.matchAll(/from\s*(["'])([^"'\n]*)\1/g)].map(match => match[2]);
    const local = loader.export === "default" ? /^import registeredLoader from /m : new RegExp(`^import \\{ ${escapeRegExp(loader.export)} as registeredLoader \\} from `, "m");
    const message = lexical
      ?? (/(?<![\w$])(?:fetch|require|XMLHttpRequest|WebSocket|EventSource)(?![\w$])|(?<![\w$.])import\s*\(/.test(page) ? "Server page cannot fetch or load other modules" : undefined)
      ?? (specifiers.join("\n") !== wanted.join("\n") ? "Server page imports differ from the registered loader binding" : undefined)
      ?? (!local.test(page) ? "Server page does not import the registered loader export" : undefined);
    if (message) findings.push({ code: "RR4", file: route.entry.file, message: `Registered server page refused: ${message}` });
  } catch { findings.push({ code: "RR4", file: route.entry.file, message: "Registered server page is absent or invalid" }); }
  return findings;
}
/** Read-only filesystem discovery, exact emitter linkage and the original HOST1
 * source findings. A passing result is source closure, never rendered qualification. */
export interface RegisteredRouteCheckInput { readonly root: string; readonly contract: RegisteredRouteContract; readonly plan?: PublisherPlanDraft | PublisherPlanVersion; readonly registries: InstanceRegistries; readonly styling?: RegisteredRouteStyling }
export async function checkRegisteredRoutes(input: RegisteredRouteCheckInput) {
  return (await checkRegisteredRoutesInternal(input)).checked;
}
async function checkRegisteredRoutesInternal(input: RegisteredRouteCheckInput) {
  const root = await fs.realpath(resolve(input.root)), contract = parseRegisteredRouteContract(input.contract);
  const registryText = await read(root, contract.registry.file);
  const registry = JSON.parse(registryText) as RouteRegistry;
  const projection = projectRouteRegistry(registry, input.plan, input.registries, {}, {});
  const findings: RegisteredRouteFinding[] = projection.findings.map(f => ({ code: "RR1", file: contract.registry.file, message: `${f.routeId}:${f.path}: ${f.message}` }));
  const entries = new Map<string, string>(), classifications: { file: string; kind: "page" | "redirect" | "document" | "http" | "provider" }[] = [];
  const allRoots = contract.routeRoots.map(r => r.directory);
  for (const boundary of contract.routeRoots) {
    async function visit(path: string): Promise<void> {
      const info = await fs.lstat(join(root, path));
      if (info.isSymbolicLink()) throw new Error("Route root symlinks are refused");
      if (info.isDirectory()) { for (const name of (await fs.readdir(join(root, path))).sort()) await visit(`${path}/${name}`); return; }
      if (!info.isFile()) return;
      const name = path.split("/").at(-1)!;
      if (!/^(?:page|layout|route)\.[jt]sx?$/.test(name)) return;
      const source = await read(root, path);
      if (/^layout\./.test(name)) {
        if (documentOnlyLayout(source)) classifications.push({ file: path, kind: "document" });
        else findings.push({ code: "RR2", file: path, message: "Layout is not a closed document wrapper; implicit visual composition is unsupported" });
        return;
      }
      if (/^route\./.test(name)) {
        // A handler with no default export and no element; an escape can hide either from this raw read.
        // Only an identifier escape can spell a keyword or a tag; a string escape spells no syntax.
        if (/export\s+(?:async\s+)?function\s+(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b|export\s+(?:const|let)\s+(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/.test(source) && !/export\s+default\b|<\s*[A-Za-z]|\\u/.test(source)) classifications.push({ file: path, kind: "http" });
        else findings.push({ code: "RR2", file: path, message: "Unsupported HTTP route source classification" });
        return;
      }
      if (redirectOnlyRoute(source)) { classifications.push({ file: path, kind: "redirect" }); return; }
      classifications.push({ file: path, kind: "page" });
      const segments = relative(join(root, boundary.directory), dirname(join(root, path))).split(/[\\/]/).filter(Boolean);
      if (segments.some(p => p.startsWith("@") || /^\(\./.test(p))) findings.push({ code: "RR2", file: path, message: "Parallel/intercepted route semantics are not supported by this route root" });
      const parts = segments.filter(part => !/^\([^/]+\)$/.test(part));
      entries.set(path, `${boundary.basePath.replace(/\/$/, "")}/${parts.join("/")}`.replace(/\/$/, "") || "/");
    }
    await visit(boundary.directory);
  }
  if (!entries.size) findings.push({ code: "RR2", file: "", message: "No executable visual page entries discovered in admitted roots" });
  // A provider is admitted only as the registered route's own closed nonvisual
  // module; layouts and every other mount site keep the rules above.
  for (const route of registry.routes ?? []) {
    if (!route?.composition || !("provider" in route.composition)) continue;
    const known = routeProviderMount(route), file = route.composition.provider?.source?.file;
    if (!known) continue; // RR1 already refuses the registration.
    try {
      if (Object.keys(contract.sources).some(key => key === known.module || key.endsWith("/") && known.module.startsWith(key))) throw new Error("Original provider module cannot be remapped");
      const runtime = route.composition.runtime?.file;
      if (!nonvisualRouteProvider(await read(root, file!), file!, typeof runtime === "string" && routeSourcePath(runtime) ? runtime : undefined, route.composition.provider!, known, routeServerLoader(route) !== undefined)) throw new Error("Provider renders or mounts more than the registered original provider");
      classifications.push({ file: file!, kind: "provider" });
    } catch (error) { findings.push({ code: "RR2", file: String(file), message: `Registered provider is not the exact nonvisual original-provider mount: ${(error as Error).message}` }); }
  }
  for (const [file, path] of entries) {
    const matches = registry.routes?.filter(route => route.entry.file === file) ?? [];
    if (matches.length !== 1 || matches[0]!.path !== path) findings.push({ code: "RR3", file, message: "Discovered page must join exactly one registered route and derived URL path" });
  }
  // Every emitted page reads the registry through its typed module; that module is
  // generated output too and must be the exact bytes for the JSON control input.
  const registryModule = contract.registry.module;
  try {
    if (await read(root, registryModule) !== emitRegisteredRouteRegistryModule(registry)) findings.push({ code: "RR4", file: registryModule, message: "Typed registry module differs from its deterministic registered JSON" });
  } catch { findings.push({ code: "RR4", file: registryModule, message: "Typed registry module is absent or invalid" }); }
  for (const route of registry.routes ?? []) {
    if (!entries.has(route.entry.file)) findings.push({ code: "RR3", file: route.entry.file, message: "Registry entry has no discovered executable page" });
    try {
      const generated = emitRegisteredRoutePage(contract.registry.module, route);
      if (await read(root, route.composition.source.file) !== generated) findings.push({ code: "RR4", file: route.composition.source.file, message: "Page implementation differs from its deterministic registered composition" });
      if (route.entry.file !== route.composition.source.file && await read(root, route.entry.file) !== emitRegisteredRouteAdapter(route)) findings.push({ code: "RR4", file: route.entry.file, message: "Route adapter does not execute the exact generated composition" });
    } catch { findings.push({ code: "RR4", file: route.entry.file, message: "Registered composition source is absent or invalid" }); }
    findings.push(...await registeredServerLoaderFindings(root, route));
  }
  let dogfood: ReturnType<typeof runConsumerDogfood> | undefined;
  const sourceEvidence: RegisteredRouteSourceEvidence[] = [];
  const sourceEvidencePending: string[] = [];
  const materializations = new Map<string, RouteRuntimeMaterialization>();
  if (entries.size) {
    try {
      const source = await consumerDogfoodSources(allRoots, { version: 1, sources: { ...contract.sources, "@clossys/publisher/web/registered-route": join(dirname(fileURLToPath(import.meta.url)), "registered-route.js") }, pages: [...entries.keys()] }, root, root);
      let styling: { profile: string; manifest: ConsumerRuntimeManifest; css: Readonly<Record<string, `sha256:${string}`>> } | undefined;
      const css = source.files.filter(file => file.file.endsWith(".css"));
      if (input.styling) {
        const { engine, manifest } = input.styling, profile = resolveProfile(engine);
        const catalog = { ...engine.catalog.components, slots: [...engine.catalog.components.slots, ...(engine.catalog.surfaces?.slots ?? [])] };
        const checked = checkConsumerRuntimeManifest(manifest, catalog, { consumer: registry.consumer, libraryHash: libraryHash(engine.library), selectionHash: profile.selectionHash });
        for (const route of registry.routes) if (route.composition.binding.body?.source.kind === "derived") {
          const current = input.styling.designer?.[route.routeId];
          if (!current) { sourceEvidencePending.push(`${route.routeId}: current original Designer query/provider projection pending`); continue; }
          const expected = await registeredDesignerQuerySources();
          if (runtimeHash(current.query.implementation) !== runtimeHash(expected.implementation) || runtimeHash(current.query.provider) !== runtimeHash(expected.provider)) throw new Error("Fixed query/original provider bytes differ from actual public implementation");
          const providerSource = resolve(dirname(fileURLToPath(import.meta.resolve("@clossys/designer/studio/queries"))), "../../src/studio/WholeStudioProvider.tsx");
          if (!source.files.some(file => resolve(root, file.file) === providerSource)) throw new Error("Original Designer provider is not reached by the actual composition graph");
          const result = materializeRegisteredDesignerRoute(route.composition.binding, engine, input.registries, current.instanceLibrary, current.query);
          if (result.status !== "materialized") { sourceEvidencePending.push(...result.findings); continue; }
          materializations.set(route.routeId, result.materialization);
        }
        const bindings = registry.routes.map(route => deriveRouteRuntimeBinding(route.composition.binding, engine, manifest, materializations.get(route.routeId)));
        if (!profile.check.ok || checked.status !== "valid" || profile.consumer !== registry.consumer || bindings.some(binding => binding.status !== "resolved")) findings.push({ code: "RR5", file: "", message: "Current styling profile/manifest differs from exact selected route bindings" });
        else if (css.length) {
          const tokens = [...emittedTokenProperties(profile.values)].flatMap(([id, output]) => {
            const parts = id.split("."), leaf = parts.slice(0, 2).join("."), member = parts.slice(2).join(".");
            return [...new Set([output.property, ...(output.theme ? [output.theme] : [])])].map(property => ({ id: leaf, contract: { emit: { [member]: property } } }));
          });
          dogfood = runConsumerDogfood({
            ...source, tokens, themeCss: css.map(file => file.content).join("\n"),
            tokenLibrary: {
              catalog: engine.catalog.values,
              library: { ...engine.library.values, source: engine.library.source, adoptedAt: engine.library.adoptedAt },
            },
          });
          styling = { profile: runtimeHash(profile), manifest, css: Object.fromEntries(css.map(file => [file.file, sha(file.content)])) };
        }
      }
      if (!dogfood) dogfood = runConsumerDogfood(source);
      if (!styling) sourceEvidencePending.push("Exact selected styling profile and reached consumer stylesheets pending");
      if (!findings.length && dogfood.ok && styling) {
        try {
          const data = await Promise.all(source.data.filter(file => !file.startsWith("..")).map(async file => ({ file, content: await read(root, file) })));
          const files = [...source.files, ...data];
          if (await read(root, contract.registry.file) !== registryText) throw new Error("Registry changed during source scan");
          const identity = await immutableSourceIdentity(root, files);
          const hashes = Object.fromEntries(files.map(file => [file.file, sha(file.content)]));
          const planDigest = input.plan?.status === "aligned" && !projection.rows.some(row => row.pending.includes("Exact plan alignment pending")) ? input.plan.digest : undefined;
          for (const route of registry.routes) {
            const selection = deriveRouteRuntimeBinding(route.composition.binding, input.styling!.engine, styling.manifest, materializations.get(route.routeId));
            if (selection.status !== "resolved") throw new Error("Selected styling binding changed");
            sourceEvidence.push(recordRegisteredRouteSourceEvidence(registry, route, identity, hashes, planDigest, { profile: styling.profile, manifest: runtimeHash(selectedRouteRuntimeManifest(selection.binding, styling.manifest)), css: styling.css }, materializations.get(route.routeId)?.digest));
          }
        } catch { sourceEvidencePending.push("Immutable generated/source artifact identity pending"); }
      }
    }
    catch (error) { findings.push({ code: "RR5", file: "", message: `Consumer source resolution refused: ${(error as Error).message}` }); }
  }
  return { materializations, checked: { version: 2 as const, ok: !findings.length && dogfood?.ok === true && sourceEvidencePending.length === 0, scope: contract.routeRoots, registry, projection, classifications, findings, dogfood, sourceEvidence, sourceEvidencePending, runtime: "pending" as const } };
}

/** Plain data the emitted server page may pass on as a loader result; the client
 * re-materializes it through materializeRegisteredRouteSourceEvidence. Absent, never
 * a weaker substitute, when the Node evidence cannot be bound to this engine. */
function nodeRouteSourceBootstrap(registry: RouteRegistry, route: RouteRegistry["routes"][number], source: RegisteredRouteSourceEvidence, engine: CompositeEngineInput, materialization: RouteRuntimeMaterialization | undefined): { readonly bootstrap?: RegisteredRouteSourceBootstrap } {
  try { return { bootstrap: registeredRouteSourceBootstrap({ registry, route, source, engine, materialization }) }; } catch { return {}; }
}
/** Stateless Node operation. The browser receives only projection, whose tag is
 * explicitly unverified; source/materialization receipts remain server artifacts. */
export async function prepareRegisteredNodeRoute(input: RegisteredRouteCheckInput & { readonly routeId: string; readonly runtime: RegisteredRouteRuntime; readonly renderActions?: RegisteredRouteHeaderActions }) {
  const transaction = beginRegisteredRouteNodeTransaction(await fs.realpath(input.root).catch(() => resolve(input.root)), input.routeId);
  const planReading = runtimeHash(input.plan ?? null);
  const { checked, materializations } = await checkRegisteredRoutesInternal(input);
  if (runtimeHash(input.plan ?? null) !== planReading) return { status: "refused" as const, findings: ["Aligned Node plan changed during source preparation"] };
  if (!checked.ok || input.plan?.status !== "aligned") return { status: "pending" as const, findings: [...checked.findings.map(row => row.message), ...(checked.dogfood?.findings.map(row => `${row.code}: ${row.evidence}`) ?? []), ...checked.sourceEvidencePending, ...(input.plan?.status !== "aligned" ? ["Exact aligned Node plan required"] : [])] };
  const rows: PlainRegisteredRouteProjection["routes"][number][] = [];
  for (const route of checked.registry.routes) {
    const materialization = materializations.get(route.routeId), source = checked.sourceEvidence.find(value => value.routeId === route.routeId);
    if (!source || source.planDigest !== input.plan.digest || !isCurrentRegisteredRouteSourceEvidence(source, checked.registry, route, materialization?.digest)) return { status: "refused" as const, findings: ["Exact Node source/plan/materialization join required"] };
    const registration = materialization ? { ...route, composition: { ...route.composition, binding: materialization.binding } } : route;
    if (registration.composition.binding.body?.source.kind === "derived") {
      const query = input.styling?.designer?.[route.routeId]?.query;
      if (!materialization || !query) return { status: "pending" as const, findings: ["Current fixed Node query materialization unavailable"] };
      rows.push({ kind: "derived-route-view", registration, derivation: { id: "designer.layer-boards", version: 1, renderer: query.implementation, state: materialization.facts } });
    } else rows.push({ kind: "static-route-view", registration });
  }
  const route = checked.registry.routes.find(value => value.routeId === input.routeId), source = checked.sourceEvidence.find(value => value.routeId === input.routeId);
  if (!route || !source) return { status: "refused" as const, findings: ["Unknown Node route identity"] };
  const { prepareRegisteredRouteFromNode } = await import("./registered-route-binding.js");
  const prepared = prepareRegisteredRouteFromNode(checked.registry, input.routeId, input.runtime, { source, materialization: materializations.get(input.routeId) }, input.renderActions);
  if (prepared.status !== "ready") return prepared;
  const projection: PlainRegisteredRouteProjection = runtimeSnapshot({ kind: "publisher.route-projection", version: 1, authentication: "unverified", consumer: checked.registry.consumer, routes: rows });
  // Deliberately expose no receipt in the plain projection. Prepared is a Node
  // verification artifact and must not be serialized as browser input.
  if (!prepared.input) return { status: "refused" as const, findings: ["Canonical Node assembly input unavailable"] };
  try {
    const current = issueRegisteredRouteNodeCurrent({ transaction, registry: checked.registry, route, source, plan: input.plan, assembly: prepared.input, original: input.runtime.assembly, materialization: prepared.materialization, query: input.runtime.designerQuery });
    return { ...prepared, projection, current, ...nodeRouteSourceBootstrap(checked.registry, route, source, input.runtime.assembly.engine, prepared.materialization) };
  } catch { return { status: "refused" as const, findings: ["Exact current Node source/query/assembly transaction unavailable"] }; }
}

export { registeredFlowLayoutSource } from "./registered-route-flow-source.js";

export type { CompleteRoutePageSource } from "./registered-route-source.js";
export { prepareAdminPageCopyEnvelopes } from "./pages/admin-copy-source.js";
