/**
 * `generateCompiledCss` — a REAL Tailwind v4 compile of this package's own
 * class candidates (see `class-scan.ts`), run against this package's own
 * `styles/theme.css`, producing the framework-portable stylesheet shipped
 * as `@vespeneventures/designer/compiled.css` (see `README.md`'s "Framework-
 * portable components, without Tailwind" section for the consumer-facing
 * contract, and the introducing PR for why this boundary was chosen over
 * the alternatives it was weighed against — issue #174).
 *
 * NOT A REIMPLEMENTATION OF TAILWIND. This module imports `compile` from
 * the real `tailwindcss` package (already a `devDependency` and optional
 * peer of this package — see `package.json`; nothing new is added) and
 * calls its own compiler. The declarations this produces are BYTE-FOR-BYTE
 * what Tailwind itself would generate for the same candidates against the
 * same theme — this is not a second, hand-maintained approximation of what
 * `bg-accent` means, it is Tailwind's own answer, precompiled instead of
 * compiled at a consumer's own build time. That is what makes this
 * boundary smaller than it looks: it is the SAME first (Tailwind-native)
 * path, not a second styling system with its own semantics to keep in sync
 * by hand.
 *
 * WHY NOT `@import "tailwindcss"` (this package's own documented Tailwind-
 * native setup line)
 *
 * `@import "tailwindcss"` pulls in THREE things: Tailwind's own default
 * theme (its full default color/spacing/font scale — verified empirically
 * while building this: it dwarfs this package's curated ~140 tokens),
 * Tailwind's PREFLIGHT (a global `box-sizing`/margin/list-style reset
 * applied via the universal selector to every element on the page), and
 * the utilities engine. Only the last of those three is this package's
 * job. Preflight in particular is exactly the kind of decision `README.md`
 * says belongs to the consumer, not this package (a non-Tailwind consumer
 * may already have their own reset, or none at all, by choice) — shipping
 * it unconditionally inside `compiled.css` would silently overwrite that
 * choice the moment the stylesheet is imported. So this module imports
 * `tailwindcss/theme` in REFERENCE mode (Tailwind's own defaults are
 * available for internal resolution but never emitted as real CSS) and
 * `tailwindcss/utilities` directly (the engine that turns a candidate
 * string into a declaration) — never `tailwindcss/preflight`, and never
 * the full `tailwindcss` entry point.
 *
 * WHY `@theme inline` (this package's own `theme.css`), UNCHANGED
 *
 * `theme.css`'s own header comment explains why its `@theme inline` block
 * keeps every generated utility a LIVE `var(--token, default)` reference
 * rather than a value baked in at compile time — so a later brand binding
 * (`:root[data-brand-bound]`) is still picked up after the fact. This
 * module reads `theme.css` from disk UNCHANGED (stripping only its own
 * `@import "./tokens.css"` line — see below) specifically so that
 * liveness survives the precompile step too: `compiled.css`'s generated
 * `.bg-accent` rule reads `var(--color-accent, oklch(...))` exactly like
 * the Tailwind-native path's own generated CSS would, so a brand override
 * applied to the SAME `--color-accent` custom property `tokens.css`
 * declares is picked up identically on both paths — this is not a
 * separate claim to verify per path, it falls out of using the same
 * `@theme inline` source unchanged.
 *
 * WHY `theme.css`'s OWN `@import "./tokens.css"` LINE IS STRIPPED
 *
 * The three-layer contract (`README.md`, "CSS layers, fallbacks, and
 * themes") always ships `tokens.css` and `compiled.css` side by side — see
 * the README's non-Tailwind setup section. If this module left that
 * import in, `compiled.css` would carry a full second copy of every token
 * declaration `tokens.css` already ships (including the "No brand
 * binding" dev-mode badge and the `--ui-tokens-loaded` sentinel — verified
 * empirically while building this), doubling the shipped byte count for
 * declarations a consumer who follows the documented setup already has.
 * `@theme inline`'s generated utility rules read `var(--token, <literal
 * fallback>)` directly — this was likewise verified empirically — so they
 * resolve correctly against `tokens.css`'s own declarations without this
 * module re-declaring them a second time.
 *
 * WHY THE LAYER NAME
 *
 * `tailwindcss/utilities` is imported with `layer(foundry-ui-compiled)` —
 * Tailwind v4's own `@import ... layer(name)` syntax — so every generated
 * rule lands inside a NAMED layer, never bare `:root`/unlayered output.
 * This is deliberate for the same reason `tokens.css` itself moved off an
 * unlayered `:root` in #148: an unlayered rule always outranks ANY layered
 * rule regardless of import order, which would make `compiled.css`
 * silently win over a consumer's own later, layered override. Layering it
 * means: a consumer's own UNLAYERED CSS always wins (the predictable,
 * common case for a plain stylesheet or CSS Modules file), and a
 * consumer's own layered CSS wins whenever its layer is declared after
 * `foundry-ui-compiled` — the exact same override story `tokens.css`
 * already documents for `foundry-ui-tokens`, extended to this file. See
 * `override.test.ts` for the test that pins this.
 *
 * WHY THE LEADING `:root, :host { ... }` BLOCK IS STRIPPED
 *
 * `@theme inline` ALSO reflects every theme key back out as a real CSS
 * custom-property declaration at `:root, :host` — verified empirically:
 * this reflection block is UNLAYERED in Tailwind's own raw `build()`
 * output, the same #148 hazard the layer choice above exists to avoid, and
 * it is REDUNDANT: it duplicates values `tokens.css` already declares
 * (inside `@layer foundry-ui-tokens`), under a plain self-referencing
 * `var(--x, default)` that is never actually needed for the generated
 * utility rules themselves to resolve correctly (they already read
 * `var(--token, fallback)` directly, independent of this block — see
 * above). This module removes it by locating the first top-level
 * `:root, :host {` rule (a fixed, deterministic position in output THIS
 * module itself constructs — never arbitrary consumer input) and deleting
 * its balanced-brace span.
 */

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve as resolvePath } from "node:path";
import { assertPeerVersion } from "../internal/peer-version.js";
import { resolveInstalledPeerVersion } from "../internal/resolve-installed-peer-version.js";
import { TAILWINDCSS_DECLARED_RANGE } from "../internal/declared-peer-ranges.js";

