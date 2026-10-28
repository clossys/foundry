/**
 * Static wiring checks for sources above Components (Sections, Frames, Pages): WL2 direct
 * token/asset reads without a current wiring exception, WL3 headless-engine imports, WL4 raw
 * values, WL8 generated-artifact drift, WL9 invalid wiring exceptions and WL10 route modules
 * that render anything but the runtime assembly (a Publisher-checked registered nonvisual provider
 * is admitted only at its exact emitted mount). WL1, WL5, WL6 and WL7 are runtime (DOM) codes
 * and belong to the provenance scan. Pure: no I/O; the clock is read only when `now` is omitted.
 * Observations are a static lower bound, never a runtime conformance claim.
 */
import { dogfoodSourceModules, elementHash, runDogfood, type DogfoodException } from "./dogfood.js";
import { scanSurfaceReads, type ConsumptionToken } from "./consumption.js";
import { loadComponentRegistry } from "./component-registry.js";
import { extractStyleCandidates, isPureVarReference } from "../style-extract.js";
import foundryWiringExceptionsDocument from "../catalog/rules/wiring-exceptions.json" with { type: "json" };

/** Foundry's own committed wiring-exception rows (a fresh copy); feed it to `checkWiring({ exceptions })`. */
export const foundryWiringExceptions = (): unknown => structuredClone(foundryWiringExceptionsDocument);

export type WiringCode = "WL1" | "WL2" | "WL3" | "WL4" | "WL5" | "WL6" | "WL7" | "WL8" | "WL9" | "WL10";
/** The closed A3 list. Anything else is a NEED, never an exception. */
export const WIRING_REASON_CODES = Object.freeze(["layout-geometry", "surface-ground", "document-head", "motion-orchestration"] as const);
export type WiringReasonCode = (typeof WIRING_REASON_CODES)[number];
/** `proposed` rows count as warnings until the owner signs them at landing. */
export type WiringExceptionStatus = "proposed" | "signed";
/** A3: a recorded direct read below Components. `read` is the exact slot member. */
export interface WiringException extends DogfoodException { read: string; reasonCode: WiringReasonCode; status: WiringExceptionStatus }
export type WiringExceptionState = "current" | "proposed" | "dead" | "invalid";
export interface WiringFinding { code: WiringCode; severity: "error" | "warning" | "notice"; file: string; line: number; subject: string; evidence: string }
export type WiringLayer = "sections" | "frames" | "pages";
export interface WiringSource { path: string; content: string; layer: WiringLayer }
/** A buildSurfaceConsumption() fill row; only the fields WL2 reads. */
export interface WiringSurfaceFill { id: string; slot: string; sourceFiles: readonly string[]; scannedReads: { tokens: readonly string[]; assets: readonly string[] }; scannedTokenMembers: readonly string[] }
/** One `--check` runner row: the committed bytes and a fresh regeneration (absent: no generator). */
export interface WiringGeneratedArtifact { path: string; committed?: string; regenerated?: string }
/** Publisher's registered-route check output for one nonvisual provider: the exact emitted route
 * bytes and the exact provider bytes its provider proof classified nonvisual, bound by `digest`.
 * Integrity-bound data from that check, not a signature; Designer never runs the provider proof. */
export interface WiringProviderProof {
  kind: "publisher.registered-provider-check";
  version: 1;
  route: { path: string; hash: string };
  provider: { file: string; export: string; hash: string };
  /** The registered original-provider id the check admitted. */
  mount: string;
  digest: string;
}
/** A checked registered nonvisual provider. WL10 admits it only at its exact emitted mount in
 * `route`: wrapping the runtime assembly entry alone. `module` is the specifier `route` imports. */
