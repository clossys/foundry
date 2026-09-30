/**
 * Static guards over the site template at `packages/publisher/templates/site/`.
 *
 * The template is scaffolded into a consumer repository and built there by
 * Next.js. Nothing in this package's own build type-checks or renders it, so
 * three kinds of silent rot are only catchable by reading its files:
 *
 *   1. DEPENDENCY RANGES. The template's `package.json` names sibling
 *      packages and the framework. A range that no longer covers the
 *      sibling's on-disk version (or the version the root lockfile resolves
 *      for `next`/`react`/`react-dom`) scaffolds a project that installs a
 *      different copy than the one this repository tests.
 *   2. CUSTOM PROPERTIES. A `var(--x)` reference is only meaningful if some
 *      stylesheet the template actually loads declares `--x`. The declared
 *      set is computed from the CSS reachable from `app/globals.css` through
 *      `@import`, so "the template loads the token layer" is part of the
 *      guard, not an assumption.
 *   3. TOKEN PURITY. The designer package's own token gate, run over the
 *      template as a consumer would run it.
 *
 * Each guard is a pure function defined in this file. Every guard is proven
 * against a negative-control fixture under
 * `test-fixtures/site-template-guards/` (it must report a finding) before it
 * is asserted clean against the real template.
 *
 * Every guard fails closed: a form it cannot evaluate is a finding, never a
 * pass, and a scan that examined nothing is a finding, never a pass.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { checkTokenPurity, scanStyleSources } from "@clossys/designer/gate";
import { TOKENS } from "@clossys/designer/tokens";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------- locations

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const PUBLISHER_DIR = join(REPO_ROOT, "packages", "publisher");
const DESIGNER_DIR = join(REPO_ROOT, "packages", "designer");
const WRITER_DIR = join(REPO_ROOT, "packages", "writer");
const MESSENGER_DIR = join(REPO_ROOT, "packages", "messenger");
const TEMPLATE_DIR = join(PUBLISHER_DIR, "templates", "site");
const FIXTURES = join(PUBLISHER_DIR, "test-fixtures", "site-template-guards");

interface Finding {
  /** Stable machine-readable name, asserted on by the negative controls. */
  kind: string;
  message: string;
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

function toPosix(path: string): string {
  return path.split(sep).join("/");
}

// ------------------------------------------------- guard 1: dependency ranges

interface Version {
  major: number;
  minor: number;
  patch: number;
}

/** Strict x.y.z only: no prerelease, no build metadata, no leading "v". */
function parseVersion(text: string): Version | null {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(text.trim());
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) };
}

function compareVersions(a: Version, b: Version): number {
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch;
}

interface ParsedRange {
  prefix: "" | "^" | "~";
  version: Version;
}

/** Exact pin, caret, or tilde over a plain x.y.z. Anything else is null (a finding). */
function parseRange(text: string): ParsedRange | null {
  const m = /^(\^|~)?(\d+\.\d+\.\d+)$/.exec(text.trim());
  if (!m) return null;
  const version = parseVersion(m[2] as string);
  if (!version) return null;
  return { prefix: (m[1] ?? "") as ParsedRange["prefix"], version };
}

/**
 * Half-open [lower, upper) bounds. For 0.y.z BOTH `^` and `~` are
 * minor-locked, which is the rule scripts/check-workspace-links.mjs exists
 * to get right. An exact pin admits only itself.
 */
function rangeBounds({ prefix, version }: ParsedRange): { lower: Version; upper: Version } {
  const { major, minor, patch } = version;
  if (prefix === "") return { lower: version, upper: { major, minor, patch: patch + 1 } };
  if (major === 0 || prefix === "~") return { lower: version, upper: { major, minor: minor + 1, patch: 0 } };
  return { lower: version, upper: { major: major + 1, minor: 0, patch: 0 } };
}

type RangeVerdict = { ok: true } | { ok: false; kind: string; reason: string };

function rangeCovers(rangeText: unknown, installedText: string | undefined): RangeVerdict {
  if (typeof rangeText !== "string") {
    return { ok: false, kind: "unrecognised-range", reason: `range ${JSON.stringify(rangeText)} is not a string` };
  }
  const range = parseRange(rangeText);
  if (!range) {
    return {
      ok: false,
      kind: "unrecognised-range",
      reason: `"${rangeText}" is not a range form this guard evaluates (only x.y.z, ^x.y.z and ~x.y.z)`,
    };
  }
  const installed = installedText === undefined ? null : parseVersion(installedText);
  if (!installed) {
    return {
      ok: false,
      kind: "unparseable-installed-version",
      reason: `the installed version ${JSON.stringify(installedText)} is not a plain x.y.z`,
    };
  }
  const { lower, upper } = rangeBounds(range);
  if (compareVersions(installed, lower) >= 0 && compareVersions(installed, upper) < 0) return { ok: true };
  return { ok: false, kind: "stale-range", reason: `"${rangeText}" does not cover installed ${installedText}` };
}