export interface GenerateCompiledCssOptions {
  /** This package's own `styles/` directory (holds `theme.css`, which this module reads and re-derives from — never hand-copied). */
  stylesDir: string;
  /** Candidate class tokens to compile — the output of `scanClassCandidates`. Harmless if it contains tokens that aren't real Tailwind utilities (see `class-scan.ts`'s header); they simply produce no output. */
  candidates: string[];
}

export interface GenerateCompiledCssResult {
  css: string;
  /** Distinct utility classes Tailwind's own compiler actually recognized and emitted a rule for — a SUBSET of `candidates.length` whenever some candidates were shape-matches-but-not-real-utilities (see `class-scan.ts`). */
  classCount: number;
  byteSize: number;
}

const GENERATED_FILE_HEADER = `/* ════════════════════════════════════════════════════════════════════
 * @vespeneventures/designer · compiled.css
 * ────────────────────────────────────────────────────────────────────
 * GENERATED FILE — do not hand-edit. Produced by a real Tailwind v4
 * compile of this package's own component class candidates against this
 * package's own \`styles/theme.css\` — see \`src/compiled-css/generate.ts\`
 * for the full generation contract, and \`README.md\`'s "Framework-portable
 * components, without Tailwind" section for how to use this file.
 *
 * Regenerate: \`npm run generate:compiled-css\` (from packages/ui).
 * Verify this file is not stale: \`npm run check:compiled-css\`, or run
 * \`npm test\` — \`src/compiled-css/check.test.ts\` runs the same
 * re-derive-and-diff check as part of this package's ordinary test suite.
 *
 * Scope: this file covers \`@vespeneventures/designer/atoms\` only — the
 * self-contained base layer that composes no other component (see
 * README.md, "Placement rules"). \`blocks\`, \`shell\`, \`charts\`, and
 * \`theme\` remain Tailwind-native only; see the introducing PR for why
 * that scope was chosen for this first framework-portable contract.
 *
 * Load this AFTER \`@vespeneventures/designer/tokens.css\` (never instead of it —
 * every declaration below reads a token custom property this file does
 * NOT itself declare). Every generated rule lives inside the
 * \`foundry-ui-compiled\` layer, declared after \`foundry-ui-tokens\` — see
 * README.md's "Framework-portable components, without Tailwind" section
 * for the full override-precedence contract this layering produces.
 * ════════════════════════════════════════════════════════════════════ */

`;