export interface WiringCheckedProvider { route: string; module: string; export: string; proof: WiringProviderProof }
export interface WiringRoutes {
  modules: readonly { path: string; content: string }[];
  assembly: readonly { module: string; export: string }[];
  /** Publisher-issued provider evidence; a bare identity without its proof admits nothing. */
  providers?: readonly WiringCheckedProvider[];
}
export interface WiringInput {
  /** Files above Components. A file under a registered component leaf's own `components/<leaf>/` directory is exempt. */
  sources: readonly WiringSource[];
  surfaces?: { readonly fills: readonly WiringSurfaceFill[] };
  /** Token inventory for WL2; without it direct token reads stay unmeasured (one notice). */
  tokens?: readonly ConsumptionToken[];
  themeCss?: string;
  /** A wiring-exceptions document (`{ schemaVersion: 1, exceptions: [...] }`) or its row array. */
  exceptions?: unknown;
  routes?: WiringRoutes;
  generated?: readonly WiringGeneratedArtifact[];
  /** Registered component leaf ids; defaults to the component registry's slots and aliases. */
  componentLeaves?: readonly string[];
  now?: string;
}
export interface WiringResult {
  schemaVersion: 1;
  scope: string;
  ok: boolean;
  findings: WiringFinding[];
  exceptions: { name: string; state: WiringExceptionState }[];
  exempt: string[];
  summary: Record<WiringCode, number>;
}

/** The K2 component-check engine list, unchanged and in order, then the A4 React Aria engine list. */
const K2_FORBIDDEN_MODULES = ["@radix-ui/", "radix-ui", "@base-ui/", "@tanstack/", "sonner", "react-resizable-panels", "embla-carousel-react", "input-otp", "recharts", "@headlessui/", "@shadcn/react"];
export const WIRING_HEADLESS_MODULES: readonly string[] = Object.freeze([...K2_FORBIDDEN_MODULES, "react-aria-components", "react-aria", "@react-aria/", "react-stately"]);
const CODES: readonly WiringCode[] = ["WL1", "WL2", "WL3", "WL4", "WL5", "WL6", "WL7", "WL8", "WL9", "WL10"];
const REQUIRED = ["name", "file", "elementId", "hash", "reason", "owner", "expiry", "read"] as const;
const READ_ID = /^(?:tokens|assets)\.[a-z0-9]+(?:-[a-z0-9]+)*(?:\.[a-z0-9]+(?:-[a-z0-9]+)*)?$/;
const VISUAL_MODULE = /(?:^|\/)(?:components|blocks|sections|frames|shell|icons|charts)(?:\/|\.|$)/;
const KEY_LEXICON = /(?:width|height|size|gap|inset|offset|margin|padding|top|left|right|bottom|basis|radius)$/i;
const DECLARATION_LEXICON = /(?:width|height|gap|inset|offset|margin|padding|basis|radius|panel|rail|sidebar|gutter|column|layout|region|inspector|aside)/i;

let registryLeaves: readonly string[] | undefined;
const defaultLeaves = (): readonly string[] => registryLeaves ??= (() => { const registry = loadComponentRegistry(); return [...registry.slots.map(slot => slot.id), ...registry.aliases.map(alias => alias.id)]; })();

/** "Above Components" is resolved through the component registry: a fill's own `components/<leaf>/` files are Components. */
export function wiringScope(path: string, componentLeaves: readonly string[] = defaultLeaves()): "components" | "above" {
  const parts = path.split("/");
  for (let index = 0; index < parts.length - 2; index++) if (parts[index] === "components" && componentLeaves.includes(`components.${parts[index + 1]}`)) return "components";
  return "above";
}

