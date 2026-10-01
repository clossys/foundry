/**
 * Report-mode site conformance scan (slice 1 of #1515). Pure and `node:fs`
 * only: it imports nothing from another package. It never echoes matched
 * source text -- a finding is a rule id, a repository-relative file and a
 * line, nothing else.
 */
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, join, posix, relative, resolve, sep } from "node:path";

export const SITE_CONFORMANCE_RULES = ["site/route-not-publisher-view", "site/template-route-duplicate", "site/raw-style-literal"] as const;
export type SiteConformanceRule = (typeof SITE_CONFORMANCE_RULES)[number];
/** `site/waiver-unused` and `site/symlink-unscanned` are never waivable: a waiver cannot vouch for what was not read. */
export type SiteConformanceFindingRule = SiteConformanceRule | "site/waiver-unused" | "site/symlink-unscanned";

export const DEFAULT_SITE = "apps/site";
export const WAIVERS_PATH = "clossys/conformance-waivers.json";
export const ROUTE_MANIFEST_FILE = "web-route-manifest.json";

export interface SiteConformanceFinding {
  readonly rule: SiteConformanceFindingRule;
  readonly file: string;
  readonly line: number;
}

export interface SiteConformanceWaived extends SiteConformanceFinding {
  readonly reason: string;
}

export interface SiteConformanceResult {
  readonly mode: "report";
  readonly site: string;
  readonly filesScanned: number;
  readonly findings: readonly SiteConformanceFinding[];
  readonly waived: readonly SiteConformanceWaived[];
}

/** The scan could not run (exit 2): a missing directory, zero files, an unreadable file, a symlinked site, a bad waiver file or manifest. */
export class SiteConformanceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SiteConformanceError";
  }
}

