import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { TOKENS } from "@vespeneventures/tokens";

/**
 * The highest-value test in this package (see the README's "Tests"
 * section). Every atom AND block styles with Tailwind classes generated
 * from @vespeneventures/tokens, and separately with a handful of raw
 * `var(--ui-*)` reads for tokens that have no Tailwind namespace. Neither
 * of those is checked by TypeScript — a class name and a `var()` argument
 * are both just strings to the compiler. A typo like `bg-surface-elevated`
 * (no such token; the real name is `surface-raised`) would compile clean,
 * render with zero applied background, and produce no error anywhere —
 * this is the only thing that would catch it, because it is the only
 * check that imports the real token catalog and asks "does this name
 * actually exist" rather than "does this parse".
 *
 * Scoped at `src/` (this file's parent), not just `src/atoms/`, so the same
 * protection covers `src/blocks/` too — a block styles with the same
 * token-derived classes an atom does, and a typo there is exactly as
 * invisible to the compiler. This file still lives under `src/atoms/`
 * rather than at `src/` directly; only the directory it walks changed.
 */

const srcDir = dirname(dirname(fileURLToPath(import.meta.url)));

function collectSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      collectSourceFiles(full, out);
      continue;
    }
    const ext = extname(full);
    if ((ext === ".ts" || ext === ".tsx") && !entry.includes(".test.")) {
      out.push(full);
    }
  }
  return out;
}

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

// Tailwind utility prefixes this package actually uses, and which
// @vespeneventures/tokens family/namespace each maps to. `text-` is
// deliberately checked against BOTH `--color-*` (text color, e.g.
// `text-ink-primary`) and `--text-*` (font size, e.g. `text-h2`) — Tailwind
// itself disambiguates the same prefix by which theme namespace the suffix
// resolves in, so this test does the same.
const PREFIX_CANDIDATE_FAMILIES: Record<string, (suffix: string) => string[]> = {
  bg: (s) => [`--color-${s}`],
  text: (s) => [`--color-${s}`, `--text-${s}`],
  border: (s) => [`--color-${s}`],
  rounded: (s) => [`--radius-${s}`],
  tracking: (s) => [`--tracking-${s}`],
  font: (s) => [`--font-${s}`],
  gap: (s) => [`--spacing-${s}`],
  p: (s) => [`--spacing-${s}`],
  px: (s) => [`--spacing-${s}`],
  py: (s) => [`--spacing-${s}`],
  pt: (s) => [`--spacing-${s}`],
  pb: (s) => [`--spacing-${s}`],
  pl: (s) => [`--spacing-${s}`],
  pr: (s) => [`--spacing-${s}`],
  m: (s) => [`--spacing-${s}`],
  mx: (s) => [`--spacing-${s}`],
  my: (s) => [`--spacing-${s}`],
};

// `\b(prefix)-(suffix)\b`, where suffix is letters/digits/hyphens starting
// with a letter (excludes Tailwind's plain numeric scale, e.g. `p-4`,
// which this package never uses and which isn't token-derived anyway).
const CLASS_RE = new RegExp(
  `\\b(${Object.keys(PREFIX_CANDIDATE_FAMILIES).join("|")})-([a-zA-Z][a-zA-Z0-9-]*)\\b`,
  "g",
);

// Raw `var(--...)` reads — the case-2 tokens (`--ui-*`) plus any direct
// `--color-*` read used as a fallback chain. Captures the property name
// whether or not a fallback follows.
const VAR_RE = /var\(\s*(--[a-zA-Z0-9-]+)\s*(?:,|\))/g;

// A CSS custom-property name (`--ui-border-hairline`, `--color-line-base`,
// ...), wherever it appears in source — inside a `var(...)` call, a plain
// string, a template literal. VAR_RE already extracts and resolves these
// on their own terms; CLASS_RE must never also see them, because a name
// like `--ui-border-hairline` CONTAINS the substring `border-hairline`,
// which matches CLASS_RE's own `\b(prefix)-(suffix)\b` shape (prefix
// "border", suffix "hairline") even though it names no Tailwind class at
// all. This is exactly what forced `Shell`'s hairline border width to a
// hardcoded `"1px"` instead of `var(--ui-border-hairline, 1px)` — the
// token read, once restored to source, false-positived as an unresolved
// `border-hairline` class. Blanking out every custom-property name (same
// length, so match offsets in the blanked copy still line up with the
// original for anything that needs them) before running CLASS_RE keeps
// the two scans from colliding, without weakening either: VAR_RE still
// runs against the untouched source.
const CUSTOM_PROPERTY_RE = /--[a-zA-Z][a-zA-Z0-9-]*/g;

function blankCustomProperties(code: string): string {
  return code.replace(CUSTOM_PROPERTY_RE, (m) => " ".repeat(m.length));
}