const lineAt = (content: string, index: number): number => content.slice(0, Math.max(0, index)).split("\n").length;
const isCss = (path: string): boolean => path.endsWith(".css");
const isJsx = (path: string): boolean => /\.[cm]?[jt]sx$/.test(path);
const isValidDay = (value: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;

/** Blank comments (and optionally string bodies) while keeping offsets and line breaks. */
function mask(source: string, css: boolean, strings: boolean): string {
  const out = source.split("");
  const blank = (from: number, to: number) => { for (let at = from; at < to; at++) if (out[at] !== "\n") out[at] = " "; };
  for (let i = 0; i < source.length;) {
    const char = source[i], next = source[i + 1];
    if (char === "/" && next === "*") { const end = source.indexOf("*/", i + 2), stop = end < 0 ? source.length : end + 2; blank(i, stop); i = stop; continue; }
    if (!css && char === "/" && next === "/") { const end = source.indexOf("\n", i), stop = end < 0 ? source.length : end; blank(i, stop); i = stop; continue; }
    if (char === '"' || char === "'" || (!css && char === "`")) {
      let j = i + 1;
      while (j < source.length && source[j] !== char && (char === "`" || source[j] !== "\n")) j += source[j] === "\\" ? 2 : 1;
      const stop = Math.min(j + 1, source.length);
      if (strings) blank(i + 1, stop - 1);
      i = stop; continue;
    }
    i++;
  }
  return out.join("");
}

/** Static, type-only, side-effect, dynamic and require specifiers, plus the shared dogfood source walk. */
function importScan(path: string, content: string): { module: string; line: number }[] {
  if (isCss(path)) return [];
  const code = mask(content, false, false), rows = new Map<string, number>();
  for (const pattern of [/\b(?:import|export)\b(?:\s+type\b)?[^;"'`]*?\bfrom\s*(["'])([^"'\n]+)\1/g, /\bimport\s*(["'])([^"'\n]+)\1/g, /\bimport\s*\(\s*(["'])([^"'\n]+)\1\s*\)/g, /\brequire\s*\(\s*(["'])([^"'\n]+)\1\s*\)/g])
    for (const match of code.matchAll(pattern)) if (!rows.has(match[2]!)) rows.set(match[2]!, lineAt(content, match.index!));
  for (const module of dogfoodSourceModules(content)) if (!rows.has(module)) rows.set(module, 1);
  return [...rows].map(([module, line]) => ({ module, line }));
}
const headless = (module: string): boolean => WIRING_HEADLESS_MODULES.some(entry => entry.endsWith("/") ? module.startsWith(entry) : module === entry || module.startsWith(`${entry}/`));

/** Split an object-literal body on top-level commas, respecting strings and nesting. */
function entries(body: string): string[] {
  const rows: string[] = []; let depth = 0, quote = "", start = 0;
  for (let i = 0; i < body.length; i++) {
    const char = body[i]!;
    if (quote) { if (char === "\\") i++; else if (char === quote) quote = ""; continue; }
    if (char === '"' || char === "'" || char === "`") quote = char;
    else if ("([{".includes(char)) depth++;
    else if (")]}".includes(char)) depth--;
    else if (char === "," && depth === 0) { rows.push(body.slice(start, i)); start = i + 1; }
  }
  rows.push(body.slice(start));
  return rows.map(row => row.trim()).filter(Boolean);
}
function balanced(source: string, open: number): number {
  let depth = 0, quote = "";
  for (let i = open; i < source.length; i++) {
    const char = source[i]!;
    if (quote) { if (char === "\\") i++; else if (char === quote) quote = ""; continue; }
    if (char === '"' || char === "'" || char === "`") quote = char;
    else if (char === "{") depth++;
    else if (char === "}" && --depth === 0) return i;
  }
  return source.length;
}

