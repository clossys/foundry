/**
 * Override-precedence tests for the compiled-CSS path — see this file's
 * header for what IS and is NOT provable without a real browser.
 *
 * WHAT IS PROVABLE HERE, STRUCTURALLY: the CSS Cascading Layers spec
 * (a mature, universally-supported feature in every evergreen browser)
 * guarantees that an UNLAYERED rule always wins over ANY layered rule of
 * equal or lower specificity, regardless of source order, and that among
 * layered rules, a layer declared LATER in the cascade wins over one
 * declared earlier. Those are spec guarantees, not implementation details
 * this package could get subtly wrong per-browser — so if this test proves
 * `compiled.css` places 100% of its style declarations inside the named
 * `foundry-ui-compiled` layer (never bare/unlayered), the override
 * behavior documented in README.md follows from the CSS spec itself, not
 * from a browser test. This is the same reasoning `tokens.css`'s own
 * `foundry-ui-tokens` layer relies on (see #148).
 *
 * WHAT IS NOT PROVABLE HERE: that a real browser actually implements the
 * spec correctly, or the exact RESOLVED pixel/color value a consumer sees
 * after an override — either needs `getComputedStyle` in a real browser.
 * jsdom has no CSS engine at all (it does not parse or apply stylesheets),
 * so no test in this package's suite — including this one — can execute a
 * real cascade. See the introducing PR body for the full statement of what
 * is and is not verified.
 */
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { generateCompiledCss } from "./generate.js";
import { scanClassCandidates } from "./class-scan.js";

const packageRoot = resolve(import.meta.dirname, "..", "..");

/**
 * Parses `css` for every top-level (non-`@media`/`@supports`-nested is
 * fine, but non-`@layer`-nested is not) rule with a `.`-selector or
 * `@property`/`@keyframes` at-rule, and asserts each style-bearing rule
 * (one that sets real CSS declarations on a selector) sits inside SOME
 * named `@layer` block. A lightweight, purpose-built brace-depth walk
 * rather than a full CSS parser — sufficient because this is OUR OWN
 * generated output with a known, bounded shape, not arbitrary CSS.
 */
