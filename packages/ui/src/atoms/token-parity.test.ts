import { readFileSync, readdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { __unstable__loadDesignSystem } from "tailwindcss";
import { TOKENS } from "@vespeneventures/tokens";

/**
 * The highest-value test in this package (see the README's "Tests"
 * section). Every atom, block, AND shell component styles with Tailwind
 * classes generated from @vespeneventures/tokens, and separately with a
 * handful of raw `var(--ui-*)` reads for tokens that have no Tailwind
 * namespace. Neither of those is checked by TypeScript — a class name and a
 * `var()` argument are both just strings to the compiler. A typo like
 * `bg-surface-elevated` (no such token; the real name is `surface-raised`)
 * would compile clean, render with zero applied background, and produce no
 * error anywhere — this is the only thing that catches it.
 *
 * ── WHY THIS FILE WAS REDESIGNED ──────────────────────────────────────
 *
 * The previous version of this file was a hand-maintained regex: it matched
 * `\b(prefix)-(suffix)\b` for a fixed list of prefixes it knew were
 * token-derived (`bg-`, `text-`, `border-`, `rounded-`, ...), then checked
 * `suffix` against @vespeneventures/tokens' own `TOKENS` export. Anything
 * that wasn't a token — including Tailwind's OWN built-in vocabulary that
 * happens to share a prefix with a token family — had to be hand-enumerated
 * in an `ALLOWED_SUFFIXES` allow-list to avoid being rejected as invented.
 * That list drifted every time a legitimate Tailwind utility didn't happen
 * to be on it yet, and each drift forced a real workaround into shipped
 * code rather than a test fix: `EmptyState` dropped `text-center` for a
 * flex-only centering approach; `Shell` moved `border-b`/`mx-auto`/
 * `text-inherit`/`bg-transparent` into inline `style`; `Shell` abandoned
 * the `--ui-border-hairline` token for a hardcoded `"1px"` (the token's own
 * PROPERTY NAME contains the substring `border-hairline`, which the old
 * class-scanning regex matched as if it were an unresolved `border-hairline`
 * utility); and, most recently, `Table` and `Tabs` reached for a raw
 * `style` `borderCollapse`/inset `box-shadow` in place of `border-collapse`
 * and `border-b-2` — Tailwind border-WIDTH utilities that don't map to any
 * token this package owns, so the allow-list never grew an entry for them
 * either. Enumerating "every suffix Tailwind ships that isn't a token" is
 * trying to hand-copy another tool's entire vocabulary; it will always be
 * one utility behind.
 *
 * The fix here isn't a bigger list. It's asking Tailwind itself whether a
 * class is real, by literally compiling it — `tailwindcss`'s own
 * `__unstable__loadDesignSystem` JS API (a `devDependency` of this
 * package already), fed this package's own token CSS
 * (`@vespeneventures/tokens/theme.css`), the same way a consumer's real
 * build would. `designSystem.candidatesToCss(candidates)` returns, per
 * candidate, either a real CSS rule or `null` for "Tailwind has no idea
 * what this is" — variants (`hover:`, `not-last:`, custom breakpoints like
 * `desktop:`), arbitrary values (`shadow-[var(--ui-elevation-raised)]`,
 * `grid-cols-[auto_minmax(0,1fr)_auto]`), and Tailwind's own reserved
 * vocabulary (`sr-only`, `border-collapse`, `border-b-2`, text-align
 * keywords, ...) all resolve correctly with ZERO hand-maintained list,
 * because the compiler that will actually render this package's CSS is the
 * one answering the question, not a regex trying to predict its output.
 * This has zero false positives BY CONSTRUCTION — every one of the six
 * utilities in the paragraph above compiles clean here — while still
 * catching a genuinely invented token class exactly as before: an unknown
 * candidate produces no CSS anywhere, the same failure mode a browser would
 * actually hit.
 *
 * The one thing Tailwind's compiler *can't* police is this package's own
 * token vocabulary — `shadow-[var(--ui-elevation-raised)]` compiles to a
 * real `box-shadow` declaration whether or not `--ui-elevation-raised`
 * exists as a real @vespeneventures/tokens entry, because from Tailwind's
 * point of view an arbitrary-value `var()` argument is just an opaque
 * string. That's exactly the class of bug the raw `var(--ui-*)` /
 * `var(--color-*)` scan below still exists for — it runs across the same
 * raw source text, so it independently catches a bad token name whether it
 * appears in a plain `style` object OR inside a Tailwind arbitrary value
 * like the one above. The two checks are complementary, not redundant:
 * Tailwind is the oracle for "is this a real utility"; `TOKENS` is the
 * oracle for "does this custom property actually exist".
 *
 * A second, structural side-effect of the redesign: the previous version
 * had to defend against a raw `var()` read's PROPERTY NAME leaking into the
 * class-name scan (`--ui-border-hairline` contains the substring
 * `border-hairline`, which its prefix/suffix regex read as an attempted
 * `border-hairline` utility) by blanking out every custom-property name in
 * a scratch copy of the source before running the class regex over it. That
 * whole class of bug is gone here, not patched: candidate CLASSES are only
 * ever extracted from three syntactic positions — a `className="..."` JSX
 * attribute, the arguments of a `cx(...)` call, and the string values of a
 * `Record<Variant, string>` "variant map" object literal (see
 * `extractCandidateClasses` below) — none of which a bare `var(--ui-*, ...)`
 * string assigned to its own constant (see `internal/ui-vars.ts`,
 * `shell/internal/shell-vars.ts`) ever appears inside. There is no text for
 * a property name to "leak into", because nothing here scans arbitrary
 * text for class-shaped substrings anymore.
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

// ── Class-candidate extraction ──────────────────────────────────────────
//
// Deliberately three narrow syntactic positions, not "every quoted string
// in the file": a generic scan would also catch `gridArea: "header"` and
// `role={isError ? "alert" : "status"}` (both real strings in this
// package's source, neither a Tailwind class) and reject them as invented
// classes. Scoping to where this package ACTUALLY writes class lists avoids
// that without needing a second allow-list to exempt non-class strings —
// the same lesson the redesign above applies to Tailwind's own vocabulary,
// applied here to this package's own non-class string literals.

/** A plain `className="..."` / `className='...'` JSX attribute. */
const CLASSNAME_ATTR_RE = /\bclassName\s*=\s*"([^"]*)"|\bclassName\s*=\s*'([^']*)'/g;