const DEPENDENCY_SECTIONS = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"] as const;
const REQUIRED_SIBLINGS = ["@clossys/designer", "@clossys/messenger", "@clossys/publisher", "@clossys/writer"] as const;
const REQUIRED_FRAMEWORK = ["next", "react", "react-dom"] as const;

/**
 * @param manifest the template's package.json, parsed
 * @param onDisk   `@clossys/*` sibling name -> the version in its own package.json
 * @param locked   framework package name -> the version the root lockfile resolves
 */
function checkTemplateRanges(
  manifest: unknown,
  onDisk: Readonly<Record<string, string>>,
  locked: Readonly<Record<string, string>>,
): Finding[] {
  const findings: Finding[] = [];
  if (typeof manifest !== "object" || manifest === null || Array.isArray(manifest)) {
    return [{ kind: "bad-manifest", message: "the template manifest is not a JSON object" }];
  }
  const record = manifest as Record<string, unknown>;
  const seen = new Set<string>();

  for (const section of DEPENDENCY_SECTIONS) {
    const deps = record[section];
    if (deps === undefined) continue;
    if (typeof deps !== "object" || deps === null || Array.isArray(deps)) {
      findings.push({ kind: "bad-manifest", message: `${section} is not an object` });
      continue;
    }
    for (const [name, range] of Object.entries(deps as Record<string, unknown>)) {
      const isFirstParty = name.startsWith("@clossys/");
      const isFramework = (REQUIRED_FRAMEWORK as readonly string[]).includes(name);
      if (!isFirstParty && !isFramework) continue;
      seen.add(name);

      if (isFirstParty && onDisk[name] === undefined) {
        findings.push({
          kind: "unknown-sibling",
          message: `${section} names ${name}, which has no on-disk version to check the range against`,
        });
        continue;
      }
      const installed = isFirstParty ? onDisk[name] : locked[name];
      const verdict = rangeCovers(range, installed);
      if (!verdict.ok) {
        const source = isFirstParty ? "on-disk" : "lockfile";
        findings.push({ kind: verdict.kind, message: `${section}.${name} (${source}): ${verdict.reason}` });
      }
    }
  }

  for (const name of [...REQUIRED_SIBLINGS, ...REQUIRED_FRAMEWORK]) {
    if (!seen.has(name)) {
      findings.push({ kind: "missing-dependency", message: `the template manifest does not declare ${name}` });
    }
  }
  return findings;
}

function readManifestVersion(dir: string): string | undefined {
  const manifest = readJson(join(dir, "package.json")) as { version?: unknown };
  return typeof manifest.version === "string" ? manifest.version : undefined;
}

function siblingVersionsOnDisk(): Record<string, string> {
  const out: Record<string, string> = {};
  const designer = readManifestVersion(DESIGNER_DIR);
  const messenger = readManifestVersion(MESSENGER_DIR);
  const publisher = readManifestVersion(PUBLISHER_DIR);
  const writer = readManifestVersion(WRITER_DIR);
  if (designer !== undefined) out["@clossys/designer"] = designer;
  if (messenger !== undefined) out["@clossys/messenger"] = messenger;
  if (publisher !== undefined) out["@clossys/publisher"] = publisher;
  if (writer !== undefined) out["@clossys/writer"] = writer;
  return out;
}

function lockedFrameworkVersions(): Record<string, string> {
  const lock = readJson(join(REPO_ROOT, "package-lock.json")) as {
    packages?: Record<string, { version?: unknown } | undefined>;
  };
  const out: Record<string, string> = {};
  for (const name of REQUIRED_FRAMEWORK) {
    const version = lock.packages?.[`node_modules/${name}`]?.version;
    if (typeof version === "string") out[name] = version;
  }
  return out;
}