const PUBLISHER_WEB = "@clossys/publisher/web";
const SKIPPED_DIRS = new Set(["node_modules", ".next"]);
const VIEW_FILES = new Set(["page.tsx", "not-found.tsx", "error.tsx"]);
const TEMPLATE_SEGMENT_RE = /^(privacy|terms|legal|about|contact)(-.+)?$/;
const IGNORE_MARKER = "token-gate:ignore";
const HEX_COLOUR_RE = /(?<![0-9A-Za-z_-])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![0-9A-Za-z_-])/;
const COLOUR_FUNCTION_RE = /\b(?:rgb|hsl|oklch)\(/;
const STRING_RE = /"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\\n]|\\.)*`/g;

function readJson(path: string, what: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch {
    throw new SiteConformanceError(`${what} is missing or is not valid JSON`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** Reads a source file; any failure is "could not run", never a raw system error and never a clean result. */
function readSource(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    throw new SiteConformanceError("a source file under the site could not be read");
  }
}

/** Whether a symlink in the app tree hides source this scan would otherwise have read. */
function hidesSource(path: string, name: string): boolean {
  if (name.endsWith(".ts") || name.endsWith(".tsx")) return true;
  try {
    return statSync(path).isDirectory();
  } catch {
    return true; // a dangling link cannot be shown to hide nothing
  }
}

function collectSources(dir: string, out: string[], links: string[]): void {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    throw new SiteConformanceError("a site directory could not be read");
  }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isSymbolicLink()) {
      if (hidesSource(path, entry.name)) links.push(path);
    } else if (entry.isDirectory()) {
      if (!SKIPPED_DIRS.has(entry.name)) collectSources(path, out, links);
    } else if (entry.isFile() && (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx"))) {
      out.push(path);
    }
  }
}

function isIdentifierChar(code: number): boolean {
  return (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || code === 95 || code === 36 || code > 127;
}

/** Index just past whitespace and comments starting at `i`. */
function skipTrivia(source: string, i: number): number {
  const n = source.length;
  while (i < n) {
    const ch = source.charCodeAt(i);
    if (ch === 32 || ch === 9 || ch === 10 || ch === 13 || ch === 11 || ch === 12 || ch === 0xa0 || ch === 0xfeff) {
      i += 1;
    } else if (ch === 47 && source.charCodeAt(i + 1) === 47) {
      const end = source.indexOf("\n", i);
      i = end === -1 ? n : end;
    } else if (ch === 47 && source.charCodeAt(i + 1) === 42) {
      const end = source.indexOf("*/", i + 2);
      i = end === -1 ? n : end + 2;
    } else {
      break;
    }
  }
  return i;
}

/** Reads a quoted string opening at `start`; `end` is just past it, `value` is undefined when it ran to a newline or the end. */
function readQuoted(source: string, start: number): { readonly end: number; readonly value: string | undefined } {
  const quote = source.charCodeAt(start);
  const n = source.length;
  let i = start + 1;
  while (i < n) {
    const ch = source.charCodeAt(i);
    if (ch === quote) return { end: i + 1, value: source.slice(start + 1, i) };
    if (ch === 10 || ch === 13) return { end: i, value: undefined };
    i += ch === 92 ? 2 : 1;
  }
  return { end: n, value: undefined };
}

/**
 * Module specifiers named by `from "x"`, `import "x"` and `import("x")`, found
 * in one linear pass that tracks comments, strings and template literals, so
 * a commented-out or quoted import never counts and no input can make the
 * scan superlinear. A single pass is not a grammar: regular-expression
 * literals are not recognised (one containing a quote ends at its line).
 */
function importSpecifiers(source: string): string[] {
  const specs: string[] = [];
  const n = source.length;
  const templates: number[] = []; // open `${` brace depth, one entry per template being interpolated
  let i = 0;
  let previous = 0; // previous significant character code
  let inTemplate = false;
  while (i < n) {
    if (inTemplate) {
      const ch = source.charCodeAt(i);
      if (ch === 92) {
        i += 2;
      } else if (ch === 96) {
        inTemplate = false;
        previous = ch;
        i += 1;
      } else if (ch === 36 && source.charCodeAt(i + 1) === 123) {
        templates.push(0);
        inTemplate = false;
        previous = 123;
        i += 2;
      } else {
        i += 1;
      }
      continue;
    }
    const ch = source.charCodeAt(i);
    if (ch === 47 && (source.charCodeAt(i + 1) === 47 || source.charCodeAt(i + 1) === 42)) {
      i = skipTrivia(source, i);
    } else if (ch === 34 || ch === 39) {
      i = readQuoted(source, i).end;
      previous = ch;
    } else if (ch === 96) {
      inTemplate = true;
      i += 1;
    } else if (ch === 123 && templates.length > 0) {
      templates[templates.length - 1] = (templates[templates.length - 1] as number) + 1;
      previous = ch;
      i += 1;
    } else if (ch === 125 && templates.length > 0) {
      if (templates[templates.length - 1] === 0) {
        templates.pop();
        inTemplate = true;
      } else {
        templates[templates.length - 1] = (templates[templates.length - 1] as number) - 1;
      }
      previous = ch;
      i += 1;
    } else if (isIdentifierChar(ch)) {
      const start = i;
      while (i < n && isIdentifierChar(source.charCodeAt(i))) i += 1;
      const word = source.slice(start, i);
      if ((word === "from" || word === "import") && previous !== 46) {
        let j = skipTrivia(source, i);
        if (source.charCodeAt(j) === 40) j = skipTrivia(source, j + 1);
        const next = source.charCodeAt(j);
        if (next === 34 || next === 39) {
          const { value } = readQuoted(source, j);
          if (value !== undefined && value !== "") specs.push(value);
        }
      }
      previous = source.charCodeAt(i - 1);
    } else {
      if (ch > 32) previous = ch;
      i += 1;
    }
  }
  return specs;
}

function importsPublisherWeb(source: string): boolean {
  return importSpecifiers(source).some((spec) => spec === PUBLISHER_WEB || spec.startsWith(`${PUBLISHER_WEB}/`));
}

function resolveRelative(fromFile: string, spec: string): string | undefined {
  const base = resolve(fromFile, "..", spec);
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")]) {
    try {
      if (statSync(candidate).isFile()) return candidate;
    } catch {
      // try the next candidate
    }
  }
  return undefined;
}

/** Direct, or through exactly one relative import (the imported file's own imports are not followed). */
function reachesPublisherView(file: string, source: string): boolean {
  if (importsPublisherWeb(source)) return true;
  for (const spec of importSpecifiers(source)) {
    if (!spec.startsWith(".")) continue;
    const target = resolveRelative(file, spec);
    if (target === undefined) continue;
    try {
      if (importsPublisherWeb(readFileSync(target, "utf8"))) return true;
    } catch {
      // an unreadable import is not a Publisher view
    }
  }
  return false;
}

function routeOf(appDir: string, file: string): string {
  const segments = relative(appDir, file)
    .split(sep)
    .slice(0, -1)
    .filter((segment) => !(segment.startsWith("(") && segment.endsWith(")")));
  return `/${segments.join("/")}`;
}

function loadManifestRouteIds(siteDir: string): ReadonlySet<string> {
  const manifestPath = join(siteDir, ROUTE_MANIFEST_FILE);
  if (!existsSync(manifestPath)) throw new SiteConformanceError(`${ROUTE_MANIFEST_FILE} is missing from the site directory`);
  const manifest = readJson(manifestPath, ROUTE_MANIFEST_FILE);
  const routes = isRecord(manifest) ? manifest.routes : undefined;
  if (!Array.isArray(routes)) throw new SiteConformanceError(`${ROUTE_MANIFEST_FILE} has no routes array`);
  const ids = new Set<string>();
  for (const route of routes) {
    const id = typeof route === "string" ? route : isRecord(route) ? route.id : undefined;
    if (typeof id !== "string" || id === "") throw new SiteConformanceError(`${ROUTE_MANIFEST_FILE} has a route without a string id`);
    ids.add(id);
  }
  return ids;
}

interface Waiver {
  readonly rule: SiteConformanceRule;
  readonly path: string;
  readonly reason: string;
}

function loadWaivers(repoRoot: string): readonly Waiver[] {
  const path = join(repoRoot, WAIVERS_PATH);
  if (!existsSync(path)) return [];
  const doc = readJson(path, WAIVERS_PATH);
  if (!isRecord(doc) || doc.version !== 1 || !Array.isArray(doc.waivers)) {
    throw new SiteConformanceError(`${WAIVERS_PATH} must be { "version": 1, "waivers": [...] }`);
  }
  const seen = new Set<string>();
  const waivers: Waiver[] = [];
  for (const entry of doc.waivers) {
    if (!isRecord(entry)) throw new SiteConformanceError(`${WAIVERS_PATH} has a waiver that is not an object`);
    const { rule, path: file, reason } = entry;
    if (typeof rule !== "string" || !(SITE_CONFORMANCE_RULES as readonly string[]).includes(rule)) {
      throw new SiteConformanceError(`${WAIVERS_PATH} has a waiver with an unknown rule`);
    }
    if (typeof file !== "string" || file === "") throw new SiteConformanceError(`${WAIVERS_PATH} has a waiver without a path`);
    if (typeof reason !== "string" || reason.trim() === "") throw new SiteConformanceError(`${WAIVERS_PATH} has a waiver with an empty reason`);
    const key = `${rule}\0${file}`;
    if (seen.has(key)) throw new SiteConformanceError(`${WAIVERS_PATH} has a duplicate waiver`);
    seen.add(key);
    waivers.push({ rule: rule as SiteConformanceRule, path: file, reason });
  }
  return waivers;
}

function isCommentLine(trimmed: string): boolean {
  return trimmed.startsWith("//") || trimmed.startsWith("/*") || trimmed.startsWith("*") || trimmed.startsWith("{/*");
}

function hasRawStyleLiteral(line: string): boolean {
  if (COLOUR_FUNCTION_RE.test(line)) return true;
  return (line.match(STRING_RE) ?? []).some((literal) => HEX_COLOUR_RE.test(literal));
}

/** Every component of `path` below the repository root must be a real directory: a symlink can point outside the repository. */
function assertNoSymlink(root: string, path: string, rootRelative: string, what: string): void {
  let realRoot: string;
  let realPath: string;
  try {
    realRoot = realpathSync(root);
    realPath = realpathSync(path);
  } catch {
    throw new SiteConformanceError(`${what} could not be resolved`);
  }
  if (realPath !== join(realRoot, rootRelative)) {
    throw new SiteConformanceError(`${what} must not be, or be reached through, a symlink`);
  }
}

function byLocation(a: SiteConformanceFinding, b: SiteConformanceFinding): number {
  return a.file < b.file ? -1 : a.file > b.file ? 1 : a.line - b.line || (a.rule < b.rule ? -1 : a.rule > b.rule ? 1 : 0);
}

export function scanSiteConformance(repoRoot: string, options: { readonly site?: string } = {}): SiteConformanceResult {
  const root = resolve(repoRoot);
  if (!isDirectory(root)) throw new SiteConformanceError("repository root does not exist");
  const siteArg = options.site ?? DEFAULT_SITE;
  const siteDir = resolve(root, siteArg);
  const siteRelative = relative(root, siteDir);
  if (siteRelative === "" || siteRelative.startsWith("..") || isAbsolute(siteRelative)) {
    throw new SiteConformanceError("site directory must be a directory inside the repository root");
  }
  if (!isDirectory(siteDir)) throw new SiteConformanceError("site directory does not exist");
  assertNoSymlink(root, siteDir, siteRelative, "site directory");
  const manifestIds = loadManifestRouteIds(siteDir);
  const waivers = loadWaivers(root);

  const appDir = join(siteDir, "app");
  const files: string[] = [];
  const links: string[] = [];
  if (isDirectory(appDir)) {
    assertNoSymlink(root, appDir, relative(root, appDir), "site app directory");
    collectSources(appDir, files, links);
  }
  files.sort();
  if (files.length === 0) throw new SiteConformanceError("site app directory has no .ts/.tsx files");

  const raw: SiteConformanceFinding[] = [];
  for (const file of files) {
    const rel = relative(root, file).split(sep).join(posix.sep);
    const source = readSource(file);
    const name = file.slice(file.lastIndexOf(sep) + 1);
    if (VIEW_FILES.has(name) && !reachesPublisherView(file, source)) {
      raw.push({ rule: "site/route-not-publisher-view", file: rel, line: 1 });
    }
    if (name === "page.tsx") {
      const route = routeOf(appDir, file);
      if (route.split("/").some((segment) => TEMPLATE_SEGMENT_RE.test(segment)) && !manifestIds.has(route)) {
        raw.push({ rule: "site/template-route-duplicate", file: rel, line: 1 });
      }
    }
    source.split(/\r?\n/).forEach((line, index) => {
      if (isCommentLine(line.trim()) || line.includes(IGNORE_MARKER)) return;
      if (hasRawStyleLiteral(line)) raw.push({ rule: "site/raw-style-literal", file: rel, line: index + 1 });
    });
  }

  for (const link of links) {
    raw.push({ rule: "site/symlink-unscanned", file: relative(root, link).split(sep).join(posix.sep), line: 1 });
  }

  const findings: SiteConformanceFinding[] = [];
  const waived: SiteConformanceWaived[] = [];
  const used = new Set<Waiver>();
  for (const finding of raw) {
    const waiver = waivers.find((candidate) => candidate.rule === finding.rule && candidate.path === finding.file);
    if (waiver === undefined) {
      findings.push(finding);
    } else {
      used.add(waiver);
      waived.push({ ...finding, reason: waiver.reason });
    }
  }
  for (const waiver of waivers) {
    if (!used.has(waiver)) findings.push({ rule: "site/waiver-unused", file: waiver.path, line: 1 });
  }
  findings.sort(byLocation);
  waived.sort(byLocation);
  return { mode: "report", site: siteRelative.split(sep).join(posix.sep), filesScanned: files.length, findings, waived };
}