/**
 * `typeof className === "function" ? className(renderProps) : className` —
 * the consumer-`style`/`className`-merging pattern `Button`, `Link`,
 * `Switch`, and `Checkbox` all share — sits INSIDE several of this
 * package's `cx(...)` calls (as one of the ternary's branches), and its
 * `"function"` string literal is not a class, it's a JS `typeof` comparison.
 * Stripped out before the quoted-string scan below runs over a `cx(...)`
 * call's argument text, the same way `stripComments` removes prose before
 * either scan runs — a targeted fix for a real, narrow idiom, not a second
 * hand-maintained exemption list.
 */
const TYPEOF_COMPARISON_RE = /\btypeof\s+[\w.]+\s*(?:===|!==|==|!=)\s*"[^"]*"/g;

function stripTypeofComparisons(text: string): string {
  return text.replace(TYPEOF_COMPARISON_RE, " ");
}

/**
 * Every top-level string/template literal inside `text` — used against a
 * `cx(...)` call's own argument text (so it sees every branch of a
 * ternary, e.g. `Menu.Item`'s `isDestructive ? "..." : "..."`) and against
 * a variant map's object body. Not scoped to comma-separated top-level
 * arguments specifically: a literal can appear at any nesting depth inside
 * a `cx(...)` call (a ternary, a `&&`), and every one of those branches is
 * a real candidate class list whenever it's the one selected at runtime.
 */
const QUOTED_STRING_RE = /"([^"]*)"|'([^']*)'|`([^`]*)`/g;

function stringLiteralsIn(text: string): string[] {
  const out: string[] = [];
  for (const match of text.matchAll(QUOTED_STRING_RE)) {
    out.push(match[1] ?? match[2] ?? match[3] ?? "");
  }
  return out;
}