function ruleLayerMembership(rawCss: string): { insideLayer: string[]; outsideLayer: string[] } {
  // Strip every `/* ... */` comment first — including this file's own
  // generated-file header banner and Tailwind's own `/*! tailwindcss ... */`
  // credit line. Without this, a stray "." inside ordinary prose (this
  // package's own header references "compiled.css", "generate.ts", and
  // several npm commands full of dots/colons/slashes) is indistinguishable
  // from the start of a real selector to the lightweight matcher below,
  // which has no comment-awareness of its own (see this file's header for
  // why a full CSS parser isn't used here) — verified necessary while
  // building this test: without stripping comments first, the greedy
  // `[^{]*` selector-body match swallowed everything from the first stray
  // "." in the header comment through to the file's first REAL brace,
  // silently mis-scoring the whole `@layer foundry-ui-compiled` block as
  // one bogus "outside layer" rule.
  const css = rawCss.replace(/\/\*[\s\S]*?\*\//g, "");
  const insideLayer: string[] = [];
  const outsideLayer: string[] = [];
  let i = 0;
  const layerOpenRe = /^@layer\s+[\w-]+\s*\{/;
  const propertyOrKeyframesRe = /^@(property|keyframes)\b/;
  // @media (...) { ... }, @supports (...) { ... }, and any other wrapping
  // at-rule that CONTAINS nested rules rather than being a leaf block.
  // The prelude class EXCLUDES ";" and "}" (not just "{"): a BARE at-rule
  // statement like "@layer properties;" has no brace of its own, and
  // without excluding ";" this regex's greedy scan would run straight past
  // it looking for the NEXT "{" anywhere later in the file — including one
  // that belongs to a completely different, unrelated rule — merging two
  // unrelated constructs into one bogus "wrapper" match (a real bug caught
  // while building this test).
  const wrapperAtRuleOpenRe = /^@[\w-]+[^{;}]*\{/;

  // A brace-kind STACK, not a single counter: `@media`/`@supports` wrap
  // rules INSIDE the SAME `@layer foundry-ui-compiled { ... }` block (see
  // the real generated output — `@media (hover: hover) { .hover\:... }`
  // sits nested inside the layer). A single "layerDepth" counter that
  // treats every `}` as closing the nearest layer is wrong the moment a
  // non-layer wrapper's OWN closing brace appears first — it under-counts
  // and prematurely reports layerDepth back to 0, mis-scoring every rule
  // that follows within the SAME still-open layer (a real bug caught while
  // building this test: `@media (hover: hover) { ... }`'s closing brace
  // was wrongly decrementing a bare layer counter, making every rule after
  // it — `focus-visible:`, `disabled:`, `motion-reduce:` — read as
  // "outside" the layer even though they are still textually inside it).
  // Tracking each brace's KIND on a stack and testing "is any stack entry
  // a layer" is correct regardless of nesting order or depth.
  const stack: boolean[] = []; // true = this open brace was "@layer NAME {"

  while (i < css.length) {
    const rest = css.slice(i);

    const layerOpenMatch = layerOpenRe.exec(rest);
    if (layerOpenMatch) {
      stack.push(true);
      i += layerOpenMatch[0].length;
      continue;
    }
    // `@property`/`@keyframes` blocks are Tailwind's own global scaffolding
    // (custom-property syntax registration, animation keyframes) — not
    // competing style declarations on a class selector, so they carry no
    // override implication and are deliberately skipped whole here (never
    // pushed onto the tracking list at all — their own internal braces are
    // read and balanced by this branch's own brace walk, matching
    // `generate.ts`'s own comment on why they sit outside the named layer,
    // the same shape Tailwind's own native output already has).
    if (propertyOrKeyframesRe.test(rest)) {
      const braceStart = css.indexOf("{", i);
      let depth = 1;
      let j = braceStart + 1;
      while (j < css.length && depth > 0) {
        if (css[j] === "{") depth++;
        else if (css[j] === "}") depth--;
        j++;
      }
      i = j;
      continue;
    }
    const classSelectorMatch = /^\s*\.[a-zA-Z0-9_:/.\\-]+[^{]*\{/.exec(rest);
    if (classSelectorMatch) {
      (stack.some(Boolean) ? insideLayer : outsideLayer).push(classSelectorMatch[0].trim());
      // Advance past this rule's own self-contained block (never added to
      // the tracking list — a plain selector's braces always balance
      // within themselves and never wrap another tracked construct).
      const braceStart = i + classSelectorMatch[0].indexOf("{");
      let depth = 1;
      let j = braceStart + 1;
      while (j < css.length && depth > 0) {
        if (css[j] === "{") depth++;
        else if (css[j] === "}") depth--;
        j++;
      }
      i = j;
      continue;
    }
    const wrapperOpenMatch = wrapperAtRuleOpenRe.exec(rest);
    if (wrapperOpenMatch) {
      // A wrapping at-rule (`@media (hover: hover) { ... }`,
      // `@supports (...) { ... }`) that contains further nested rules —
      // push `false` so its own closing brace pops correctly WITHOUT being
      // mistaken for a layer's closing brace.
      stack.push(false);
      i += wrapperOpenMatch[0].length;
      continue;
    }
    if (css[i] === "}") {
      stack.pop();
      i++;
      continue;
    }
    i++;
  }
  return { insideLayer, outsideLayer };
}

describe("override precedence — structural proof", () => {
  it("places every class-selector style rule inside a named @layer (never bare/unlayered)", async () => {
    const scan = scanClassCandidates(resolve(packageRoot, "src", "atoms"));
    const generated = await generateCompiledCss({ stylesDir: resolve(packageRoot, "styles"), candidates: scan.candidates });
    const { insideLayer, outsideLayer } = ruleLayerMembership(generated.css);
    expect(insideLayer.length).toBeGreaterThan(0);
    expect(outsideLayer).toEqual([]);
  });

  it("declares the layer name as foundry-ui-compiled (matching README.md's documented precedence contract)", async () => {
    const scan = scanClassCandidates(resolve(packageRoot, "src", "atoms"));
    const generated = await generateCompiledCss({ stylesDir: resolve(packageRoot, "styles"), candidates: scan.candidates });
    expect(generated.css).toContain("@layer foundry-ui-compiled {");
  });
});