/** Resolves the two `tailwindcss` subpath specifiers this module's synthetic entry CSS `@import`s — `tailwindcss/theme` (reference-mode default theme) and `tailwindcss/utilities` (the utilities engine). Both are real exports of the `tailwindcss` package already declared as a `devDependency`/optional peer of this package (see `package.json`) — nothing new. Throws a clear, actionable error (mapped to exit 2 by `cli.ts`) if `tailwindcss` is not resolvable at all, rather than letting a raw `MODULE_NOT_FOUND` from deep inside this function surface unexplained. */
function makeStylesheetLoader(stylesDir: string) {
  const require = createRequire(import.meta.url);

  function resolveTailwindSubpath(subpath: "tailwindcss/theme.css" | "tailwindcss/utilities.css"): string {
    try {
      return require.resolve(subpath);
    } catch (error) {
      throw new Error(
        `generateCompiledCss: could not resolve "${subpath}" — is "tailwindcss" installed? This generation step requires the real tailwindcss package (already a devDependency/optional peer of @vespeneventures/designer) to be present in node_modules. Original error: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  return async function loadStylesheet(
    id: string,
    base: string,
  ): Promise<{ path: string; base: string; content: string }> {
    let target: string;
    if (id === "tailwindcss/theme") {
      target = resolveTailwindSubpath("tailwindcss/theme.css");
    } else if (id === "tailwindcss/utilities") {
      target = resolveTailwindSubpath("tailwindcss/utilities.css");
    } else {
      target = resolvePath(base, id);
    }
    let content: string;
    try {
      content = readFileSync(target, "utf8");
    } catch (error) {
      throw new Error(`generateCompiledCss: cannot read stylesheet "${id}" resolved to "${target}": ${error instanceof Error ? error.message : String(error)}`);
    }
    return { path: target, base: dirname(target), content };
  };
}

/**
 * Builds this module's synthetic entry CSS: `theme.css`'s own `@theme
 * inline { ... }` block, verbatim, with its own leading `@import
 * "./tokens.css";` line stripped (see this file's header, "WHY THAT IMPORT
 * LINE IS STRIPPED"), wrapped with a reference-mode default-theme import
 * and a layer-scoped utilities import.
 */
function buildEntryCss(stylesDir: string): string {
  const themeCssPath = resolvePath(stylesDir, "theme.css");
  let themeCssFull: string;
  try {
    themeCssFull = readFileSync(themeCssPath, "utf8");
  } catch (error) {
    throw new Error(`generateCompiledCss: cannot read "${themeCssPath}": ${error instanceof Error ? error.message : String(error)}`);
  }
  const tokensImportRe = /^@import\s+["']\.\/tokens\.css["'];\s*\n/m;
  if (!tokensImportRe.test(themeCssFull)) {
    throw new Error(
      `generateCompiledCss: "${themeCssPath}" no longer starts with the expected \`@import "./tokens.css";\` line this generator strips — theme.css's shape changed; update generate.ts's stripping logic to match.`,
    );
  }
  const themeBlockOnly = themeCssFull.replace(tokensImportRe, "");
  return `@import "tailwindcss/theme" theme(reference);\n${themeBlockOnly}\n@import "tailwindcss/utilities" layer(foundry-ui-compiled);\n`;
}

/**
 * Removes the redundant, unlayered `:root, :host { ... }` theme-reflection
 * block Tailwind's own `@theme inline` handling emits (see this file's
 * header). Locates the FIRST top-level occurrence of `:root, :host {` and
 * deletes its balanced-brace span — safe because this function only ever
 * runs against output THIS module itself constructed via a real Tailwind
 * compile (never arbitrary consumer input), so the shape is deterministic.
 * Throws rather than silently no-op-ing if the expected block is missing —
 * a shape this function doesn't recognize is a signal Tailwind's own
 * output changed, not something to guess past.
 */
function stripThemeReflectionBlock(css: string): string {
  const marker = ":root, :host {";
  const start = css.indexOf(marker);
  if (start === -1) {
    throw new Error(
      `generateCompiledCss: expected a ":root, :host {" theme-reflection block in Tailwind's raw output and found none — this module's assumptions about tailwindcss's build() output shape may be stale.`,
    );
  }
  let depth = 0;
  let i = start;
  for (; i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}") {
      depth--;
      if (depth === 0) {
        i++;
        break;
      }
    }
  }
  if (depth !== 0) {
    throw new Error(`generateCompiledCss: the ":root, :host { ... }" block's braces never balanced — cannot safely strip it.`);
  }
  // Also consume one trailing newline so the removal doesn't leave a blank line behind.
  let end = i;
  if (css[end] === "\n") end++;
  return css.slice(0, start) + css.slice(end);
}

