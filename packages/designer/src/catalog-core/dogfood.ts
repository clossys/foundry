/** Derived, static JSX evidence. No renderer runs and this module never writes files. */
import { runtimeStageModuleIdentity } from "./runtime-ports.js";
import { dogfoodCssIssues } from "./dogfood-css.js";
import type { EngineInput } from "./resolve.js";
import { extractStyleCandidates } from "../style-extract.js";
import { sha256 } from "./digest.js";
import { scanSurfaceReads, type ConsumptionToken, type SurfaceReadContract } from "./consumption.js";
import { BLOCK_ENTRIES } from "../catalog/blocks.js";
import components from "../catalog/slots/components.json" with { type: "json" };
import aliases from "../catalog/aliases/components.json" with { type: "json" };
import buttonFill from "../catalog/fills/foundry/components.button.json" with { type: "json" };
import appFrameFill from "../catalog/fills/foundry/frames.app-shell.json" with { type: "json" };
import { STUDIO_SPECIMEN_HOST_PARTS } from './studio-host-parts.js';

export type DogfoodCode = "DF1" | "DF2" | "DF3" | "DF4" | "DF5" | "DF6" | "DF7" | "DF8";
/** Runtime-owned code vocabulary also supplies the generated skill reference. */
export const DOGFOOD_GUIDANCE = {
  DF1: { meaning: "Raw interactive or visually styled non-library element.", fix: "Bind an existing component; triage a NEED when no capability exists." },
  DF2: { meaning: "Hard-coded style value or unresolved dynamic styling/source.", fix: "Use token-bound library surfaces. Same-line token-gate:ignore comments retain explicit ignored evidence." },
  DF3: { meaning: "Inline SVG bypasses the assets component boundary.", fix: "Bind an assets component or icon id." },
  DF4: { meaning: "A token or asset read is unknown, or an observed read or composition edge is absent from the authored slot contract.", fix: "Reconcile the observed read or composition with the authored contract; preserve the source evidence." },
  DF5: { meaning: "A visual import or local component resolves to no registered slot.", fix: "Bind a registered component or triage a NEED; preserve actual import provenance." },
  DF7: { meaning: "A page hand-builds frame-owned heading or navigation chrome.", fix: "Use PageHeaderModule and library heading/Panel parts." },
  DF8: { meaning: "A page has no imported Frame page-header lease.", fix: "Render exactly one PageHeaderModule from the public shell contract with id and header data." },
  DF6: { meaning: "A named exception is missing, changed or expired.", fix: "Resolve the gap or explicitly renew its file, element, hash, reason, owner and expiry evidence." },
} as const satisfies Record<DogfoodCode, { meaning: string; fix: string }>;
export interface DogfoodFinding { code: DogfoodCode; file: string; line: number; tag: string; elementId: string; raisedBy: string; slotId: string | null; evidence: string; missing?: string; needId?: string }
export interface NeedEvidence { file: string; line: number; code: DogfoodCode; benchmark?: string }
export type NeedStatus = "open" | "proposed" | "approved" | "built" | "closed";
export interface NeedCandidate { library: "shadcn@aria" | "starter" | "foundry"; slotId: string; reason: string }
export interface NeedRecord { id: string; raisedBy: string; missing: string; kind: "slot" | "member" | "leaf"; status: NeedStatus; candidate: NeedCandidate | null; evidence: NeedEvidence[]; createdBy: "dogfood-check" | "skill" | "owner"; createdAt: string; updatedAt: string; closedBy: string | null }
export interface DogfoodException { name: string; file: string; elementId: string; hash: string; reason: string; owner: string; expiry: string }
export interface DogfoodInput {
  files: readonly { file: string; content: string }[]; themes?: readonly ConsumptionToken[]; themeCss?: string;
  /** JSON paths actually parsed by the source runner; never source or export bytes. */
  data?: readonly string[];
  /** Fresh selected source values for CSS definitions; never expected CSS or a submitted manifest. */
  tokenLibrary?: EngineInput;
  contracts?: Readonly<Record<string, SurfaceReadContract>>; exceptions?: readonly DogfoodException[]; needs?: readonly NeedRecord[];
  /** Resolved library-owned local import modules, supplied by the filesystem runner. */
  localModules?: Readonly<Record<string, string>>; now?: string;
  /** Exact source/export identities resolved by the source runner, never inferred from a local symbol's spelling. */
  resolvedImports?: Readonly<Record<string, string>>;
  /** Consumer mode follows source modules; these identities never suppress their findings. */
  consumerBoundary?: { readonly pages: readonly string[]; readonly sourceImports: Readonly<Record<string, string>>; readonly pageChromeFiles?: readonly string[];
    /** Exact edges resolved from the runner's explicit project-source contract. */
    readonly projectSourceImports?: readonly string[];
    /** Exact stylesheet edges the runner resolved and scanned (consumer CSS closure). */
    readonly stylesheetImports?: Readonly<Record<string, string>> };
}
export interface DogfoodCompose { file: string; line: number; tag: string; slotId: string; module: string; symbol: string }
export const STRUCTURAL_TAGS = Object.freeze(["div", "span", "section", "ul", "ol", "li", "p", "h1", "h2", "h3", "h4", "h5", "h6", "dl", "dt", "dd", "code", "pre", "header", "main", "nav", "footer"] as const);
export const elementHash = (text: string): string => `sha256:${sha256(text)}`;
export const DOGFOOD_PACKAGE_NAME = buttonFill.$extensions["com.clossys.fill"].pin.package;
const pascal = (id: string) => id.split(".").at(-1)!.split("-").map(part => part[0]!.toUpperCase() + part.slice(1)).join("");
const symbolSlots = new Map([...components.map(slot => [pascal(slot.id), slot.id] as const), ...aliases.map(alias => [pascal(alias.id), alias.target] as const), ["Breadcrumb", "components.breadcrumbs"]]);
const knownSlot = (symbol: string): string | undefined => symbolSlots.get(symbol) ?? symbolSlots.get(symbol.split(".")[0]!);
// Exact public server-barrel witnesses, checked against their real source in
// dogfood.test.ts (a repository-only test that does not ship). Export presence
// still requires an existing registered leaf.
const serverExports = new Map<string, ReadonlySet<string>>([
  [`${DOGFOOD_PACKAGE_NAME}/components/server`, new Set(["Avatar", "Badge", "Banner", "Card", "Field", "Icon", "Meter", "Skeleton", "Spinner", "StatusMark", "Logomark"])],
  [`${DOGFOOD_PACKAGE_NAME}/blocks/server`, new Set(["SECTION_GROUND_CLASSES", "ArticleBody", "DetailView", "EmptyState", "FeatureGrid", "Matrix", "Specimen", "SpecimenPanel", "OrderedStepSequence", "StatusList", "EventItem", "TaskList", "Faq", "FieldGroup", "Hero", "ContentSection", "SectionIntro", "MediaFigure", "MarketingChapter", "PageHeader", "PricingTable", "SectionHeader", "SectionFrame", "UsageMeter", "Stat", "Testimonial", "TableOfContents", "TestimonialSet", "LogoCloud", "PeopleGrid", "RecordLedger", "AnatomyCallouts", "Scene", "Item", "Tree", "Items", "Lockup"])],
]);
const serverBlockSlots = new Map(BLOCK_ENTRIES.flatMap(entry => entry.export ? [[entry.export, entry.id] as const] : []));
function registeredServerSlot(module: string, symbol: string): string | undefined {
  // No compound server member is declared by these public export witnesses.
  if (!serverExports.get(module)?.has(symbol)) return undefined;
  return module === `${DOGFOOD_PACKAGE_NAME}/components/server` ? knownSlot(symbol) : serverBlockSlots.get(symbol);
}
const interactive = new Set(["button", "input", "select", "textarea", "details", "summary"]);
const capabilities: Record<string, string> = { button: "components.button", input: "components.text-field", select: "components.select", textarea: "components.text-field", a: "components.link", details: "components.disclosure", summary: "components.disclosure", svg: "components.icon", form: "components.form", fieldset: "components.field", legend: "components.field", label: "components.field", table: "components.table", tr: "components.table", td: "components.table", th: "components.table", thead: "components.table", tbody: "components.table", option: "components.select", progress: "components.progress-bar", meter: "components.meter", dialog: "components.dialog" };
interface Attribute { name: string; value: string; start: number; dynamic: boolean }
interface Element { tag: string; start: number; end: number; attributes: Attribute[] }
interface SourceExport { symbol: string; original: string; module?: string }
interface SourceDefinition { name: string; start: number; end: number; exported: boolean }
interface Parsed { exports: SourceExport[]; definitions: SourceDefinition[]; nonCode: { start: number; end: number }[]; importBindings: { binding: string; module: string; symbol: string }[]; contextProviders: Set<string>; modules: Set<string>; comments: { start: number; end: number }[]; elements: Element[]; imports: Map<string, { module: string; symbol: string }>; unresolved: { start: number; message: string }[] }

