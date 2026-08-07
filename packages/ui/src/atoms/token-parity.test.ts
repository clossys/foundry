import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { TOKENS } from "@vespeneventures/tokens";

/**
 * The highest-value test in this package (see the README's "Tests"
 * section). Every atom styles with Tailwind classes generated from
 * @vespeneventures/tokens, and separately with a handful of raw
 * `var(--ui-*)` reads for tokens that have no Tailwind namespace. Neither
 * of those is checked by TypeScript — a class name and a `var()` argument
 * are both just strings to the compiler. A typo like `bg-surface-elevated`
 * (no such token; the real name is `surface-raised`) would compile clean,
 * render with zero applied background, and produce no error anywhere —
 * this is the only thing that would catch it, because it is the only
 * check that imports the real token catalog and asks "does this name
 * actually exist" rather than "does this parse".
 */

const atomsDir = dirname(fileURLToPath(import.meta.url));

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

interface Finding {
  file: string;
  kind: "class" | "var";
  text: string;
  reason: string;
}

const findings: Finding[] = [];
const sourceFiles = collectSourceFiles(atomsDir);

for (const file of sourceFiles) {
  const code = stripComments(readFileSync(file, "utf8"));
  const relFile = file.slice(atomsDir.length + 1);

  for (const match of code.matchAll(CLASS_RE)) {
    const [full, prefix, suffix] = match;
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
      const code = stripComments(readFileSync(file, "utf8"));
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