// Suffixes Tailwind v4 itself ships for these prefixes, independent of any
// `@theme` scale — real utility classes this package doesn't own and never
// will, so a class using one is never a token-derived class and must be
// skipped rather than checked against TOKENS. Every entry below was
// confirmed against a real `@tailwindcss/cli@4.3.3` compile (a scratch
// project outside this repo, `npx @tailwindcss/cli` with each candidate
// class in a scanned source file, reading the emitted CSS rule) rather than
// assumed from documentation — Tailwind's actual reserved set is narrower
// than it looks in places (e.g. `p-auto`/`gap-auto`/any spacing prefix's
// `-full` do NOT compile to anything; only `m`/`mx`/`my`'s `auto` and
// every listed prefix's `px` do).
//
// This list intentionally reuses the same universal color keywords and
// border reserved suffixes `../../tokens/src/tailwind-builtin-collision.test.ts`
// already researched and verified for its own (opposite-direction) check —
// see that file's `RESERVED_FAMILIES.text`/`.font` — so the two tests never
// disagree about what Tailwind owns.
const UNIVERSAL_COLOR_KEYWORDS = ["inherit", "current", "transparent", "black", "white"];

const ALLOWED_SUFFIXES: Record<string, readonly string[]> = {
  text: [
    "left", "center", "right", "justify", "start", "end", // text-align
    "wrap", "nowrap", "balance", "pretty", // text-wrap
    "ellipsis", "clip", // text-overflow
    ...UNIVERSAL_COLOR_KEYWORDS, // text-color shorthands
  ],
  bg: [...UNIVERSAL_COLOR_KEYWORDS],
  border: [
    ...UNIVERSAL_COLOR_KEYWORDS,
    // Side / logical-direction border utilities (border-width + -style,
    // never a color) — confirmed generated for all eight.
    "b", "t", "l", "r", "x", "y", "s", "e",
    // border-style keywords — confirmed generated for all six.
    "solid", "dashed", "dotted", "double", "hidden", "none",
  ],
  // Confirmed generated; nothing else in the radius namespace is.
  rounded: ["none", "full"],
  // Tailwind's own font-weight scale — a namespace this package deliberately
  // does not own (see the README's naming rule: `--font-*` is font-FAMILY
  // here, never weight). Confirmed generated for all nine.
  font: ["thin", "extralight", "light", "normal", "medium", "semibold", "bold", "extrabold", "black"],
  // Spacing prefixes: `px` (literal 1px) compiles for every one of them.
  // `auto` compiles ONLY for margin (`m`/`mx`/`my`) — confirmed NOT
  // generated for any padding or gap prefix. `full` does not compile for
  // ANY spacing prefix (unlike `rounded-full` or `w-full`) and is
  // deliberately omitted here for that reason.
  gap: ["px"],
  p: ["px"],
  px: ["px"],
  py: ["px"],
  pt: ["px"],
  pb: ["px"],
  pl: ["px"],
  pr: ["px"],
  m: ["px", "auto"],
  mx: ["px", "auto"],
  my: ["px", "auto"],
};

interface Finding {
  file: string;
  kind: "class" | "var";
  text: string;
  reason: string;
}

const findings: Finding[] = [];
const sourceFiles = collectSourceFiles(srcDir);

for (const file of sourceFiles) {
  const code = stripComments(readFileSync(file, "utf8"));
  const relFile = file.slice(srcDir.length + 1);
  const codeForClassScan = blankCustomProperties(code);

  for (const match of codeForClassScan.matchAll(CLASS_RE)) {
    const [full, prefix, suffix] = match;
    if (ALLOWED_SUFFIXES[prefix as string]?.includes(suffix as string)) {
      continue;
    }
    const candidates = PREFIX_CANDIDATE_FAMILIES[prefix as string]!(suffix as string);
    const resolved = candidates.some((property) => property in TOKENS);
    if (!resolved) {
      findings.push({
        file: relFile,
        kind: "class",
        text: full,
        reason: `no token matches any of: ${candidates.join(", ")}`,
      });
    }
  }

  for (const match of code.matchAll(VAR_RE)) {
    const property = match[1] as string;
    if (!(property in TOKENS)) {
      findings.push({
        file: relFile,
        kind: "var",
        text: property,
        reason: `"${property}" is not a token in @vespeneventures/tokens' TOKENS export`,
      });
    }
  }
}

describe("token parity: every token-derived class and var() read resolves to a real token", () => {
  it("found at least one Tailwind class to check (sanity — a passing test with zero coverage proves nothing)", () => {
    const totalClassesChecked = sourceFiles.reduce((n, file) => {
      const code = blankCustomProperties(stripComments(readFileSync(file, "utf8")));
      return n + [...code.matchAll(CLASS_RE)].length;
    }, 0);
    expect(totalClassesChecked).toBeGreaterThan(10);
  });

  it("found at least one raw var(--ui-*) read to check", () => {
    const totalVarsChecked = sourceFiles.reduce((n, file) => {
      const code = stripComments(readFileSync(file, "utf8"));
      return n + [...code.matchAll(VAR_RE)].length;
    }, 0);
    expect(totalVarsChecked).toBeGreaterThan(0);
  });

  it("every token-derived Tailwind class and var() read resolves to a real @vespeneventures/tokens entry", () => {
    if (findings.length > 0) {
      const report = findings
        .map((f) => `  ${f.file}: ${f.kind} "${f.text}" — ${f.reason}`)
        .join("\n");
      throw new Error(`${findings.length} unresolved token reference(s):\n${report}`);
    }
    expect(findings).toEqual([]);
  });
});