/**
 * Finds every call to `calleeName(...)` and returns each call's full
 * argument text, quote- and nesting-aware. A plain regex can't do this on
 * its own: `cx("grid-cols-[auto_minmax(0,1fr)_auto]", className)` has
 * PARENTHESES inside its own string literal (`minmax(0,1fr)`), so a naive
 * "count parens" scan would think the call ends early. This walks the
 * source character-by-character, tracking whether it's currently inside a
 * quoted string (parens inside a string never affect nesting depth) and
 * only counting `(`/`)` outside of one — the minimum needed to find the
 * TRUE matching close-paren, without pulling in a real parser for it (this
 * package has none, the same reason `ladder.test.ts` stays regex-based —
 * see its own header comment).
 */
function extractCallArgs(code: string, calleeName: string): string[] {
  const args: string[] = [];
  const calleeRe = new RegExp(`\\b${calleeName}\\s*\\(`, "g");
  for (const match of code.matchAll(calleeRe)) {
    const start = match.index + match[0].length;
    let depth = 1;
    let i = start;
    let quote: string | null = null;
    while (i < code.length && depth > 0) {
      const ch = code[i];
      if (quote) {
        if (ch === "\\") {
          i += 2;
          continue;
        }
        if (ch === quote) quote = null;
      } else if (ch === '"' || ch === "'" || ch === "`") {
        quote = ch;
      } else if (ch === "(") {
        depth++;
      } else if (ch === ")") {
        depth--;
      }
      i++;
    }
    args.push(code.slice(start, i - 1));
  }
  return args;
}

/**
 * A "variant map": `const XXX_CLASSES: Record<SomeVariant, string> = {...}`
 * (or, for `Avatar`'s size map, `Record<AvatarSize, { box: string; text:
 * string }>` — a nested object, still string-valued throughout). Every
 * atom's variant styling in this package is one of these, keyed by variant
 * name, looked up by a computed expression (`VARIANT_CLASSES[variant]`)
 * that a static scan can't resolve — so this reads the map's own DECLARATION
 * instead of trying to follow the reference into `cx(...)`. `[^=]*` (not
 * `[^={]*`) deliberately allows a `{` inside the type parameter itself
 * (`Avatar`'s nested object type) — the type annotation never contains a
 * bare `=`, so a lazy match up to the first one still lands on the real
 * assignment.
 */
const VARIANT_MAP_RE = /const\s+[A-Za-z_]*CLASSES\s*:\s*Record<[^=]*>\s*=\s*\{([\s\S]*?)\n\};/g;

/**
 * Every `Record<...>` map declaration, with its name — used by the coverage
 * assertion below, NOT by class extraction.
 */
const ANY_RECORD_MAP_RE = /const\s+([A-Za-z_]+)\s*:\s*Record</g;

/**
 * Maps that are deliberately NOT class lists, and so are deliberately not
 * scanned. Each entry is a promise that the map holds something else —
 * `Stat`'s trend indicators hold a glyph and a label, because encoding
 * direction by colour alone fails accessibility, so the glyph and the
 * words are the non-colour channel.
 *
 * This list exists so that skipping a map is a DELIBERATE act. The class
 * extractor above only reads maps named `*CLASSES`, which is precise but
 * would otherwise fail open: a class map named `BUTTON_STYLES` would
 * silently never be checked, and a typo inside it would ship. The
 * assertion that consumes this list closes that hole — every `Record` map
 * must be either scanned or named here, so a new map cannot quietly
 * escape both.
 */
const KNOWN_NON_CLASS_MAPS = new Set(["TREND_GLYPH", "TREND_LABEL"]);

function extractCandidateClasses(code: string): Set<string> {
  const chunks: string[] = [];

  for (const match of code.matchAll(CLASSNAME_ATTR_RE)) {
    chunks.push(match[1] ?? match[2] ?? "");
  }
  for (const args of extractCallArgs(code, "cx")) {
    chunks.push(...stringLiteralsIn(stripTypeofComparisons(args)));
  }
  for (const match of code.matchAll(VARIANT_MAP_RE)) {
    chunks.push(...stringLiteralsIn(match[1] ?? ""));
  }

  const classes = new Set<string>();
  for (const chunk of chunks) {
    for (const token of chunk.split(/\s+/)) {
      if (token) classes.add(token);
    }
  }
  return classes;
}

