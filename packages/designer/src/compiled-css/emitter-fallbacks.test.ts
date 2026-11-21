// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { TOKENS } from "../tokens/tokens.js";
import { compiledCssDeclaredSources } from "./generate.js";
import { UndeclaredTokenFallbackError, classifyFallbackReads, globalDeclaredTokenValues, type DeclaredSources } from "./declared-fallbacks.js";
import { alignEmitterText, emitterComputedFallbacks, emitterFiles, emitterInterpolatedReads, emitterReads } from "./emitter-fallbacks.js";

/**
 * CONTAM-U9 and D5-2C: every `var(--x)` Designer's block, specimen, token-preview and component
 * emitters write carries a fallback (the generated component preview runtime is not walked). Where `--x` has a global declared value (`:root` or theme level; for `--tw-*`, its
 * `@property` initial value) the fallback equals that value, expanded (CONTAM-U6 B). A read of a
 * runtime-only variable carries `unset`. A fallback computed by code reads the token registry,
 * whose value must equal the declared value. Values come from the reader `compiled.css` uses.
 */
const packageRoot = resolve(import.meta.dirname, "../..");
const styles = resolve(packageRoot, "styles");
const compiled = readFileSync(resolve(styles, "compiled.css"), "utf8");
const sources = compiledCssDeclaredSources(styles);
const emitters = emitterFiles(packageRoot).map((file) => {
  const text = readFileSync(resolve(packageRoot, file), "utf8");
  const own = `${compiled}\n${text}`;
  return { file, text, own, reads: emitterReads(text, sources, own), computed: emitterComputedFallbacks(text, sources, own) };
});
const lineOf = (text: string, offset: number): number => text.slice(0, offset).split("\n").length;
const all = emitters.flatMap((e) => e.reads.map((read) => ({ ...read, at: `${e.file}:${lineOf(e.text, read.offset)} ${read.name}`, computed: e.computed.some((c) => c.start === read.offset) })));

describe("Designer emitter fallbacks equal their declared values (CONTAM-U9)", () => {
  it("scans the block, specimen, token-preview and component emitters", () => {
    for (const dir of ["src/blocks/", "src/specimen/", "src/tokens/preview/", "src/components/"]) expect(emitters.some((e) => e.file.startsWith(dir) && e.reads.length > 0), dir).toBe(true);
  });

  it("scans the hand-written and partner component sources, and not the generated preview runtime (D5-2C)", () => {
    const components = [
      "src/components/ColorPicker.tsx",
      "src/components/NativeAction.tsx",
      "src/components/NumberField.tsx",
      "src/components/SearchField.tsx",
      "src/components/Tree.tsx",
      "src/components/button-classes.ts",
      "src/components/partners/kibo-ui/video-player.tsx",
      "src/components/partners/shadcn/sonner.tsx",
      "src/components/rich-text/schema.ts",
      "src/components/rich-text/styles.ts",
      "src/components/scroll-area/scroll-area.tsx",
      "src/components/toggle-button/toggle.tsx",
      "src/components/toggle-group/toggle-group.tsx",
    ];
    for (const file of components) expect(emitters.find((e) => e.file === file)?.reads.length ?? 0, file).toBeGreaterThan(0);
    expect(emitters.filter((e) => e.file.startsWith("src/components/preview-runtime/")).map((e) => e.file)).toEqual([]);
  });

  it("has no bare read", () => {
    expect(all.length).toBeGreaterThan(0);
    expect(all.filter((read) => read.fallback === null).map((read) => read.at)).toEqual([]);
  });

  it("has no bare read whose name is computed by code", () => {
    const interpolated = emitters.flatMap((e) => emitterInterpolatedReads(e.text).map((read) => ({ ...read, at: `${e.file}:${lineOf(e.text, read.offset)} ${read.text}` })));
    expect(interpolated.length).toBeGreaterThan(0);
    expect(interpolated.filter((read) => !read.hasFallback).map((read) => read.at)).toEqual([]);
  });

  it("pins every --color-* registry value to its declared value, for reads whose name is computed by code", () => {
    // StillBackdrop paints art with `var(${token}, ${TOKENS[token]!.value})`; consumer art may name any registered --color-* key.
    const keys = Object.keys(TOKENS).filter((key) => key.startsWith("--color-"));
    expect(keys.length).toBeGreaterThan(0);
    const reads = classifyFallbackReads(keys.map((key) => `var(${key})`).join("\n"), sources, compiled);
    expect(reads.map((read) => read.name)).toEqual(keys);
    expect(reads.filter((read) => read.kind !== "global" || TOKENS[read.name]!.value !== read.expected).map((read) => `${read.name} (${read.kind}): ${TOKENS[read.name]!.value} != ${read.expected}`)).toEqual([]);
  });

  it("gives every read of a global token, and every --tw-* read, its declared value as fallback", () => {
    const judged = all.filter((read) => !read.computed && (read.kind === "global" || read.kind === "tw-property"));
    expect(judged.length).toBeGreaterThan(0);
    expect(judged.filter((read) => read.fallback !== read.expected).map((read) => `${read.at}: ${read.fallback} != ${read.expected}`)).toEqual([]);
  });

  it("reads a computed fallback from the token registry, and the registry value equals the declared value", () => {
    const computed = emitters.flatMap((e) => e.computed.map((c) => ({ ...c, at: `${e.file}:${lineOf(e.text, c.start)} ${c.read.name}` })));
    expect(computed.length).toBeGreaterThan(0);
    for (const c of computed) {
      expect(c.registryKey, c.at).toBe(c.read.name);
      expect(c.read.kind, c.at).toBe("global");
      expect(TOKENS[c.registryKey as keyof typeof TOKENS]?.value, c.at).toBe(c.read.expected);
    }
  });

  it("lists runtime and scoped reads by name, each with no global declared value", () => {
    const global = globalDeclaredTokenValues(sources, compiled);
    const listed = all.filter((read) => read.kind !== "global" && read.kind !== "tw-property");
    for (const read of listed) {
      expect(global.has(read.name), read.at).toBe(false);
      expect(["runtime", "scoped"], read.at).toContain(read.kind);
      if (read.kind === "runtime") {
        expect(sources.runtimeSetVariables.has(read.name), read.at).toBe(true);
        expect(read.fallback, read.at).toBe("unset");
      }
    }
    // Printed so a reviewer reads the names the equality rule does not reach.
    console.info(`Designer emitter reads with no global declared value: ${[...new Set(listed.map((read) => `${read.name} (${read.kind})`))].sort().join(", ") || "none"}`);
  });

  it("is a fixed point of the aligner (node scripts/align-emitter-fallbacks.mjs)", () => {
    expect(emitters.filter((e) => alignEmitterText(e.text, sources, compiled) !== e.text).map((e) => e.file)).toEqual([]);
  }, 120_000); // Aligns every emitter once; the reader parses the stylesheet on each call.
});