/** A manifest whose ranges are `^` of the versions the guard compares against, built from disk so it never goes stale. */
function currentManifest(onDisk: Record<string, string>, locked: Record<string, string>): unknown {
  return {
    name: "fixture-site",
    dependencies: {
      "@clossys/designer": `^${onDisk["@clossys/designer"]}`,
      "@clossys/messenger": `^${onDisk["@clossys/messenger"]}`,
      "@clossys/publisher": `~${onDisk["@clossys/publisher"]}`,
      "@clossys/writer": `^${onDisk["@clossys/writer"]}`,
      next: `^${locked["next"]}`,
      react: `^${locked["react"]}`,
      "react-dom": locked["react-dom"],
    },
  };
}

describe("guard 1: template dependency ranges", () => {
  const onDisk = siblingVersionsOnDisk();
  const locked = lockedFrameworkVersions();

  it("has every version input the guard needs (a guard with no inputs proves nothing)", () => {
    expect(Object.keys(onDisk).sort()).toEqual([
      "@clossys/designer",
      "@clossys/messenger",
      "@clossys/publisher",
      "@clossys/writer",
    ]);
    expect(Object.keys(locked).sort()).toEqual(["next", "react", "react-dom"]);
  });

  it("reports stale ranges (negative control)", () => {
    const stale = readJson(join(FIXTURES, "ranges", "stale-ranges.manifest.json"));
    const findings = checkTemplateRanges(stale, onDisk, locked);
    const staleNames = findings.filter((f) => f.kind === "stale-range").map((f) => f.message);
    expect(staleNames.some((m) => m.includes("@clossys/designer"))).toBe(true);
    expect(staleNames.some((m) => m.includes("@clossys/publisher"))).toBe(true);
    expect(staleNames.some((m) => m.includes("dependencies.next"))).toBe(true);
  });

  it("reports unrecognised range forms instead of passing them (negative control)", () => {
    const odd = readJson(join(FIXTURES, "ranges", "unrecognised-range.manifest.json"));
    const findings = checkTemplateRanges(odd, onDisk, locked);
    const unrecognised = findings.filter((f) => f.kind === "unrecognised-range").map((f) => f.message);
    for (const name of ["@clossys/designer", "@clossys/publisher", "next", "react", "react-dom"]) {
      expect(unrecognised.some((m) => m.includes(`dependencies.${name} `))).toBe(true);
    }
  });

  it("passes a manifest whose ranges all cover the installed versions", () => {
    expect(checkTemplateRanges(currentManifest(onDisk, locked), onDisk, locked)).toEqual([]);
  });

  it("requires both siblings and all three framework packages to be declared", () => {
    for (const name of [...REQUIRED_SIBLINGS, ...REQUIRED_FRAMEWORK]) {
      const manifest = currentManifest(onDisk, locked) as { dependencies: Record<string, string> };
      delete manifest.dependencies[name];
      const findings = checkTemplateRanges(manifest, onDisk, locked);
      expect(findings.map((f) => f.kind)).toContain("missing-dependency");
      expect(findings.some((f) => f.message.includes(name))).toBe(true);
    }
  });

  it("checks every dependency section, not only dependencies", () => {
    for (const section of ["devDependencies", "peerDependencies", "optionalDependencies"]) {
      const manifest = currentManifest(onDisk, locked) as Record<string, unknown>;
      manifest[section] = { "@clossys/designer": "^0.0.1" };
      const findings = checkTemplateRanges(manifest, onDisk, locked);
      expect(findings.some((f) => f.kind === "stale-range" && f.message.startsWith(`${section}.`))).toBe(true);
    }
  });

  it("fails closed on an @clossys package it has no on-disk version for", () => {
    const manifest = currentManifest(onDisk, locked) as { dependencies: Record<string, string> };
    manifest.dependencies[["@clossys", "not-a-sibling"].join("/")] = "^1.0.0";
    expect(checkTemplateRanges(manifest, onDisk, locked).map((f) => f.kind)).toContain("unknown-sibling");
  });

  it("fails closed on an unparseable installed version and on a missing lock entry", () => {
    const manifest = currentManifest(onDisk, locked);
    const badDisk = { ...onDisk, "@clossys/designer": "0.6.0-rc.1" };
    expect(checkTemplateRanges(manifest, badDisk, locked).map((f) => f.kind)).toContain("unparseable-installed-version");
    const { next: _omitted, ...noNext } = locked;
    expect(checkTemplateRanges(manifest, onDisk, noNext).map((f) => f.kind)).toContain("unparseable-installed-version");
  });

  it("rejects a non-object manifest", () => {
    expect(checkTemplateRanges("nope", onDisk, locked).map((f) => f.kind)).toEqual(["bad-manifest"]);
    expect(checkTemplateRanges(null, onDisk, locked).map((f) => f.kind)).toEqual(["bad-manifest"]);
  });

  describe("range arithmetic", () => {
    const covers = (range: string, version: string) => rangeCovers(range, version).ok;

    it("locks 0.x to the minor for both ^ and ~", () => {
      expect(covers("^0.6.0", "0.6.9")).toBe(true);
      expect(covers("^0.6.0", "0.7.0")).toBe(false);
      expect(covers("~0.6.2", "0.6.1")).toBe(false);
      expect(covers("~0.6.2", "0.6.9")).toBe(true);
      expect(covers("~0.6.2", "0.7.0")).toBe(false);
    });

    it("locks >=1.0.0 to the major for ^ and to the minor for ~", () => {
      expect(covers("^1.2.3", "1.9.0")).toBe(true);
      expect(covers("^1.2.3", "2.0.0")).toBe(false);
      expect(covers("~1.2.3", "1.2.9")).toBe(true);
      expect(covers("~1.2.3", "1.3.0")).toBe(false);
    });

    it("admits only the literal version for an exact pin", () => {
      expect(covers("1.2.3", "1.2.3")).toBe(true);
      expect(covers("1.2.3", "1.2.4")).toBe(false);
    });

    it("treats every other form as unevaluable", () => {
      for (const range of [">=16 <17", "*", "x", "16.x", "^16", "^1.2.3 || ^2.0.0", "workspace:*", "catalog:", "^1.2.3-rc.1", "latest", ""]) {
        const verdict = rangeCovers(range, "16.3.5");
        expect(verdict.ok).toBe(false);
        if (!verdict.ok) expect(verdict.kind).toBe("unrecognised-range");
      }
    });
  });

  it("the real template manifest declares current ranges", () => {
    const manifest = readJson(join(TEMPLATE_DIR, "package.json"));
    expect(checkTemplateRanges(manifest, onDisk, locked)).toEqual([]);
  });
});