// ── Raw var(--...) read validation — unchanged in approach ─────────────
//
// Tailwind can't validate these (see the header comment above): a
// `var(--anything)` argument, whether written as a plain `style` value or
// tucked inside a Tailwind arbitrary value, is opaque to Tailwind's
// compiler. This stays a list-based check against the real `TOKENS` export,
// run over each file's full, UNMODIFIED source — nothing here needs to
// dodge the class-name scan the way the old version's blanking pass did,
// because (per the header comment) the class scan no longer looks at
// arbitrary text at all.
const VAR_RE = /var\(\s*(--[a-zA-Z0-9-]+)\s*(?:,|\))/g;

// ── Compile Tailwind once, using this package's real token CSS ─────────
//
// `require.resolve` (via `createRequire`, since this file is ESM) rather
// than a hardcoded path: this package, `@vespeneventures/tokens`, and
// `tailwindcss` are all real npm dependencies resolved through the normal
// module graph (an npm workspace symlink in this monorepo, a real
// `node_modules` install for an external consumer of this package) — using
// Node's own resolver is what makes this the same "real build" a consumer
// would get, not a path that only happens to work in this repository's
// layout. `tailwindcss`'s bare specifier needs one explicit rewrite to
// `tailwindcss/index.css`: `@import "tailwindcss"` in a real build resolves
// through that package's own `exports` map's `style` CONDITION, which
// Node's plain CJS `require.resolve` (no loader for a `style` export
// condition exists) can't follow on its own — every other specifier this
// package imports (`@vespeneventures/tokens/theme.css`, and that file's own
// relative `./tokens.css`) already names its `.css` file explicitly, so no
// such rewrite is needed for them.
const require = createRequire(import.meta.url);

async function loadStylesheet(id: string, base: string) {
  let resolved: string;
  if (id.startsWith(".") || id.startsWith("/")) {
    resolved = require.resolve(id, { paths: [base] });
  } else if (id === "tailwindcss") {
    resolved = require.resolve("tailwindcss/index.css");
  } else {
    resolved = require.resolve(id);
  }
  return { path: resolved, base: dirname(resolved), content: readFileSync(resolved, "utf8") };
}

const TOKEN_CSS_ENTRY = [
  '@import "tailwindcss";',
  '@import "@vespeneventures/tokens/theme.css";',
].join("\n");

// One compile for the whole file, not one per class: `candidatesToCss`
// accepts the full candidate list at once and is the only Tailwind call
// this file makes — see the README's "Tests" section for why that matters
// for keeping this fast.
const designSystem = await __unstable__loadDesignSystem(TOKEN_CSS_ENTRY, {
  base: srcDir,
  loadStylesheet,
});

interface Finding {
  file: string;
  kind: "class" | "var";
  text: string;
  reason: string;
}

const findings: Finding[] = [];
const sourceFiles = collectSourceFiles(srcDir);

const allCandidateClasses = new Set<string>();
const classesByFile = new Map<string, Set<string>>();
const varsByFile = new Map<string, string[]>();