/**
 * Tailwind v4's own internal `--tw-*` custom properties (`--tw-border-
 * style`, `--tw-content`, `--tw-translate-x`, ...) are read via a BARE
 * `var(--tw-x)` with no fallback argument — verified against this
 * package's own real generated output, and identical to what a consumer's
 * own native Tailwind build already produces for the same classes (this is
 * ordinary Tailwind v4 behavior, not something this generator introduces).
 * In a normal project, that bare read is safe: the SAME stylesheet also
 * registers `@property --tw-x { ...; initial-value: <V>; }`, so a browser
 * that understands `@property` resolves the bare `var()` to `<V>` even
 * with nothing else in scope, and Tailwind's own `@layer properties {
 * @supports (...) { *, ::before, ::after, ::backdrop { --tw-x: <V>; } } }`
 * block (emitted alongside, unchanged by this module) additionally
 * establishes the same default for a browser that does not.
 *
 * This function adds a THIRD, explicit layer of defense on top of those
 * two, rewriting every such bare read to `var(--tw-x, <V>)` using the
 * SAME initial-value the file's own `@property` rule for that name already
 * declares (parsed from the real generated output, never a hand-copied
 * duplicate) — so the property resolves correctly even for a reader (a
 * static analysis tool, an unusual embedding context) that doesn't run the
 * `@property`/`@supports` machinery at all. Never invents a value: a
 * `--tw-x` name with no `initial-value` anywhere in this output (a few
 * exist — e.g. `--tw-tracking` — genuinely have no registered default, by
 * Tailwind's own design) is left exactly as Tailwind emitted it.
 */
function addExplicitFallbacksForInternalProperties(css: string): string {
  const initialValues = new Map<string, string>();
  const propertyRe = /@property\s+(--tw-[a-zA-Z0-9-]+)\s*\{([^}]*)\}/g;
  for (const m of css.matchAll(propertyRe)) {
    const name = m[1] as string;
    const body = m[2] as string;
    const initialValueMatch = /initial-value:\s*([^;]+);/.exec(body);
    if (initialValueMatch) {
      initialValues.set(name, (initialValueMatch[1] as string).trim());
    }
  }
  if (initialValues.size === 0) return css;
  return css.replace(/var\(\s*(--tw-[a-zA-Z0-9-]+)\s*\)/g, (whole, name: string) => {
    const value = initialValues.get(name);
    return value === undefined ? whole : `var(${name}, ${value})`;
  });
}

/**
 * `tailwindcss` is one of this package's optional peers (see
 * package.json's `peerDependenciesMeta`) — optional so a token-only or
 * `compiled.css`-only consumer never needs it. This module (see its own
 * header) is the one place in this package that imports the real
 * `tailwindcss` package, and — unlike `atoms/index.ts` and friends — it is
 * a repository-internal build tool with no `exports` subpath of its own,
 * so it is never reachable by an external consumer, browser or otherwise;
 * the Node-only `resolveInstalledPeerVersion` is safe to use here
 * unconditionally (this file already imports `node:fs`/`node:module`
 * above for its own, pre-existing resolution logic). `TAILWINDCSS_
 * DECLARED_RANGE` must match package.json's `peerDependencies.tailwindcss`
 * exactly — `declared-peer-ranges.test.ts` asserts that directly. An
 * absent or out-of-range `tailwindcss` previously surfaced only as
 * `resolveTailwindSubpath`'s own "could not resolve" error below (still
 * accurate for genuine absence, but silent about a version mismatch) or
 * an unexplained crash inside Tailwind's own `compile()`/`build()` calls.
 */
export async function generateCompiledCss(options: GenerateCompiledCssOptions): Promise<GenerateCompiledCssResult> {
  assertPeerVersion({
    peer: "tailwindcss",
    declaredRange: TAILWINDCSS_DECLARED_RANGE,
    foundVersion: resolveInstalledPeerVersion("tailwindcss", import.meta.url),
  });
  const { compile } = await import("tailwindcss");
  const entryCss = buildEntryCss(options.stylesDir);
  const loadStylesheet = makeStylesheetLoader(options.stylesDir);

  const compiled = await compile(entryCss, {
    base: options.stylesDir,
    loadStylesheet,
  });

  const rawCss = compiled.build(options.candidates);
  const stripped = stripThemeReflectionBlock(rawCss);
  const withFallbacks = addExplicitFallbacksForInternalProperties(stripped);
  const finalCss = GENERATED_FILE_HEADER + withFallbacks.trimStart();

  // Count distinct utility CLASS selectors actually emitted (not every
  // candidate — see `GenerateCompiledCssResult.classCount`'s own doc
  // comment). `@property`/`@layer properties` fallback machinery and
  // `@media` wrappers are not classes; a plain regex over `.` selectors is
  // enough for a REPORTED count (see the introducing PR body), not a
  // correctness-critical value anything else here depends on.
  const classSelectorMatches = finalCss.match(/^\s*\.[a-zA-Z0-9_:/.\\-]+(?=\s*\{|,)/gm) ?? [];
  const classCount = new Set(classSelectorMatches.map((s) => s.trim())).size;

  return {
    css: finalCss,
    classCount,
    byteSize: Buffer.byteLength(finalCss, "utf8"),
  };
}