// ------------------------------------------------- guard 2: custom properties

interface Pin {
  /** Repo-relative, `/`-joined. */
  file: string;
  name: string;
  reason: string;
}

interface CustomPropertyOptions {
  templateDir: string;
  /** Directories whose source files are scanned for `var()` references. */
  refDirs: readonly string[];
  /** The designer package's `styles/` directory; its package.json is one level up. */
  designerStylesDir: string;
  pins: readonly Pin[];
  /** Base for the repo-relative paths that pins are written in. */
  repoRoot: string;
}

const REF_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".css", ".mjs"]);
const REF_SKIP_DIRS = new Set(["node_modules", "dist", ".next"]);
const REF_SKIP_FILE = /\.(test|spec|check)\.[^/\\]+$|\.d\.ts$/;
const BRAND_FILE_SUFFIX = "clossys/designer/brand.css";

function walkFiles(dir: string, skipDirs: ReadonlySet<string>, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!skipDirs.has(entry.name)) walkFiles(full, skipDirs, out);
    } else if (entry.isFile()) {
      out.push(full);
    }
  }
  return out;
}

function stripCssComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, " ");
}

/** `--name:` declarations and `@property --name` registrations. */
function declaredProperties(css: string): string[] {
  const text = stripCssComments(css);
  const names: string[] = [];
  for (const m of text.matchAll(/(?<![\w-])(--[A-Za-z_][\w-]*)\s*:/g)) names.push(m[1] as string);
  for (const m of text.matchAll(/@property\s+(--[A-Za-z_][\w-]*)/g)) names.push(m[1] as string);
  return names;
}