function rawValues(source: WiringSource): WiringFinding[] {
  const findings: WiringFinding[] = [], css = isCss(source.path), content = source.content;
  const add = (index: number, evidence: string) => findings.push({ code: "WL4", severity: "error", file: source.path, line: lineAt(content, index), subject: source.path, evidence });
  // DF2's literal extractor (comments skipped). Arbitrary utilities are raw even when they wrap a bare var().
  for (const candidate of extractStyleCandidates(content, source.path).candidates)
    findings.push({ code: "WL4", severity: "error", file: source.path, line: candidate.line, subject: source.path, evidence: `Hard-coded ${candidate.kind}: ${candidate.raw}${candidate.hasIgnoreMarker ? " (token-gate:ignore does not apply to wiring)" : ""}` });
  const commentFree = mask(content, css, false);
  for (const match of commentFree.matchAll(/var\(\s*(--[\w-]+)\s*,/g)) add(match.index!, `var() fallback for ${match[1]}: only a bare custom-property read without a fallback is legitimate`);
  for (const match of commentFree.matchAll(/(?<![\w.])\d+(?:\.\d+)?ms(?![\w])/g)) add(match.index!, `Hard-coded duration: ${match[0]}`);
  if (css) return findings;
  const code = mask(content, false, true);
  for (const match of code.matchAll(/(?<![\w$.])(\d+(?:\.\d+)?)(?![\w$.%])/g)) {
    if (Number(match[1]) === 0 || Number(match[1]) === 1) continue;
    const before = code.slice(0, match.index!);
    // `width: 240`, `width={240}`, `gap = 8`; a comparison (`==`, `>=`) never matches because the key must touch the operator.
    const key = /([A-Za-z_$][\w$]*)\s*(?::|=)\s*\{?\s*-?\s*$/.exec(before.slice(-120));
    // A constant's own initializer (`const RAIL_WIDTH = 240`, `const PANEL = { min: 220 }`), never a function body.
    const declaration = [...before.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)].at(-1);
    const initializer = declaration ? before.slice(declaration.index! + declaration[0].length) : "";
    const inDeclaration = declaration && !/;|=>|\bfunction\b/.test(initializer) ? declaration[1]! : undefined;
    const subject = key && KEY_LEXICON.test(key[1]!) ? key[1] : inDeclaration && DECLARATION_LEXICON.test(inDeclaration) ? inDeclaration : undefined;
    if (subject) add(match.index!, `JS numeric layout constant ${subject} = ${match[1]}`);
  }
  if (!isJsx(source.path)) return findings;
  for (const match of commentFree.matchAll(/\bstyle\s*=\s*\{/g)) {
    const open = match.index! + match[0].length - 1, close = balanced(commentFree, open), inner = content.slice(open + 1, close).trim();
    if (!inner.startsWith("{") || !inner.endsWith("}")) { add(match.index!, "Dynamic inline style cannot be resolved to a custom-property hand-off"); continue; }
    for (const entry of entries(inner.slice(1, -1))) {
      const pair = /^(["'])(--[\w-]+)\1\s*:\s*(["'])(.*)\3$/s.exec(entry);
      if (!pair || !isPureVarReference(pair[4]!)) add(match.index!, `Inline style is not a custom-property hand-off from a token read: ${entry}`);
    }
  }
  return findings;
}

const IDENT = "[A-Za-z_$][\\w$]*";
const SHA256 = /^sha256:[0-9a-f]{64}$/;
const PROVIDER_PROOF_KIND = "publisher.registered-provider-check";
const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
const record = (value: unknown, keys: readonly string[]): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value) && Object.keys(value).sort().join(",") === [...keys].sort().join(",");
const text = (value: unknown): value is string => typeof value === "string" && value.length > 0;
/** The digest Publisher binds over a proof's fields, in this order. */
const providerProofDigest = (proof: WiringProviderProof): string =>
  elementHash(JSON.stringify([proof.kind, proof.version, proof.route.path, proof.route.hash, proof.provider.file, proof.provider.export, proof.provider.hash, proof.mount]));
/** A relative specifier resolved against the importing file's consumer-relative path. */
function relativeTarget(from: string, specifier: string): string | undefined {
  if (!/^\.\.?\//.test(specifier)) return undefined;
  const parts = from.split("/"); parts.pop();
  for (const part of specifier.split("/")) {
    if (part === ".") continue;
    if (part === "..") { if (!parts.length || parts.at(-1) === "..") return undefined; parts.pop(); continue; }
    if (!part) return undefined;
    parts.push(part);
  }
  return parts.join("/");
}
/** Whether `code` binds `local` to `module#exportName` through one plain import clause. */
function importsLocal(code: string, local: string, module: string, exportName: string): boolean {
  for (const match of code.matchAll(/\bimport\s+(?!type\b)([^;"'`]*?)\s*from\s*(["'])([^"'\n]+)\2/g)) {
    if (match[3] !== module) continue;
    const clause = match[1]!, named = /\{([^}]*)\}/.exec(clause), primary = /^\s*([A-Za-z_$][\w$]*)\s*(?:,|$)/.exec(clause);
    if (exportName === "default" && primary?.[1] === local) return true;
    for (const part of named?.[1]?.split(",") ?? []) {
      const binding = /^\s*([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?\s*$/.exec(part);
      if (binding && binding[1] === exportName && (binding[2] ?? binding[1]) === local) return true;
    }
  }
  return false;
}

/** WL10 admission for one checked provider claim on one route module: the Publisher proof for
 * these exact route bytes, the proved provider identity as the route imports it, and the exact
 * emitted mount (the provider wraps the assembly entry alone as the default export's
 * whole return, receiving only typed loader data when registered). Any other shape is refused, never partly admitted. */
function checkedProviderMount(route: { path: string; content: string }, claim: unknown, assembly: WiringRoutes["assembly"]): { admitted: string } | { refused: string } {
  if (!record(claim, ["route", "module", "export", "proof"]) || !text(claim.route) || !text(claim.module) || !text(claim.export) || !(claim.export === "default" || new RegExp(`^${IDENT}$`).test(claim.export)))
    return { refused: "evidence is not { route, module, export, proof }" };
  // Provenance: only the Publisher check's proof, bound to these exact route bytes, admits anything.
  const proof = claim.proof;
  if (!record(proof, ["kind", "version", "route", "provider", "mount", "digest"]) || proof.kind !== PROVIDER_PROOF_KIND || proof.version !== 1 || !text(proof.mount) || !text(proof.digest)
    || !record(proof.route, ["path", "hash"]) || !text(proof.route.path) || !text(proof.route.hash) || !SHA256.test(proof.route.hash)
    || !record(proof.provider, ["file", "export", "hash"]) || !text(proof.provider.file) || !text(proof.provider.export) || !text(proof.provider.hash) || !SHA256.test(proof.provider.hash))
    return { refused: "no Publisher registered-provider proof" };
  if (proof.digest !== providerProofDigest(proof as unknown as WiringProviderProof)) return { refused: "the proof digest does not match its fields" };
  if (claim.route !== route.path || proof.route.path !== route.path || proof.route.hash !== elementHash(route.content)) return { refused: "the proof does not bind this route module's exact bytes" };
  // Identity: the claimed module and export are the proved provider, as this route imports it.
  if (claim.export !== proof.provider.export || relativeTarget(route.path, claim.module) !== proof.provider.file) return { refused: "the claimed module or export is not the proved provider" };
  // Raw text must spell every name the module binds (no parser ships at runtime): an escape
  // (a backslash-u code point spelling RegisteredProvider) or direct eval could bind a name no read below sees.
  if (/\\u/.test(route.content)) return { refused: "the route module spells a name through a \\u escape" };
  const code = mask(route.content, false, false), bare = mask(route.content, false, true);
  if (/(?<![\w$])eval(?![\w$])/.test(code)) return { refused: "the route module calls eval" };
  // Exactly one import from the provider module, binding exactly the proved export.
  const specifier = escapeRegExp(claim.module);
  const statements = [...code.matchAll(new RegExp(`\\bimport\\b[^;"'\`]*?\\bfrom\\s*(["'])${specifier}\\1\\s*;?`, "g"))];
  const clause = claim.export === "default" ? `\\s+(${IDENT})\\s+` : `\\s*\\{\\s*${escapeRegExp(claim.export)}(?:\\s+as\\s+(${IDENT}))?\\s*\\}\\s*`;
  const binding = statements.length === 1 ? new RegExp(`^import${clause}from\\s*(["'])${specifier}\\2\\s*;?$`).exec(statements[0]![0]) : null;
  if (!binding) return { refused: "the route does not import the proved provider exactly once" };
  const local = binding[1] ?? claim.export, name = escapeRegExp(local);
  // Used only by the mount: its import binding, its opening tag and its closing tag.
  if ((bare.match(new RegExp(`(?<![\\w$])${name}(?![\\w$])`, "g")) ?? []).length !== 3) return { refused: `${local} is used outside its one mount` };
  // The exact emitted module: an optional "use client" directive and imports, then only the default
  // export, whose whole body returns the provider around the one assembly entry.
  const leadingImport = /^\s*import\b[^;"'`]*?(["'])[^"'\n]+\1\s*;?/;
  let rest = code.replace(/^\s*(["'])use client\1\s*;?/, "");
  while (leadingImport.test(rest)) rest = rest.replace(leadingImport, "");
  const entry = `<(${IDENT})(?:\\s+${IDENT}=(?:\\{\\s*${IDENT}\\s*\\}|"[^"\\n]*"))*\\s*\\/>`;
  const plain = new RegExp(`^\\s*export\\s+default\\s+function(?:\\s+${IDENT})?\\s*\\(\\s*\\)\\s*\\{\\s*return\\s*<${name}>${entry}<\\/${name}>\\s*;?\\s*\\}\\s*$`).exec(rest);
  // The loader variant is the emitter's one typed data parameter, passed unchanged
  // to both the proved provider and the server-data assembly entry.
  const loaded = new RegExp(`^\\s*export\\s+default\\s+function(?:\\s+${IDENT})?\\s*\\(\\s*\\{\\s*data\\s*\\}\\s*:\\s*\\{\\s*readonly\\s+data\\s*:\\s*RegisteredRouteServerData<typeof RegisteredLoader>\\s*\\}\\s*\\)\\s*\\{\\s*return\\s*<${name} data=\\{data\\}>${entry}<\\/${name}>\\s*;?\\s*\\}\\s*$`).exec(rest);
  const shape = plain ?? loaded;
  if (!shape) return { refused: `the module is not the exact emitted provider mount around one assembly entry` };
  const tag = shape[1]!;
  if (loaded && (!importsLocal(code, tag, "@clossys/publisher/web/registered-route", "RegisteredServerDataRoutePage")
    || !new RegExp(`<${escapeRegExp(tag)}[^>]*\\sdata=\\{data\\}`).test(rest)
    || !/import\s+type\s*\{\s*RegisteredRouteServerData\s*\}\s*from\s*["']@clossys\/publisher\/web\/registered-route["']/.test(code)
    || !/import\s+type\s+(?:RegisteredLoader|\{\s*[A-Za-z_$][\w$]*\s+as\s+RegisteredLoader\s*\})\s+from\s*["'][^"'\n]+["']/.test(code)))
    return { refused: "the provider data mount is not bound to the typed server-data assembly" };
  if (!assembly.some(row => importsLocal(code, tag, row.module, row.export))) return { refused: `<${tag}> inside ${local} is not the runtime assembly entry` };
  return { admitted: `${route.path}:${claim.module}#${claim.export}` };
}

/** WL9: validates a wiring-exceptions document. Liveness reuses DF6 semantics: a changed hash or a past expiry is dead.
 * JSX files anchor an element (`file#tag@hash12`); any file may anchor itself whole (`file#file@hash12`, hash of the file). */
export function readWiringExceptions(document: unknown, files: readonly { path: string; content: string }[], now?: string): { exceptions: { row: WiringException; state: WiringExceptionState }[]; findings: WiringFinding[] } {
  const today = now ?? new Date().toISOString().slice(0, 10), findings: WiringFinding[] = [], exceptions: { row: WiringException; state: WiringExceptionState }[] = [];
  const fail = (file: string, subject: string, evidence: string, severity: WiringFinding["severity"] = "error") => findings.push({ code: "WL9", severity, file, line: 1, subject, evidence });
  if (document === undefined) return { exceptions, findings };
  const rows: unknown = Array.isArray(document) ? document : typeof document === "object" && document !== null && (document as { schemaVersion?: unknown }).schemaVersion === 1 ? (document as { exceptions?: unknown }).exceptions : undefined;
  if (!Array.isArray(rows)) { fail("", "wiring-exceptions", "Unreadable wiring-exceptions document: expected { schemaVersion: 1, exceptions: [] }"); return { exceptions, findings }; }
  const names = new Map<string, number>();
  for (const row of rows) { const name = (row as { name?: unknown } | null)?.name; if (typeof name === "string") names.set(name, (names.get(name) ?? 0) + 1); }
  rows.forEach((value, index) => {
    const row = (typeof value === "object" && value !== null ? value : {}) as Record<string, unknown>;
    const subject = typeof row.name === "string" && row.name ? row.name : `#${index}`, file = typeof row.file === "string" ? row.file : "";
    const problems = [
      ...REQUIRED.filter(field => typeof row[field] !== "string" || !(row[field] as string).trim()).map(field => `missing ${field}`),
      ...(WIRING_REASON_CODES as readonly unknown[]).includes(row.reasonCode) ? [] : [`reasonCode ${JSON.stringify(row.reasonCode ?? null)} is outside A3 (${WIRING_REASON_CODES.join(", ")})`],
      ...row.status === "proposed" || row.status === "signed" ? [] : [`status ${JSON.stringify(row.status ?? null)} is not proposed or signed`],
      ...typeof row.read === "string" && row.read && !READ_ID.test(row.read) ? [`read ${row.read} is not a tokens.* or assets.* slot member`] : [],
      ...typeof row.hash === "string" && row.hash && !/^sha256:[0-9a-f]{64}$/.test(row.hash) ? ["hash is not sha256:<64 hex>"] : [],
      ...typeof row.elementId === "string" && file && !row.elementId.startsWith(`${file}#`) ? ["elementId does not address its file"] : [],
      ...typeof row.name === "string" && (names.get(row.name) ?? 0) > 1 ? ["duplicate name"] : [],
    ];
    if (problems.length) { fail(file, subject, `Invalid wiring exception ${subject}: ${problems.join("; ")}`); exceptions.push({ row: row as unknown as WiringException, state: "invalid" }); return; }
    const exception = row as unknown as WiringException, content = files.find(source => source.path === exception.file)?.content;
    const dated = isValidDay(exception.expiry) && exception.expiry >= today;
    const live = content !== undefined && (exception.elementId === `${exception.file}#file@${exception.hash.slice(7, 19)}`
      ? dated && exception.hash === elementHash(content)
      // runDogfood writes its own status onto the rows it is given; pass a copy so the wiring status survives.
      : runDogfood({ files: [{ file: exception.file, content }], exceptions: [{ ...exception }], now: today }).exceptions[0]?.status === "current");
    if (!live) { fail(exception.file, subject, `Dead wiring exception ${subject}: ${content === undefined ? "file unavailable" : "file, element, hash or expiry does not match"}.`); exceptions.push({ row: exception, state: "dead" }); return; }
    if (exception.status === "proposed") fail(exception.file, subject, `Proposed wiring exception ${subject} (${exception.reasonCode}, ${exception.read}) is unsigned; it counts as a warning until the owner signs it.`, "warning");
    exceptions.push({ row: exception, state: exception.status === "proposed" ? "proposed" : "current" });
  });
  return { exceptions, findings };
}

/** Runs every static WL check. WL1, WL5, WL6 and WL7 need rendered DOM and are never emitted here. */
export function checkWiring(input: WiringInput): WiringResult {
  const leaves = input.componentLeaves ?? defaultLeaves(), findings: WiringFinding[] = [], exempt: string[] = [];
  const sources = input.sources.filter(source => wiringScope(source.path, leaves) === "above" || (exempt.push(source.path), false));
  const read = readWiringExceptions(input.exceptions, [...input.sources, ...input.routes?.modules ?? []], input.now);
  findings.push(...read.findings);
  const covering = read.exceptions.filter(row => row.state === "current" || row.state === "proposed").map(row => row.row);
  const covered = (files: readonly string[], member: string): boolean => covering.some(row => row.read === member && files.includes(row.file));
  // WL2: direct reads in the source itself; reads inside a registered component are that component's own.
  if (!input.tokens && sources.length) findings.push({ code: "WL2", severity: "notice", file: "", line: 0, subject: "tokens", evidence: "Token inventory not supplied; direct token reads are unmeasured, not clean." });
  const property = new Map<string, string>();
  for (const token of input.tokens ?? []) for (const [member, name] of Object.entries(token.contract.emit ?? {})) property.set(`${token.id}.${member}`, name);
  for (const source of sources) {
    const scan = scanSurfaceReads([{ path: source.path, content: mask(source.content, isCss(source.path), false) }], { id: source.path, allowedReads: {} }, input.tokens ?? [], input.themeCss ?? "")[0]!;
    for (const member of [...scan.tokenMembers, ...scan.assets]) if (!covered([source.path], member)) {
      const at = source.content.indexOf(property.get(member) ?? member);
      findings.push({ code: "WL2", severity: "error", file: source.path, line: at < 0 ? 1 : lineAt(source.content, at), subject: source.path, evidence: `${source.layer} reads ${member} directly with no current wiring exception (A3)` });
    }
  }
  for (const fill of input.surfaces?.fills ?? []) {
    if (!/^(?:sections|frames)\./.test(fill.slot) || (fill.sourceFiles.length && fill.sourceFiles.every(file => wiringScope(file, leaves) === "components"))) continue;
    for (const member of [...fill.scannedTokenMembers, ...fill.scannedReads.assets]) if (!covered(fill.sourceFiles, member))
      findings.push({ code: "WL2", severity: "error", file: fill.sourceFiles[0] ?? "", line: 1, subject: fill.slot, evidence: `${fill.id} reads ${member} directly with no current wiring exception (A3)` });
  }
  for (const source of sources) {
    for (const row of importScan(source.path, source.content)) if (headless(row.module))
      findings.push({ code: "WL3", severity: "error", file: source.path, line: row.line, subject: source.path, evidence: `Headless-engine import ${row.module} above Components; compose a components.* leaf instead` });
    findings.push(...rawValues(source));
  }
  for (const row of input.generated ?? []) {
    const evidence = row.regenerated === undefined ? "has no generator" : row.committed === undefined ? "committed artifact is missing" : row.committed !== row.regenerated ? "differs from regeneration" : undefined;
    if (!evidence) continue;
    const committed = row.committed?.split("\n") ?? [], fresh = row.regenerated?.split("\n") ?? [];
    let line = 0; while (line < committed.length && committed[line] === fresh[line]) line++;
    findings.push({ code: "WL8", severity: "error", file: row.path, line: line + 1, subject: row.path, evidence: `Generated artifact ${row.path} ${evidence}` });
  }
  if (input.routes) {
    const assemblyModules = new Set(input.routes.assembly.map(row => row.module));
    if (!input.routes.assembly.length) findings.push({ code: "WL10", severity: "error", file: "", line: 0, subject: "routes", evidence: "No runtime assembly identity supplied; route modules cannot be checked." });
    const claims: readonly unknown[] = input.routes.providers ?? [], claimed = (claim: unknown): unknown => (claim as { route?: unknown } | null)?.route;
    for (const claim of claims) if (!input.routes.modules.some(route => route.path === claimed(claim)))
      findings.push({ code: "WL10", severity: "error", file: String(claimed(claim) ?? ""), line: 1, subject: "routes", evidence: "Checked provider evidence names no supplied route module; nothing is admitted." });
    for (const route of input.routes.modules) {
      const add = (line: number, evidence: string) => findings.push({ code: "WL10", severity: "error", file: route.path, line, subject: route.path, evidence });
      for (const row of importScan(route.path, route.content)) if (!assemblyModules.has(row.module) && (VISUAL_MODULE.test(row.module) || headless(row.module)))
        add(row.line, `Route module imports ${row.module} instead of only the runtime assembly`);
      const resolvedImports: Record<string, string> = Object.fromEntries(input.routes.assembly.map(row => [`${route.path}:${row.module}#${row.export}`, "pages.runtime-assembly"]));
      // A checked registered nonvisual provider resolves only at its exact emitted mount; a refused claim admits nothing.
      const mine = claims.filter(claim => claimed(claim) === route.path);
      if (mine.length > 1) add(1, "More than one checked provider claims this route module; none is admitted.");
      else if (mine.length === 1) {
        const verdict = checkedProviderMount(route, mine[0], input.routes.assembly);
        if ("admitted" in verdict) resolvedImports[verdict.admitted] = "pages.registered-provider";
        else add(1, `Checked provider is not admitted: ${verdict.refused}`);
      }
      // The shared dogfood JSX walk; only the supplied assembly identities (and an admitted provider mount) resolve, so every other element is reported.
      const report = runDogfood({ files: [{ file: route.path, content: route.content }], resolvedImports });
      const seen = new Set<string>();
      for (const row of report.findings) if (["DF1", "DF2", "DF3", "DF5"].includes(row.code) && !seen.has(row.elementId)) { seen.add(row.elementId); add(row.line, `Route module renders <${row.tag}> outside the runtime assembly`); }
      const code = mask(route.content, false, true);
      for (const [tag, count] of Object.entries(report.structural)) { const at = code.search(new RegExp(`<${tag}\\b`)); add(at < 0 ? 1 : lineAt(route.content, at), `Route module renders raw structural <${tag}> markup (${count}) outside the runtime assembly`); }
    }
  }
  const order = (code: WiringCode) => CODES.indexOf(code);
  const unique = [...new Map(findings.map(row => [JSON.stringify(row), row])).values()]
    .sort((a, b) => order(a.code) - order(b.code) || a.file.localeCompare(b.file) || a.line - b.line || a.evidence.localeCompare(b.evidence));
  return {
    schemaVersion: 1,
    scope: "Static sources above Components, wiring exceptions, generated-artifact rows and route modules; a lower bound, not runtime conformance. WL1, WL5, WL6 and WL7 are runtime codes.",
    ok: !unique.some(row => row.severity === "error"),
    findings: unique,
    exceptions: read.exceptions.map(row => ({ name: typeof row.row.name === "string" ? row.row.name : "", state: row.state })),
    exempt: exempt.sort(),
    summary: Object.fromEntries(CODES.map(code => [code, unique.filter(row => row.code === code).length])) as Record<WiringCode, number>,
  };
}