describe("the emitter aligner", () => {
  const fixture: DeclaredSources = {
    tokensCss: ":root { --a: 4px; --b: var(--a, 4px); --c: 1px 2px; }",
    themeCss: "",
    defaultThemeCss: "",
    tailwindThemeCss: "",
    runtimeSetVariables: new Set(["--r"]),
  };

  // Only the runtime and refusal cases need a bare read as input; the others start from a wrong fallback.
  it("writes declared values into style strings, and spells arbitrary values in Tailwind form", () => {
    expect(alignEmitterText(`const s = { pad: "calc(var(--b, 0px) * 2)", gap: "var(--a, 9px)" }; const k = "min-w-[var(--c,0px)] p-sm";`, fixture, ""))
      .toBe(`const s = { pad: "calc(var(--b, var(--a, 4px)) * 2)", gap: "var(--a, 4px)" }; const k = "min-w-[var(--c,1px_2px)] p-sm";`);
  });

  it("gives a bare runtime-only read unset", () => {
    expect(alignEmitterText(`const s = { "--r": v, font: "var(--r)" };`, fixture, "")).toBe(`const s = { "--r": v, font: "var(--r, unset)" };`);
  });

  it("leaves a computed fallback and a line comment as written", () => {
    const text = 'const a = `var(--a, ${TOKENS["--a"]!.value})`;\nconst b = "var(--a, " + TOKENS["--a"]!.value + ")";\n  // reads var(--a, 9px)\n';
    expect(alignEmitterText(text, fixture, "")).toBe(text);
    expect(emitterComputedFallbacks(text, fixture, "").map((c) => [c.read.name, c.registryKey, text.slice(c.start, c.end)]))
      .toEqual([["--a", "--a", 'var(--a, ${TOKENS["--a"]!.value})'], ["--a", "--a", 'var(--a, " + TOKENS["--a"]!.value + ")']]);
  });

  it("lists reads whose name is computed by code, and whether each writes a fallback", () => {
    const text = [
      "const a = `var(${t})`;",
      "const b = `var(${TOKENS[t]!.name}, ${TOKENS[t]!.value})`;",
      'const c = "var(" + t + ")";',
      'const d = "var(" + t + ", " + v + ")";',
      "const e = `var(--a, 4px)`;",
      "  // reads `var(${t})`",
    ].join("\n");
    expect(emitterInterpolatedReads(text).map((read) => [read.text, read.hasFallback])).toEqual([
      ["var(${t})", false],
      ["var(${TOKENS[t]!.name},", true],
      ['var(" + t + ")', false],
      ['var(" + t + ",', true],
    ]);
  });

  it("refuses a bare read with no declaration and no setter, naming it", () => {
    const undeclared = `const s = { width: "var(--nowhere)" };`;
    expect(() => alignEmitterText(undeclared, fixture, "")).toThrow(UndeclaredTokenFallbackError);
    expect(() => alignEmitterText(undeclared, fixture, "")).toThrow(/--nowhere/);
  });
});