function importSpecifiers(css: string): string[] {
  const text = stripCssComments(css);
  const specs: string[] = [];
  for (const m of text.matchAll(/@import\s+(?:url\(\s*)?(["'])([^"']+)\1/g)) specs.push(m[2] as string);
  return specs;
}

interface VarReference {
  /** The `--ident`, or null when the first argument is not a literal identifier. */
  name: string | null;
  line: number;
  snippet: string;
}

interface VarScan {
  refs: VarReference[];
  /**
   * How many whole-comment lines were skipped while holding a `var(`. Those
   * are the lines that would otherwise have been judged, so a non-zero count
   * is the measure of how much this skip rule is doing.
   */
  commentLinesSkipped: number;
}

/** A line whose trimmed text starts a JS/TS/CSS comment (`//`, `/*`) or continues a block comment (`*`). */
function isCommentLine(line: string): boolean {
  const t = line.trim();
  return t.startsWith("//") || t.startsWith("/*") || t.startsWith("*");
}

/**
 * Finds every `var(` occurrence outside whole-comment lines. This is a
 * line-shape rule only: nothing parses strings, regexes or comment nesting,
 * so a trailing comment on a code line, or a `var(` inside a string, is
 * still judged (fail closed for code).
 */
function extractVarReferences(source: string): VarScan {
  const lines = source.split("\n");
  const lineStart: number[] = [];
  let offset = 0;
  for (const line of lines) {
    lineStart.push(offset);
    offset += line.length + 1;
  }
  const skipped = new Set<number>();
  const refs: VarReference[] = [];
  let lineIndex = 0;
  for (const m of source.matchAll(/\bvar\(/g)) {
    const start = m.index as number;
    while (lineIndex + 1 < lines.length && (lineStart[lineIndex + 1] as number) <= start) lineIndex += 1;
    if (isCommentLine(lines[lineIndex] as string)) {
      skipped.add(lineIndex);
      continue;
    }
    const after = source.slice(start + m[0].length);
    // A literal custom-property name ends at whitespace, a comma or the closing paren.
    // Anything else (an interpolation, a prefix followed by `${`, `...`, a bare `)`)
    // cannot be resolved statically.
    const literal = /^\s*(--[A-Za-z0-9_-]+)(?=[\s,)])/.exec(after);
    refs.push({
      name: literal ? (literal[1] as string) : null,
      line: lineIndex + 1,
      snippet: source.slice(start, start + 40).split("\n")[0] as string,
    });
  }
  return { refs, commentLinesSkipped: skipped.size };
}

interface ResolvedDesignerCss {
  path?: string;
  problem?: string;
}

function resolveDesignerCss(specifier: string, designerStylesDir: string): ResolvedDesignerCss {
  const designerDir = dirname(designerStylesDir);
  const subpath = `.${specifier.slice("@clossys/designer".length)}`;
  const pkg = readJson(join(designerDir, "package.json")) as { exports?: Record<string, unknown> };
  const target = pkg.exports?.[subpath];
  if (typeof target !== "string") {
    return { problem: `${specifier} is not a plain-string entry in the designer package's exports` };
  }
  const path = resolve(designerDir, target);
  if (!existsSync(path)) return { problem: `${specifier} maps to ${target}, which does not exist` };
  return { path };
}

function isInside(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel !== "" && rel.split(sep)[0] !== ".." && !isAbsolute(rel);
}

interface CustomPropertyResult {
  findings: Finding[];
  /** See `VarScan.commentLinesSkipped`, summed over every file read. */
  commentLinesSkipped: number;
}

function checkCustomProperties(options: CustomPropertyOptions): CustomPropertyResult {
  const { templateDir, refDirs, designerStylesDir, pins, repoRoot } = options;
  const findings: Finding[] = [];
  const repoRel = (path: string) => toPosix(relative(repoRoot, path));

  // (b) The declared set: only CSS reachable from the template's globals.css.
  const declared = new Set<string>();
  const entry = join(templateDir, "app", "globals.css");
  if (!existsSync(entry)) {
    findings.push({ kind: "no-entry-stylesheet", message: `${repoRel(entry)} does not exist, so no token layer can be loaded` });
  } else {
    const visited = new Set<string>();
    const visit = (file: string): void => {
      if (visited.has(file)) return;
      visited.add(file);
      const css = readFileSync(file, "utf8");
      for (const name of declaredProperties(css)) declared.add(name);
      for (const spec of importSpecifiers(css)) {
        if (spec === "tailwindcss") continue; // provided by the framework build
        if (spec.startsWith("@clossys/designer/")) {
          const resolved = resolveDesignerCss(spec, designerStylesDir);
          if (resolved.path) visit(resolved.path);
          else findings.push({ kind: "unresolvable-import", message: `${repoRel(file)}: ${resolved.problem}` });
          continue;
        }
        if (spec.startsWith("./") || spec.startsWith("../")) {
          const target = resolve(dirname(file), spec);
          if (existsSync(target) && statSync(target).isFile()) {
            visit(target);
          } else if (!isInside(templateDir, target) && toPosix(target).endsWith(`/${BRAND_FILE_SUFFIX}`)) {
            // The consumer repository's brand file. It does not exist in this
            // repository, and what it declares cannot be counted on here.
          } else {
            findings.push({ kind: "unresolvable-import", message: `${repoRel(file)}: @import "${spec}" does not resolve` });
          }
          continue;
        }
        findings.push({ kind: "unresolvable-import", message: `${repoRel(file)}: @import "${spec}" is not a form this guard resolves` });
      }
    };
    visit(entry);
  }

  // (a) The references.
  interface Reference {
    file: string;
    name: string;
    line: number;
  }
  const references: Reference[] = [];
  let filesRead = 0;
  let commentLinesSkipped = 0;
  for (const dir of refDirs) {
    if (!existsSync(dir)) {
      findings.push({ kind: "missing-ref-dir", message: `${repoRel(dir)} does not exist` });
      continue;
    }
    for (const file of walkFiles(dir, REF_SKIP_DIRS)) {
      const ext = file.slice(file.lastIndexOf("."));
      if (!REF_EXTENSIONS.has(ext) || REF_SKIP_FILE.test(file)) continue;
      filesRead += 1;
      const scan = extractVarReferences(readFileSync(file, "utf8"));
      commentLinesSkipped += scan.commentLinesSkipped;
      for (const ref of scan.refs) {
        if (ref.name === null) {
          findings.push({
            kind: "unclassifiable-var",
            message: `${repoRel(file)}:${ref.line}: unclassifiable var() (${JSON.stringify(ref.snippet)}): the first argument is not a literal --name`,
          });
        } else if (!ref.name.startsWith("--tw-")) {
          references.push({ file: repoRel(file), name: ref.name, line: ref.line });
        }
      }
    }
  }
  if (filesRead === 0) {
    findings.push({ kind: "empty-scan", message: "no reference files were read, so nothing was checked" });
  }

  // (c) Undefined references, less the exact pins.
  const undefinedRefs = references.filter((ref) => !declared.has(ref.name));
  const pinned = new Set<string>();
  for (const pin of pins) {
    if (pin.reason.trim() === "") {
      findings.push({ kind: "bad-pin", message: `pin ${pin.file} ${pin.name} has no reason` });
    }
    if (isInside(templateDir, resolve(repoRoot, pin.file))) {
      findings.push({ kind: "bad-pin", message: `pin ${pin.file} ${pin.name} covers a template file, which is never allowed` });
    }
    if (!undefinedRefs.some((ref) => ref.file === pin.file && ref.name === pin.name)) {
      findings.push({ kind: "stale-pin", message: `pin ${pin.file} ${pin.name} matches no undefined reference` });
    }
    pinned.add(`${pin.file}\0${pin.name}`);
  }
  for (const ref of undefinedRefs) {
    if (pinned.has(`${ref.file}\0${ref.name}`)) continue;
    findings.push({
      kind: "undefined-property",
      message: `${ref.file}:${ref.line}: var(${ref.name}) is not declared by any stylesheet reachable from app/globals.css`,
    });
  }
  return { findings, commentLinesSkipped };
}

/**
 * Undefined references that exist today and are accepted by name. Each entry
 * is an exact file and property; nothing under the template is ever pinned.
 * Empty: the one reference the survey once found (a placeholder name in a doc
 * comment) sits on a whole-comment line, which the extractor now skips, so a
 * pin for it would be stale.
 */
const CUSTOM_PROPERTY_PINS: readonly Pin[] = [];

/** The findings only, for tests that do not look at the comment-line count. */
const findingsFor = (options: CustomPropertyOptions): Finding[] => checkCustomProperties(options).findings;

function fixtureOptions(name: string, pins: readonly Pin[] = []): CustomPropertyOptions {
  const templateDir = join(FIXTURES, "custom-properties", name);
  return {
    templateDir,
    refDirs: [templateDir],
    designerStylesDir: join(DESIGNER_DIR, "styles"),
    pins,
    repoRoot: REPO_ROOT,
  };
}

describe("guard 2: custom properties", () => {
  it("reports a reference no stylesheet declares (negative control)", () => {
    const findings = findingsFor(fixtureOptions("undefined-property"));
    expect(findings.map((f) => f.kind)).toEqual(["undefined-property"]);
    expect(findings[0]?.message).toContain("--not-declared-anywhere");
  });

  it("reports references when the template never loads the token layer (negative control)", () => {
    const findings = findingsFor(fixtureOptions("token-layer-not-loaded"));
    expect(findings.map((f) => f.kind)).toEqual(["undefined-property"]);
    expect(findings[0]?.message).toContain("--color-accent");
  });

  it("reports a var() whose name cannot be read statically (negative control)", () => {
    const findings = findingsFor(fixtureOptions("unclassifiable"));
    expect(findings.map((f) => f.kind)).toEqual(["unclassifiable-var"]);
  });

  it("passes when the token layer is loaded and every reference is declared or --tw-", () => {
    expect(findingsFor(fixtureOptions("passing"))).toEqual([]);
  });

  it("follows the token layer through theme.css into tokens.css", () => {
    // --ui-z-shell is declared in tokens.css only; theme.css reaches it by importing tokens.css.
    const page = readFileSync(join(FIXTURES, "custom-properties", "passing", "app", "page.tsx"), "utf8");
    expect(page).toContain("var(--ui-z-shell, inherit)");
    const tokensCss = readFileSync(join(DESIGNER_DIR, "styles", "tokens.css"), "utf8");
    const keysCss = readFileSync(join(DESIGNER_DIR, "styles", "theme-keys.css"), "utf8");
    expect(declaredProperties(tokensCss)).toContain("--ui-z-shell");
    expect(declaredProperties(keysCss)).not.toContain("--ui-z-shell");
    expect(findingsFor(fixtureOptions("passing"))).toEqual([]);
  });

  it("fails closed on an import it cannot resolve, other than the consumer brand file (negative control)", () => {
    const findings = findingsFor(fixtureOptions("unresolvable-import"));
    const messages = findings.filter((f) => f.kind === "unresolvable-import").map((f) => f.message);
    expect(messages.some((m) => m.includes("./missing.css"))).toBe(true);
    expect(messages.some((m) => m.includes("@clossys/designer/not-an-export.css"))).toBe(true);
    expect(messages.some((m) => m.includes("some-other-package/styles.css"))).toBe(true);
    expect(messages.some((m) => m.includes("brand.css"))).toBe(false);
  });

  it("pins an undefined reference by exact file and name, and flags a pin that matches nothing", () => {
    const base = fixtureOptions("undefined-property");
    const file = toPosix(relative(REPO_ROOT, join(base.templateDir, "app", "page.tsx")));
    // A pin for a file under the template dir is refused even when it matches.
    const templatePinned = findingsFor({
      ...base,
      pins: [{ file, name: "--not-declared-anywhere", reason: "should be refused" }],
    });
    expect(templatePinned.map((f) => f.kind)).toEqual(["bad-pin"]);

    // Outside the template, an exact match silences the reference and nothing else does.
    const outside = { ...base, templateDir: join(FIXTURES, "custom-properties", "passing"), refDirs: [base.templateDir] };
    expect(findingsFor(outside).map((f) => f.kind)).toEqual(["undefined-property"]);
    expect(findingsFor({ ...outside, pins: [{ file, name: "--not-declared-anywhere", reason: "fixture" }] })).toEqual([]);
    expect(
      findingsFor({ ...outside, pins: [{ file, name: "--some-other-name", reason: "fixture" }] }).map((f) => f.kind).sort(),
    ).toEqual(["stale-pin", "undefined-property"]);
  });

  it("refuses to pass a scan that read nothing", () => {
    const options = fixtureOptions("passing");
    const kinds = findingsFor({ ...options, refDirs: [join(options.templateDir, "app", "nothing-here")] }).map((f) => f.kind);
    expect(kinds).toContain("missing-ref-dir");
    expect(kinds).toContain("empty-scan");
  });

  it("skips whole-comment lines but still judges a trailing comment on a code line (negative control)", () => {
    const result = checkCustomProperties(fixtureOptions("comment-lines"));
    // Three comment lines mention the undeclared name and are skipped; the code line is judged.
    expect(result.commentLinesSkipped).toBe(3);
    expect(result.findings.map((f) => f.kind)).toEqual(["undefined-property"]);
    expect(result.findings[0]?.message).toContain("page.tsx:7:");
    expect(result.findings[0]?.message).toContain("--not-declared-anywhere");
  });

  it("applies the comment-line rule by line shape only", () => {
    const scan = (src: string) => extractVarReferences(src);
    expect(scan("// var(--a, 0)").refs).toEqual([]);
    expect(scan("  /* var(--a, 0) */").refs).toEqual([]);
    expect(scan("/**\n * var(--a, 0)\n */").commentLinesSkipped).toBe(1);
    // A trailing comment does not protect the code before it, and a string is not parsed.
    expect(scan('const x = "var(--a, 0)"; // note').refs.map((r) => r.name)).toEqual(["--a"]);
    expect(scan("x = var(--a, 0); // var(--b, 0)").refs.map((r) => r.name)).toEqual(["--a", "--b"]);
    // Line numbers survive skipped lines.
    expect(scan("// c\n// var(--a, 0)\nvar(--b, 0)").refs.map((r) => `${r.name}@${r.line}`)).toEqual(["--b@3"]);
    // An unclassifiable var() on a code line is still reported.
    expect(scan("// note\nconst y = `var(--${n})`;").refs.map((r) => r.name)).toEqual([null]);
  });

  it("classifies var() first arguments", () => {
    const names = (src: string) => extractVarReferences(src).refs.map((r) => r.name);
    expect(names("var(--a, 0)")).toEqual(["--a"]);
    expect(names("var( --a , 1px)")).toEqual(["--a"]);
    expect(names("var(--a,#fff)")).toEqual(["--a"]);
    expect(names("`var(--${x})`")).toEqual([null]);
    expect(names("`var(--color-${x})`")).toEqual([null]);
    expect(names("var(${x})")).toEqual([null]);
    expect(names("var()")).toEqual([null]);
    expect(names("var(--)")).toEqual([null]);
    expect(names("covar(--a, 0)")).toEqual([]);
  });

  it("the real template and the views it renders reference only declared properties", () => {
    const result = checkCustomProperties({
      templateDir: TEMPLATE_DIR,
      refDirs: [
        TEMPLATE_DIR,
        join(PUBLISHER_DIR, "src", "web", "views"),
        join(DESIGNER_DIR, "src", "atoms"),
        join(DESIGNER_DIR, "src", "blocks"),
        join(DESIGNER_DIR, "src", "shell"),
      ],
      designerStylesDir: join(DESIGNER_DIR, "styles"),
      pins: CUSTOM_PROPERTY_PINS,
      repoRoot: REPO_ROOT,
    });
    expect(result.findings.map((f) => `${f.kind}: ${f.message}`)).toEqual([]);
    // The skip rule is really in play on these trees: doc comments here do mention var().
    expect(result.commentLinesSkipped).toBeGreaterThan(0);
  });
});

// ------------------------------------------------------ guard 3: token purity

const PURITY_SKIP_DIRS = ["node_modules", ".git", "dist", "build", "coverage", ".next"];

function checkTemplatePurity(dir: string): Finding[] {
  const scan = scanStyleSources(dir, { skipDirs: PURITY_SKIP_DIRS });
  const findings: Finding[] = [];
  if (scan.filesScanned === 0) {
    findings.push({ kind: "empty-scan", message: `no source files were scanned under ${toPosix(relative(REPO_ROOT, dir))}` });
  }
  const result = checkTokenPurity(scan.candidates, TOKENS, scan.filesScanned, scan.unchecked);
  for (const finding of result.findings) {
    if (finding.severity === "error") {
      findings.push({ kind: finding.rule, message: `${finding.file}:${finding.line}: ${finding.message}` });
    }
  }
  for (const item of result.unchecked) {
    findings.push({ kind: `unchecked:${item.kind}`, message: `${item.file}:${item.line}: ${item.detail}` });
  }
  return findings;
}

describe("guard 3: token purity", () => {
  it("reports a styling construct it cannot classify (negative control)", () => {
    const findings = checkTemplatePurity(join(FIXTURES, "purity", "unclassified-arbitrary"));
    expect(findings.map((f) => f.kind)).toEqual(["unchecked:unclassified-arbitrary-value"]);
  });

  it("reports a hardcoded colour literal (negative control)", () => {
    const findings = checkTemplatePurity(join(FIXTURES, "purity", "hardcoded-literal"));
    expect(findings.length).toBeGreaterThan(0);
    expect(findings.every((f) => !f.kind.startsWith("unchecked:"))).toBe(true);
  });

  it("passes source that only reads tokens", () => {
    expect(checkTemplatePurity(join(FIXTURES, "purity", "clean"))).toEqual([]);
  });

  it("refuses to pass a directory that contains nothing to scan", () => {
    // The ranges fixtures hold only JSON, which the scanner does not read.
    const findings = checkTemplatePurity(join(FIXTURES, "ranges"));
    expect(findings.map((f) => f.kind)).toContain("empty-scan");
  });

  it("the real template has no hardcoded literals and nothing unclassified", () => {
    const findings = checkTemplatePurity(TEMPLATE_DIR);
    expect(findings.map((f) => `${f.kind}: ${f.message}`)).toEqual([]);
  });
});