for (const file of sourceFiles) {
  const raw = readFileSync(file, "utf8");
  const code = stripComments(raw);
  const relFile = file.slice(srcDir.length + 1);

  const classes = extractCandidateClasses(code);
  classesByFile.set(file, classes);
  for (const c of classes) allCandidateClasses.add(c);

  const vars = [...code.matchAll(VAR_RE)].map((match) => match[1] as string);
  varsByFile.set(file, vars);
  for (const property of vars) {
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

// One compiler call for every candidate across every file, then a map
// lookup per file below — the compile is the expensive part, and it only
// happens once regardless of how many files or classes there are.
const candidateList = [...allCandidateClasses];
const compiledResults = designSystem.candidatesToCss(candidateList);
const invalidClasses = new Set(
  candidateList.filter((_, i) => compiledResults[i] === null),
);

for (const [file, classes] of classesByFile) {
  const relFile = file.slice(srcDir.length + 1);
  for (const className of classes) {
    if (invalidClasses.has(className)) {
      findings.push({
        file: relFile,
        kind: "class",
        text: className,
        reason: "Tailwind compiled this to no CSS rule at all — not a real utility, not a token-derived class",
      });
    }
  }
}

describe("token parity: every Tailwind class and var() read resolves against a real compile", () => {
  it("found at least one Tailwind class to check (sanity — a passing test with zero coverage proves nothing)", () => {
    expect(allCandidateClasses.size).toBeGreaterThan(10);
  });

  it("found at least one raw var(--ui-*) read to check", () => {
    const totalVarsChecked = [...varsByFile.values()].reduce((n, vars) => n + vars.length, 0);
    expect(totalVarsChecked).toBeGreaterThan(0);
  });

  it("every className/cx()/variant-map class resolves to a real Tailwind rule, and every var() read resolves to a real token", () => {
    if (findings.length > 0) {
      const report = findings
        .map((f) => `  ${f.file}: ${f.kind} "${f.text}" — ${f.reason}`)
        .join("\n");
      throw new Error(`${findings.length} unresolved reference(s):\n${report}`);
    }
    expect(findings).toEqual([]);
  });

  /**
   * A permanent regression guard for the exact failure this file was
   * redesigned to fix, independent of what today's real components happen
   * to use — checked directly against the compiled design system, not by
   * scanning any file. If a future Tailwind upgrade ever stopped
   * recognizing one of these, this fails with a clear "which utility"
   * signal instead of a contributor rediscovering it by hand a fifth time.
   */
  it("compiles every utility that previously forced a workaround, and still rejects an invented token class", () => {
    const previouslyRejectedButLegitimate = [
      "text-center", // EmptyState — was deleted for a flex-only centering approach
      "mx-auto", // Shell.Main — was moved to inline `marginInline: "auto"`
      "text-inherit", // was moved to inline `style`
      "bg-transparent", // was moved to inline `style`
      "border-collapse", // Table — was `style={{ borderCollapse: "collapse" }}`
      "border-b-2", // Tabs — was an inset box-shadow standing in for a real border
      "border-b-0", // was avoided via a `not-last:` variant instead
    ];
    const invented = ["bg-surface-elevated"]; // no such token — the real name is `surface-raised`

    const results = designSystem.candidatesToCss([...previouslyRejectedButLegitimate, ...invented]);

    previouslyRejectedButLegitimate.forEach((className, i) => {
      expect(results[i], `expected "${className}" to compile to a real rule`).not.toBeNull();
    });
    invented.forEach((className, i) => {
      const result = results[previouslyRejectedButLegitimate.length + i];
      expect(result, `expected invented class "${className}" to produce no rule`).toBeNull();
    });
  });

  /**
   * Closes the fail-open hole in the class extractor. It only reads maps
   * named `*CLASSES`, which is precise — but on its own it would mean a
   * class map named anything else is silently never checked, and a typo
   * inside it ships unnoticed. A test that quietly stops covering things
   * is worse than no test, because it still reads as green.
   *
   * So: every `Record<...>` map in the source must be either scanned
   * (named `*CLASSES`) or explicitly listed as a known non-class map.
   * Adding a map that is neither fails here, and the fix is to name it
   * correctly or declare why it holds something other than classes.
   */
  it("every Record map is either scanned as classes or explicitly declared non-class", () => {
    const unaccounted: string[] = [];

    for (const file of sourceFiles) {
      const code = stripComments(readFileSync(file, "utf8"));
      for (const match of code.matchAll(ANY_RECORD_MAP_RE)) {
        const name = match[1] as string;
        if (name.includes("CLASSES")) continue;
        if (KNOWN_NON_CLASS_MAPS.has(name)) continue;
        unaccounted.push(`  ${file.slice(srcDir.length + 1)}: ${name}`);
      }
    }

    if (unaccounted.length > 0) {
      throw new Error(
        `${unaccounted.length} Record map(s) neither scanned nor declared non-class:\n` +
          `${unaccounted.join("\n")}\n\n` +
          `A map holding Tailwind classes must be named *CLASSES so the parity ` +
          `check reads it. A map holding anything else must be added to ` +
          `KNOWN_NON_CLASS_MAPS, which documents what it holds instead.`,
      );
    }
    expect(unaccounted).toEqual([]);
  });
});