/** A balanced JSX node scanner, not a TypeScript compiler. Dynamic attribute values and
 * unsupported/malformed syntax stay explicit findings; observations are a lower bound. */
/** `jsx` is false for TypeScript-only (.ts) sources, where `<` only opens type syntax. */
function parseJsx(source: string, jsx = true): Parsed {
  const result: Parsed = { exports: [], definitions: [], nonCode: [], importBindings: [], contextProviders: new Set(), modules: new Set(), comments: [], elements: [], imports: new Map(), unresolved: [] };
  let i = 0;
  const issue = (message: string, start = i) => result.unresolved.push({ start, message: `unresolved ${message}` });
  const space = () => { while (/\s/.test(source[i] ?? "") && i < source.length) i++; };
  function quoted(): void {
    const quote = source[i++]!; let start = i - 1;
    while (i < source.length) {
      if (source[i] === "\\") { i += 2; continue; }
      if (source[i] === quote) { i++; result.nonCode.push({ start, end: i }); return; }
      if (quote === "`" && source.slice(i, i + 2) === "${") {
        result.nonCode.push({ start, end: i + 2 }); i += 2; js("}"); start = i - 1; continue;
      }
      i++;
    }
    result.nonCode.push({ start, end: i }); issue("unterminated string");
  }
  function comment(): boolean {
    if (source.slice(i, i + 2) === "//") { const end = source.indexOf("\n", i); result.comments.push({ start: i, end: end < 0 ? source.length : end }); i = end < 0 ? source.length : end; return true; }
    if (source.slice(i, i + 2) === "/*") { const end = source.indexOf("*/", i + 2); if (end < 0) issue("comment"); result.comments.push({ start: i, end: end < 0 ? source.length : end + 2 }); i = end < 0 ? source.length : end + 2; return true; }
    return false;
  }
  function imports(): boolean {
    const namedExport = /^export\s*\{([^}]*)\}(?:\s*from\s*(["'])([^"']+)\2)?/.exec(source.slice(i));
    if (namedExport) {
      for (const part of namedExport[1]!.split(",")) {
        const binding = /^\s*(?!type\s)(\w+)(?:\s+as\s+(\w+))?\s*$/.exec(part);
        if (binding) result.exports.push({ symbol: binding[2] ?? binding[1]!, original: binding[1]!, ...(namedExport[3] ? { module: namedExport[3] } : {}) });
      }
      if (namedExport[3]) result.modules.add(namedExport[3]);
      result.nonCode.push({ start: i, end: i + namedExport[0].length }); i += namedExport[0].length; return true;
    }
    const reexport = /^(?:export\s+(?:\{[^}]*\}|\*(?:\s+as\s+(?:[A-Za-z_$][\w$]*|"[^"]*"|'[^']*'))?)\s+from\s*|import\s*)(["'])([^"']+)\1/.exec(source.slice(i));
    if (reexport) { result.modules.add(reexport[2]!); result.nonCode.push({ start: i, end: i + reexport[0].length }); i += reexport[0].length; return true; }
    const match = /^import\s+(?!type\b)([\s\S]*?)\s+from\s*(["'])([^"']+)\2/.exec(source.slice(i));
    if (!match) return false;
    const clause = match[1]!, module = match[3]!; result.modules.add(module);
    result.nonCode.push({ start: i, end: i + match[0].length });
    const bind = (binding: string, symbol: string) => { result.imports.set(binding, { module, symbol }); result.importBindings.push({ binding, module, symbol }); };
    const namespace = /\*\s+as\s+(\w+)/.exec(clause);
    if (namespace) bind(namespace[1]!, "*");
    const named = /\{([^}]*)\}/.exec(clause);
    for (const part of named?.[1]?.split(",") ?? []) {
      const binding = /^\s*(?!type\s)(\w+)(?:\s+as\s+(\w+))?\s*$/.exec(part);
      if (binding) bind(binding[2] ?? binding[1]!, binding[1]!);
    }
    const primary = /^\s*(\w+)/.exec(clause);
    if (primary) bind(primary[1]!, "default");
    i += match[0].length; return true;
  }
  function element(): void {
    const start = i++;
    const tagMatch = /^[A-Za-z][\w.:-]*/.exec(source.slice(i));
    const tag = tagMatch?.[0] ?? ""; i += tag.length;
    const node: Element = { tag, start, end: i, attributes: [] };
    if (tag) result.elements.push(node);
    let selfClosing = false;
    while (i < source.length) {
      space();
      if (source.slice(i, i + 2) === "/>") { i += 2; selfClosing = true; break; }
      if (source[i] === ">") { i++; break; }
      const position = i;
      if (source[i] === "{") { i++; js("}"); node.attributes.push({ name: "...", value: source.slice(position, i), start: position, dynamic: true }); continue; }
      const name = /^[\w:-]+/.exec(source.slice(i))?.[0];
      if (!name) { issue("JSX attribute", i); i++; continue; }
      i += name.length; space(); let value = "", dynamic = false;
      if (source[i] === "=") {
        i++; space(); const valueStart = i;
        if (["'", '"'].includes(source[i] ?? "")) quoted();
        else if (source[i] === "{") { i++; js("}"); dynamic = true; }
        else { issue("JSX attribute value"); while (i < source.length && !/[\s>]/.test(source[i]!)) i++; }
        value = source.slice(valueStart, i);
      }
      node.attributes.push({ name, value, start: position, dynamic });
    }
    if (!selfClosing) {
      let closed = false;
      while (i < source.length) {
        if (source.slice(i, i + 2) === "</") {
          const close = /^<\/([\w.:-]*)\s*>/.exec(source.slice(i));
          if (!close) { issue("JSX closing tag"); i++; continue; }
          if (close[1] !== tag) issue(`JSX nesting: expected ${tag || "fragment"}`, i);
          i += close[0].length; closed = true; break;
        }
        if (source[i] === "<" && /[A-Za-z>]/.test(source[i + 1] ?? "")) { element(); continue; }
        if (source[i] === "{") { i++; js("}"); continue; }
        i++;
      }
      if (!closed) issue(`unclosed JSX ${tag || "fragment"}`, start);
    }
    node.end = i;
  }
  function js(end?: string, optionalEnd = false): void {
    let last = "";
    while (i < source.length) {
      if (end && source[i] === end) { i++; return; }
      if (comment()) continue;
      if (["'", '"', "`"].includes(source[i] ?? "")) { quoted(); last = "value"; continue; }
      // Keep bounded declaration spans for source-owned view qualification.
      // JSX in a different or unused declaration cannot qualify an empty view.
      // Simple type parameters (function View<Row>(...)) still name a render body.
      const fn = /^(export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*(?:<[^<>()]*>\s*)?\(/.exec(source.slice(i));
      if (fn) {
        const start = i; i += fn[0].length; js(")"); space();
        if (source[i] === ":") { while (i < source.length && source[i] !== "{" && source[i] !== ";") i++; }
        if (source[i] === "{") {
          i++; js("}"); result.definitions.push({ name: fn[2]!, start, end: i, exported: !!fn[1] });
        } else if (source[i] === ";") i++; // An overload/type declaration has no render body.
        else issue("function source body", start);
        last = "value"; continue;
      }
      const variable = /^(export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/.exec(source.slice(i));
      if (variable) {
        const start = i; i += variable[0].length; js(";", true);
        result.definitions.push({ name: variable[2]!, start, end: i, exported: !!variable[1] }); last = ";"; continue;
      }
      if (/^(?:import|export)\b/.test(source.slice(i)) && imports()) { last = "value"; continue; }
      if (/[A-Za-z_$]/.test(source[i] ?? "")) {
        const word = /^[A-Za-z_$][\w$]*/.exec(source.slice(i))![0]; i += word.length;
        last = ["return", "throw", "case", "yield", "await", "typeof", "void", "delete"].includes(word) ? "=" : "value"; continue;
      }
      if (source[i] === "/" && (!last || /[=(:[,!&|?;{}]/.test(last))) {
        const match = /^\/(?:\\.|\[(?:\\.|[^\]\\])*\]|[^/\n\\])+\/[a-z]*/.exec(source.slice(i));
        if (match) { i += match[0].length; last = "value"; continue; }
      }
      // JSX begins an expression. A '<' after a value belongs to a comparison or
      // TypeScript type arguments (Record<string, unknown>, fn<Props>), not JSX.
      // The trailing comma/extends forms also identify generic arrow parameters.
      const genericArrow = source[i] === "<" && /^<[A-Za-z_$][\w$]*(?:\s*,|\s+extends\b)[^<>]*>\s*\(/.test(source.slice(i));
      if (jsx && source[i] === "<" && /[A-Za-z>]/.test(source[i + 1] ?? "") && (!last || /[=(:\[,!&|?;{}]/.test(last)) && !genericArrow) { element(); last = "value"; continue; }
      if (source.slice(i, i + 2) === "=>") { i += 2; last = "="; continue; }
      if (source[i] === "{") { i++; js("}"); last = "value"; continue; }
      if (source[i] === "(") { i++; js(")"); last = "value"; continue; }
      if (source[i] === "[") { i++; js("]"); last = "value"; continue; }
      if (!/\s/.test(source[i]!)) last = source[i]!;
      i++;
    }
    if (end && !optionalEnd) issue("unbalanced expression");
  }
  js(); result.contextProviders = lexicalReactProviders(source, result); return result;
}

/** Closed lexical witness, not a symbol-name exemption. Every occurrence of a
 * context/factory/reader must have a supported direct binding/use. Ambiguous
 * scope, shadowing, assignment and unsupported syntax therefore fail closed. */
function lexicalReactProviders(source: string, parsed: Parsed): Set<string> {
  const masked = source.split("");
  for (const span of [...parsed.nonCode, ...parsed.comments]) for (let at = span.start; at < span.end; at++) if (masked[at] !== "\n") masked[at] = " ";
  const code = masked.join(""), contexts = new Set<string>();
  if (/\b(?:eval|Function|with)\b/.test(code)) return contexts;
  const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const direct = (binding: string, symbol: string) => {
    const rows = parsed.importBindings.filter(row => row.binding === binding);
    return rows.length === 1 && rows[0]!.module === "react" && rows[0]!.symbol === symbol;
  };
  const declarations = [...code.matchAll(/\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*([A-Za-z_$][\w$]*)\s*(?:<[^;=(){}]*>)?\s*\(/g)].filter(row => direct(row[2]!, "createContext"));
  const occurrences = (name: string) => [...code.matchAll(new RegExp(`\\b${escape(name)}\\b`, "g"))].map(row => row.index!);
  for (const declaration of declarations) {
    const name = declaration[1]!, factory = declaration[2]!;
    if (declarations.filter(row => row[1] === name).length !== 1) continue;
    const factorySites = new Set(declarations.filter(row => row[2] === factory).map(row => row.index! + row[0].lastIndexOf(factory)));
    if (occurrences(factory).some(at => !factorySites.has(at))) continue;
    const allowed = new Set<number>([declaration.index! + declaration[0].indexOf(name)]);
    for (const node of parsed.elements) if (node.tag === `${name}.Provider`) allowed.add(node.start + 1);
    for (const row of code.matchAll(new RegExp(`</(${escape(name)})\\.Provider\\s*>`, "g"))) allowed.add(row.index! + 2);
    const readers = new Set(parsed.importBindings.filter(row => direct(row.binding, "useContext")).map(row => row.binding));
    let readerSafe = true;
    for (const reader of readers) {
      const sites = new Set<number>();
      for (const row of code.matchAll(new RegExp(`\\b${escape(reader)}\\s*\\(\\s*([A-Za-z_$][\\w$]*)\\s*\\)`, "g"))) {
        if (!declarations.some(declaration => declaration[1] === row[1])) continue;
        sites.add(row.index!);
        if (row[1] === name) allowed.add(row.index! + row[0].lastIndexOf(name));
      }
      if (occurrences(reader).some(at => !sites.has(at))) readerSafe = false;
    }
    if (readerSafe && occurrences(name).every(at => allowed.has(at))) contexts.add(`${name}.Provider`);
  }
  return contexts;
}

/** Import/export edges come from the same comment/string-aware source walk. */
/** `jsx` is false for TypeScript-only (.ts/.mts/.cts) sources, as runDogfood parses them. */
export function dogfoodSourceModules(source: string, jsx = true): string[] { return [...parseJsx(source, jsx).modules]; }

function importedIdentity(node: Element, parsed: Parsed, input: DogfoodInput, file: string) {
  const [binding, ...parts] = node.tag.split("."), imported = parsed.imports.get(binding!);
  if (!imported) return undefined;
  return { module: input.localModules?.[`${file}:${imported.module}`] ?? imported.module,
    symbol: imported.symbol === "*" ? parts.join(".") : [imported.symbol, ...parts].join("."), original: imported.module };
}
function pageHeader(node: Element, parsed: Parsed, input: DogfoodInput, file: string): boolean {
  const identity = importedIdentity(node, parsed, input, file);
  return identity?.module === `${DOGFOOD_PACKAGE_NAME}/shell` && identity.symbol === "PageHeaderModule";
}

/** A direct named public import may be aliased locally. Namespace, re-exported,
 * remapped and merely same-named symbols cannot declare this canonical part. */
function frameStage(node: Element, parsed: Parsed): boolean {
  const imported = parsed.imports.get(node.tag);
  return imported?.module === runtimeStageModuleIdentity.package && imported.symbol === runtimeStageModuleIdentity.export;
}

function composeAt(file: string, node: Element, parsed: Parsed, input: DogfoodInput): DogfoodCompose | undefined {
  if (!/^[A-Z]/.test(node.tag)) return undefined;
  if (input.consumerBoundary) { const identity = importedIdentity(node, parsed, input, file); if (identity?.module === "next/link" && identity.symbol === "default") return { file, line: 0, tag: node.tag, slotId: "components.link", module: identity.module, symbol: identity.symbol }; }
  const [binding, ...parts] = node.tag.split("."), imported = parsed.imports.get(binding!);
  if (!imported) return undefined;
  const module = input.localModules?.[`${file}:${imported.module}`] ?? imported.module;
  const symbol = imported.symbol === "*" ? parts.join(".") :
    serverExports.has(module) ? [imported.symbol, ...parts].join(".") : imported.symbol;
  const frame = appFrameFill.frames["app-shell"].impl;
  const slotId = input.resolvedImports ? input.resolvedImports[`${file}:${imported.module}#${symbol}`] :
    module === frame.module && symbol === frame.export ? appFrameFill.$extensions["com.clossys.fill"].slot :
      registeredServerSlot(module, symbol) ??
      // The client blocks barrel exports every registered block (checked against
      // its real source in dogfood.test.ts); a block export resolves to its own
      // block slot, as the server barrel's does, before the component vocabulary.
      (module === `${DOGFOOD_PACKAGE_NAME}/blocks` ? serverBlockSlots.get(symbol) : undefined) ??
      (["components", "icons", "charts", "blocks", "shell"].some(path => module === `${DOGFOOD_PACKAGE_NAME}/${path}`) ? knownSlot(symbol) : undefined);
  return slotId ? { file, line: 0, tag: node.tag, slotId, module: imported.module, symbol } : undefined;
}

/** A source-owned composition is inspected, never promoted to a registered slot.
 * Public packages need observed manifest/export bytes. Explicit project-source
 * edges instead come from the consumer runner's resolution contract. Both paths
 * require a rendered registered composition and keep descendant findings. These
 * are caller observations, not filesystem authentication or package-name trust. */
function sourceViewQualifier(input: DogfoodInput) {
  const files = new Map(input.files.map(file => [file.file, file.content]));
  const data = new Set((input.data ?? []).filter(file => typeof file === "string" && /\.json$/.test(file) && !files.has(file) && input.data!.filter(row => row === file).length === 1));
  const parsedFiles = new Map<string, Parsed>();
  const parsedAt = (file: string) => {
    if (!files.has(file) || input.files.filter(row => row.file === file).length !== 1) return undefined;
    if (!parsedFiles.has(file)) parsedFiles.set(file, parseJsx(files.get(file)!, !/\.[cm]?ts$/.test(file)));
    const parsed = parsedFiles.get(file)!;
    return parsed.unresolved.length ? undefined : parsed;
  };
  const targetAt = (file: string, module: string) => {
    const target = input.consumerBoundary?.sourceImports[`${file}:${module}`];
    return target && (files.has(target) || data.has(target)) ? target : undefined;
  };
  const projectEdge = (file: string, module: string) => input.consumerBoundary?.projectSourceImports?.includes(`${file}:${module}`) === true;
  const normalize = (path: string) => {
    const parts: string[] = [];
    for (const part of path.split("/")) if (part === "..") { if (!parts.length) return undefined; parts.pop(); } else if (part && part !== ".") parts.push(part);
    return (path.startsWith("/") ? "/" : "") + parts.join("/");
  };
  const publicEntry = (module: string, target: string) => {
    const match = /^(@[^/]+\/[^/]+|[^@./][^/]*)(\/.*)?$/.exec(module);
    if (!match || /[\\:%?#]/.test(module) || module.split("/").some(part => part === "." || part === "..")) return false;
    const key = match[2] ? "." + match[2] : ".";
    const runtime = (value: unknown): string | undefined => {
      if (typeof value === "string") return value;
      if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
      for (const [condition, entry] of Object.entries(value)) if (["import", "node", "default"].includes(condition)) return runtime(entry);
      return undefined;
    };
    return input.files.some(file => {
      if (!file.file.endsWith("/package.json") || input.files.filter(row => row.file === file.file).length !== 1) return false;
      try {
        const manifest = JSON.parse(file.content);
        if (manifest.name !== match[1] || !manifest.exports) return false;
        const paths = typeof manifest.exports === "object" && Object.keys(manifest.exports).some(name => name.startsWith("."));
        const entry = runtime(paths ? manifest.exports[key] : key === "." ? manifest.exports : undefined);
        if (!entry?.startsWith("./") || entry.split("/").some(part => part === "..")) return false;
        const root = file.file.slice(0, -"package.json".length), candidates = [normalize(root + entry)];
        if (entry.startsWith("./dist/")) for (const extension of [".ts", ".tsx", ".js", ".jsx"]) candidates.push(normalize(root + "src/" + entry.slice(7).replace(/\.[cm]?jsx?$/, extension)));
        return candidates.includes(normalize(target));
      } catch { return false; }
    });
  };
  const complete = (file: string, seen = new Set<string>()): boolean => {
    if (data.has(file)) return true;
    if (seen.has(file)) return true;
    seen = new Set([...seen, file]);
    const parsed = parsedAt(file);
    return !!parsed && [...parsed.modules].every(module => {
      if (["react", "react/jsx-runtime", "react/jsx-dev-runtime", "react-dom"].includes(module) || module.startsWith(`${DOGFOOD_PACKAGE_NAME}/`)) return true;
      const target = targetAt(file, module);
      return !!target && complete(target, seen);
    });
  };
  const qualifies = (file: string, symbol: string, exported: boolean, trail = new Set<string>()): boolean => {
    const id = `${file}#${symbol}`;
    if (trail.has(id) || symbol.includes(".")) return false;
    trail = new Set([...trail, id]);
    const parsed = parsedAt(file);
    if (!parsed) return false;
    const definitions = parsed.definitions.filter(row => row.name === symbol && (!exported || row.exported));
    const exports = exported ? parsed.exports.filter(row => row.symbol === symbol) : [];
    if (definitions.length + exports.length !== 1) return false;
    if (exports.length) {
      const row = exports[0]!;
      if (!row.module) return qualifies(file, row.original, false, trail);
      const target = targetAt(file, row.module);
      return !!target && qualifies(target, row.original, true, trail);
    }
    if (!complete(file)) return false;
    const definition = definitions[0]!, content = files.get(file)!;
    const children = parsed.elements.filter(node => node.start >= definition.start && node.end <= definition.end && !parsed.definitions.some(other => other !== definition && other.start > definition.start && other.end < definition.end && node.start >= other.start && node.end <= other.end));
    const roots = children.filter(node => /(?:\breturn|=>)\s*\(?\s*(?:<>\s*)?$/.test(content.slice(definition.start, node.start)));
    const registered = (node: Element) => {
      const binding = node.tag.split(".")[0]!, escaped = binding.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const shadowed = parsed.definitions.some(row => row.name === binding) || new RegExp(`\\bfunction\\s+\\w+\\s*\\([^)]*\\b${escaped}\\b[^)]*\\)|\\([^)]*\\b${escaped}\\b[^)]*\\)\\s*=>`).test(content);
      return !shadowed && parsed.importBindings.filter(row => row.binding === binding).length === 1 && !!composeAt(file, node, parsed, input);
    };
    return children.some(node => roots.some(root => node.start >= root.start && node.end <= root.end) && (registered(node) || (() => {
      const identity = importedIdentity(node, parsed, input, file);
      if (identity) {
        const target = targetAt(file, identity.original);
        return !!target && (identity.original.startsWith(".") || projectEdge(file, identity.original) || publicEntry(identity.original, target)) && qualifies(target, identity.symbol, true, trail);
      }
      return qualifies(file, node.tag, false, trail);
    })()));
  };
  return (file: string, node: Element, parsed: Parsed) => {
    const identity = importedIdentity(node, parsed, input, file);
    if (!identity || identity.original.startsWith(".")) return false;
    const target = targetAt(file, identity.original);
    return !!target && (projectEdge(file, identity.original) || publicEntry(identity.original, target)) && qualifies(target, identity.symbol, true);
  };
}

/** Observed JSX edges use the same parser and provenance rules as DF5. */
export function dogfoodComposes(input: DogfoodInput): DogfoodCompose[] {
  return [...input.files].sort((a, b) => a.file.localeCompare(b.file)).flatMap(file => {
    const parsed = parseJsx(file.content);
    return parsed.elements.flatMap(node => { const row = composeAt(file.file, node, parsed, input); return row ? [{ ...row, line: file.content.slice(0, node.start).split("\n").length }] : []; });
  });
}

/** Consumer-mode import qualification (G4). Every static import, re-export and
 * side-effect import must be relative or runner-resolved project source, the
 * React runtime (react, react-dom and their jsx/client/server entries, plus the
 * server-only/client-only markers), the Next.js framework (next, next/*), a
 * node: builtin, or a Foundry Designer entry. Anything else, including a
 * non-Foundry UI library, is an unqualified external the runner never inspected. */
const consumerRuntimeModules = new Set(["react", "react/jsx-runtime", "react/jsx-dev-runtime", "react-dom", "react-dom/client", "react-dom/server", "server-only", "client-only"]);
const rawAria = (module: string) => module === "react-aria-components" || module.startsWith("react-aria-components/");
function qualifiedConsumerModule(module: string, file: string, input: DogfoodInput): boolean {
  if (module.startsWith(".") || consumerRuntimeModules.has(module) || module.startsWith("node:") || module === DOGFOOD_PACKAGE_NAME || module.startsWith(`${DOGFOOD_PACKAGE_NAME}/`) || module === "next" || module.startsWith("next/")) return true;
  const edge = `${file}:${module}`;
  return Object.hasOwn(input.consumerBoundary?.sourceImports ?? {}, edge) || Object.hasOwn(input.consumerBoundary?.stylesheetImports ?? {}, edge) || Object.hasOwn(input.localModules ?? {}, edge);
}
/** Raw px in @media/@container thresholds (G5), matching the strict checker's
 * raw CSS pixel query rule; declarations are already covered by the value engine. */
function dogfoodCssQueryPixels(content: string): { start: number; end: number; evidence: string }[] {
  const clean = content.replace(/\/\*[\s\S]*?\*\//g, comment => " ".repeat(comment.length));
  return [...clean.matchAll(/@(?:media|container)\b\s*([^{};]+)/gi)].flatMap(query => {
    const pixels = [...query[1]!.matchAll(/(?:^|[^\w.-])(-?(?:\d+(?:\.\d+)?|\.\d+)px)\b/gi)].map(row => row[1]!);
    return pixels.length ? [{ start: query.index!, end: query.index! + query[0].length, evidence: `Hard-coded pixel query threshold: ${pixels.join(", ")} bypasses registered token binding.` }] : [];
  });
}

const quotedLiteral = /^(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')$/;
function staticAttribute(attribute: Attribute): boolean {
  if (!attribute.dynamic) return true;
  const inner = attribute.value.slice(1, -1).trim();
  if (quotedLiteral.test(inner)) return true;
  if (attribute.name !== "style" || !inner.startsWith("{") || !inner.endsWith("}")) return false;
  const body = inner.slice(1, -1).replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, "STRING");
  return /^\s*(?:[A-Za-z_$][\w$]*\s*:\s*(?:STRING|-?\d+(?:\.\d+)?|true|false|null)\s*,?\s*)*$/.test(body);
}
const layoutClass = /^(?:flex|inline-flex|grid|block|inline-block|inline|hidden|contents|relative|absolute|fixed|sticky|static|grow|shrink|truncate|isolate|antialiased|(?:items|justify|content|self|place-items|place-content|flex|grid|col|row|overflow|whitespace|break|object|pointer-events|select|cursor)-[\w-]+)$/;
const visualClass = /^(?:bg|text|font|shadow|rounded|border|ring|outline|w|h|min-w|max-w|min-h|max-h|size)-/;

/** The existing JSX parser supplies the complete attribute and enclosing export.
 * Only the real dependency-bound fixed constructor of these registered parts
 * can supply dynamic styling. Its opaque references are checked at every use. */
function registeredStudioTokenStyle(file: string, node: Element, attribute: Attribute, parsed: Parsed, input: DogfoodInput): boolean {
  if (input.consumerBoundary || attribute.name !== 'style') return false;
  const owner = parsed.definitions.filter(definition => definition.exported && definition.start <= node.start && definition.end >= node.end
    && Object.values(STUDIO_SPECIMEN_HOST_PARTS).some(part => part.export === definition.name));
  if (owner.length !== 1) return false;
  const entry = Object.entries(STUDIO_SPECIMEN_HOST_PARTS).find(([, part]) => part.export === owner[0]!.name)!;
  const [id, part] = entry;
  if (!input.contracts?.[file]?.allowedComposes?.includes(id)) return false;
  const refs = id === 'studio.specimen-swatch' ? 'member\\s*:\\s*[A-Za-z_$][\\w$]*' : 'background\\s*:\\s*[A-Za-z_$][\\w$]*\\s*,\\s*color\\s*:\\s*[A-Za-z_$][\\w$]*\\s*,\\s*pair\\s*:\\s*[A-Za-z_$][\\w$]*';
  const call = new RegExp(`^\\{\\s*([A-Za-z_$][\\w$]*)\\s*\\(\\s*(['"])${id.replaceAll('.', '\\.')}\\2\\s*,\\s*[A-Za-z_$][\\w$]*\\.profile\\.values\\s*,\\s*[A-Za-z_$][\\w$]*\\s*,\\s*\\{\\s*${refs}\\s*\\}\\s*\\)\\s*\\}$`).exec(attribute.value);
  if (!call) return false;
  const imported = parsed.imports.get(call[1]!);
  if (!imported || imported.module !== part.styleConstructor.module || imported.symbol !== part.styleConstructor.export
    || parsed.importBindings.filter(binding => binding.binding === call[1]).length !== 1 || parsed.definitions.some(definition => definition.name === call[1])) return false;
  return input.resolvedImports?.[`${file}:${imported.module}#${imported.symbol}`] === `${part.styleConstructor.module}#${part.styleConstructor.export}`;
}

export function runDogfood(input: DogfoodInput) {
  const findings: DogfoodFinding[] = [], structural: Record<string, number> = {}, ignored: { file: string; line: number; evidence: string }[] = [];
  const exceptions = (input.consumerBoundary ? [] : input.exceptions ?? []).map(row => ({ ...row, status: "missing" }));
  const scanned: { file: string; elements: number }[] = [], nodes = new Map<string, { file: string; hash: string }>();
  const cssIssues = input.consumerBoundary ? dogfoodCssIssues(input.files, input.tokenLibrary, (value, file) => {
    const extracted = extractStyleCandidates(JSON.stringify(value), file);
    return [...extracted.candidates.map(candidate => `Hard-coded ${candidate.kind}: ${candidate.raw}`), ...extracted.unchecked.map(issue => `Unresolved CSS: ${issue.detail}`)];
  }) : [];
  let library = 0;
  const sourceView = sourceViewQualifier(input);
  const allowed = new Set<string>(STRUCTURAL_TAGS), today = input.now ?? new Date().toISOString().slice(0, 10);
  for (const file of [...input.files].sort((a, b) => a.file.localeCompare(b.file))) {
    const parsed: Parsed = /\.[cm]?tsx$|\.[cm]?jsx?$/.test(file.file) ? parseJsx(file.content) : { exports: [], definitions: [], nonCode: [], importBindings: [], contextProviders: new Set<string>(), modules: new Set<string>(), comments: [], elements: [], imports: new Map(), unresolved: [] }, duplicates = new Map<string, number>();
    const lineAt = (start: number) => file.content.slice(0, start).split("\n").length;
    scanned.push({ file: file.file, elements: parsed.elements.length });
    const add = (code: DogfoodCode, node: Element, evidence: string, slotId: string | null = null, missing?: string) => {
      const hash = elementHash(file.content.slice(node.start, node.end)), base = `${file.file}#${node.tag}@${hash.slice(7, 19)}`;
      const elementId = base + ((duplicates.get(base) ?? 1) > 1 ? `.${duplicates.get(base)}` : "");
      nodes.set(elementId, { file: file.file, hash });
      const raisedBy = input.contracts?.[file.file]?.id ?? `${file.file}#surface`;
      findings.push({ code, file: file.file, line: lineAt(node.start), tag: node.tag, elementId, raisedBy, slotId, evidence, ...(missing ? { missing } : {}) });
    };
    const consumer = input.consumerBoundary;
    const page = consumer?.pages.includes(file.file) === true;
    const pageChrome = page || consumer?.pageChromeFiles?.includes(file.file) === true;
    // The executable route may be a thin async adapter. Count the lease across
    // its real resolved source graph, while retaining all source/chrome checks.
    const graph = new Set([file.file]);
    if (page && consumer) for (let previous = -1; previous !== graph.size;) {
      previous = graph.size;
      for (const [edge, target] of Object.entries(consumer.sourceImports)) if ([...graph].some(file => edge.startsWith(file + ":"))) graph.add(target);
    }
    const leases = (page ? input.files.filter(source => graph.has(source.file)) : [file]).flatMap(source => {
      const syntax = source === file ? parsed : parseJsx(source.content);
      return syntax.elements.filter(node => pageHeader(node, syntax, input, source.file));
    });
    if (page && (leases.length !== 1 || leases.some(node => !node.attributes.some(attr => attr.name === "id" && attr.value) || !node.attributes.some(attr => attr.name === "header" && attr.value))))
      add("DF8", { tag: "page", start: 0, end: 0, attributes: [] }, "Page composition graph requires exactly one imported PageHeaderModule with explicit id and header.");
    if (consumer) {
      // TypeScript sources (.ts/.mts/.cts) import at runtime too; their modules
      // are collected without JSX so type syntax never reads as markup.
      const sourceModules = /\.[cm]?ts$/.test(file.file) && !/\.d\.[cm]?ts$/.test(file.file) ? parseJsx(file.content, false).modules : parsed.modules;
      if ([...sourceModules].some(rawAria)) add("DF5", { tag: "import", start: 0, end: 0, attributes: [] }, "Raw react-aria-components import bypasses the consumer component boundary.");
      for (const module of [...sourceModules].sort()) if (!rawAria(module) && !qualifiedConsumerModule(module, file.file, input)) {
        const quoted = new RegExp(`(["'])${module.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\1`).exec(file.content), start = quoted?.index ?? 0;
        add("DF5", { tag: "import", start, end: start + (quoted?.[0].length ?? 0), attributes: [] }, `Unqualified external import ${module}: not project source the runner resolved, the React/Next.js runtime, a node: builtin or a ${DOGFOOD_PACKAGE_NAME} entry.`);
      }
      if (/\.css$/.test(file.file)) {
        for (const issue of cssIssues.filter(issue => issue.file === file.file))
          add("DF2", { tag: "css", start: issue.start, end: issue.end, attributes: [] }, issue.evidence);
        for (const issue of dogfoodCssQueryPixels(file.content))
          add("DF2", { tag: "css", start: issue.start, end: issue.end, attributes: [] }, issue.evidence);
      }
    }
    for (const node of parsed.elements) {
      const hash = elementHash(file.content.slice(node.start, node.end)), base = `${file.file}#${node.tag}@${hash.slice(7, 19)}`;
      duplicates.set(base, (duplicates.get(base) ?? 0) + 1); nodes.set(base + (duplicates.get(base)! > 1 ? `.${duplicates.get(base)}` : ""), { file: file.file, hash });
      const attr = (name: string) => node.attributes.find(row => row.name === name);
      if (pageChrome && (["header", "h1", "nav"].includes(node.tag) || (composeAt(file.file, node, parsed, input)?.slotId === "components.tabs" || /(?:^|\.)Tab(?:s|List)?$/.test(node.tag)) && node.attributes.some(row => ["class", "className", "style"].includes(row.name)) || /["']tablist["']/.test(attr("role")?.value ?? "") && node.attributes.some(row => ["class", "className", "style"].includes(row.name))))
        add("DF7", node, "Page heading/navigation belongs to the Frame; hand-styled tab strips are forbidden.");
      let slot: string | undefined;
      if (/^[A-Z]/.test(node.tag)) {
        slot = composeAt(file.file, node, parsed, input)?.slotId;
        if (slot) {
          library++;
          const contract = input.contracts?.[file.file];
          // An unbound page/helper has no authored composition contract to violate.
          if (contract && ![...(contract.allowedComposes ?? []), ...(contract.allowedReads.components ?? [])].includes(slot)) add("DF4", node, `missing-declared-compose: ${slot}`, contract.id);
        }
        else if (sourceView(file.file, node, parsed)) { /* Inspected source composition; no slot or library ownership is invented. */ }
        else if (consumer && (pageHeader(node, parsed, input, file.file) || frameStage(node, parsed) || parsed.contextProviders.has(node.tag) || (() => {
          const identity = importedIdentity(node, parsed, input, file.file);
          const target = identity && consumer.sourceImports[`${file.file}:${identity.original}`];
          return identity && identity.original.startsWith(".") && input.files.some(source => source.file === target);
        })())) { /* Source-owned helpers are checked in their reachable files, never exempted. */ }
        else add("DF5", node, `Unknown visual import or local component <${node.tag}>; no registered slot resolves.`, null, `${node.tag} visual capability`);
      } else {
        const bind = /["']button["']/.test(attr("role")?.value ?? "") ? "components.button" : node.tag === "input" && /["']search["']/.test(attr("type")?.value ?? "") ? "components.search-field" : capabilities[node.tag];
        const styledLink = node.tag === "a" && (attr("className") || attr("style"));
        const roleButton = /["']button["']/.test(attr("role")?.value ?? "");
        if (node.tag === "svg") add("DF3", node, "Inline <svg> must use an assets component or icon id.", bind ?? null);
        else if (interactive.has(node.tag) || styledLink || roleButton || !allowed.has(node.tag) && node.tag !== "a") add("DF1", node, `Raw <${node.tag}> has no library component.${bind ? ` Bind ${bind}.` : ""}`, bind ?? null, bind ? undefined : `${node.tag} visual capability`);
        else {
          const visual = (attr("className")?.value ?? attr("class")?.value ?? "").replace(/["'{}]/g, "").split(/\s+/).some(value => visualClass.test(value.split(":").at(-1)!));
          if (visual) add("DF1", node, `Raw <${node.tag}> has visual classes; bind a library surface.`, null, `${node.tag} visual capability`);
          else if (!attr("style")) structural[node.tag] = (structural[node.tag] ?? 0) + 1;
        }
      }
      for (const attribute of node.attributes) {
        if (consumer && parsed.contextProviders.has(node.tag) && attribute.name === "value") {
          if (/(?:\bstyle|["']style["'])\s*:/.test(attribute.value)) add("DF2", node, "Style object in Provider value remains authored styling.");
          for (const candidate of extractStyleCandidates(attribute.value, file.file).candidates) add("DF2", node, `Hard-coded ${candidate.kind}: ${candidate.raw}`);
        }
        if (!["style", "className", "class", "..."].includes(attribute.name)) continue;
        const text = attribute.value;
        if (consumer && attribute.name === "style") add("DF2", node, "Consumer inline styles bypass library surfaces and tokens.");
        const tokenPart = registeredStudioTokenStyle(file.file, node, attribute, parsed, input);
        if (attribute.name === 'style' && !tokenPart && parsed.definitions.some(definition => definition.exported && definition.start <= node.start && definition.end >= node.end
          && Object.values(STUDIO_SPECIMEN_HOST_PARTS).some(part => part.export === definition.name))) add('DF2', node, 'Registered Studio token host parts require their authenticated fixed style constructor.');
        const isStatic = staticAttribute(attribute) || tokenPart;
        if (attribute.name === "..." || !isStatic) add("DF2", node, `unresolved ${attribute.name}: dynamic source cannot establish token-only styling.`);
        const candidates = extractStyleCandidates(text, file.file).candidates;
        const marked = !consumer && parsed.comments.some(comment => lineAt(comment.start) === lineAt(attribute.start) && /^(?:\/\/|\/\*)\s*token-gate:ignore\b/.test(file.content.slice(comment.start, comment.end)));
        for (const candidate of candidates) {
          if (marked) ignored.push({ file: file.file, line: lineAt(attribute.start), evidence: candidate.raw });
          else add("DF2", node, `Hard-coded ${candidate.kind}: ${candidate.raw}`);
        }
        const observed = scanSurfaceReads([{ path: file.file, content: text }], { id: "attribute", allowedReads: {} }, input.themes ?? [], input.themeCss ?? "")[0]!;
        if (["class", "className"].includes(attribute.name) && isStatic && !marked) {
          const value = attribute.dynamic ? text.slice(1, -1).trim().slice(1, -1) : text.slice(1, -1);
          const unknown = value.split(/\s+/).filter(Boolean).filter(value => { const base = value.split(":").at(-1)!.replace(/^!|!$/g, ""); return !layoutClass.test(base) && !observed.utilities.includes(base) && !base.includes("["); });
          if (unknown.length) add("DF2", node, `unresolved class utilities: ${unknown.join(", ")}`);
        }
        if (attribute.name === "style" && isStatic && !tokenPart && !candidates.length && !observed.properties.length && text.replace(/\s/g, "") !== "{{}}" && !marked) add("DF2", node, "unresolved inline styling: no token read establishes these values.");
        const contract = input.contracts?.[file.file] ?? { id: `${file.file}#surface`, allowedReads: {} };
        for (const finding of scanSurfaceReads([{ path: file.file, content: text }], contract, input.themes ?? [], input.themeCss ?? "")[0]!.findings) add("DF4", node, `${finding.code}: ${finding.reads.join(", ")}`, contract.id);
      }
    }
    for (const issue of parsed.unresolved) add("DF2", { tag: "source", start: issue.start, end: issue.start, attributes: [] }, issue.message);
  }
  for (const exception of exceptions) {
    const node = nodes.get(exception.elementId);
    const valid = node?.file === exception.file && node.hash === exception.hash && /^\d{4}-\d{2}-\d{2}$/.test(exception.expiry) && Number.isFinite(Date.parse(exception.expiry)) && new Date(exception.expiry).toISOString().slice(0, 10) === exception.expiry && exception.expiry >= today && !!exception.name && !!exception.reason && !!exception.owner;
    exception.status = valid ? "current" : "dead";
    if (valid) {
      for (let index = findings.length - 1; index >= 0; index--) if (findings[index]!.elementId === exception.elementId && ["DF1", "DF3", "DF5"].includes(findings[index]!.code)) findings.splice(index, 1);
    } else findings.push({ code: "DF6", file: exception.file, line: 1, tag: "exception", elementId: exception.elementId, raisedBy: exception.name, slotId: null, evidence: `Dead exception ${exception.name}: file, element, hash or expiry does not match.` });
  }
  for (const finding of findings) {
    const need = input.needs?.find(row => row.raisedBy === finding.raisedBy && row.missing === finding.missing && ["open", "proposed", "approved", "built"].includes(row.status));
    if (need) finding.needId = need.id;
  }
  return { schemaVersion: 1, scope: "Static JSX nodes and literal attributes; dynamic styling remains unresolved, not a runtime conformance claim.", ok: findings.length === 0, scanned, findings, structural, exceptions, ignored,
    needs: [...new Set(findings.flatMap(row => row.needId ? [row.needId] : []))].sort(),
    summary: { elements: scanned.reduce((count, row) => count + row.elements, 0), library, structural: Object.values(structural).reduce((sum, count) => sum + count, 0), findings: findings.length } };
}
