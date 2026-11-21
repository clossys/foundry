// @vitest-environment node
import { describe, expect, it } from "vitest";
import { SHADCN_THEME_INLINE } from "./theme.js";
import { SPECIMEN_CHROME_CSS } from "./chrome.js";

/**
 * CONTAM-U7 (planner decision D5 A = a, B = a, C = a): every `var(--x)` Publisher's CSS emitters
 * write carries a fallback read by Designer's declared-fallback reader, never typed by hand. Where
 * `--x` has a global declared value the fallback equals it, expanded; a read of a variable that is
 * scoped to the emitted stylesheet or set inline by Publisher's own sources has no global value to
 * equal, so it is listed by name. `node scripts/align-specimen-fallbacks.mjs` writes the emitters.
 */
const script = "../../scripts/align-specimen-fallbacks.mjs";
const { alignEmitters, alignText, loadReader } = await import(/* @vite-ignore */ script);
const reader = await loadReader();
const emitters: { file: string; current: string; expected: string }[] = await alignEmitters(reader);
type Read = { name: string; fallback: string | null; kind: string; expected?: string; offset: number };
const readsOf = (text: string): Read[] => reader.classifyFallbackReads(text, reader.sources, `${reader.outputCss}\n${text}`);
const lineOf = (text: string, offset: number): number => text.slice(0, offset).split("\n").length;
/** A Tailwind arbitrary value spells a space as `_`; compare the value it stands for. */
const unspell = (fallback: string): string => fallback.replace(/_/g, " ");

describe("Publisher CSS emitters write declared fallbacks (CONTAM-U7)", () => {
  it("covers every emitter, each a fixed point of the aligner", () => {
    expect(emitters).toHaveLength(9);
    for (const e of emitters) expect(e.current, e.file).toBe(e.expected);
  });

  it("has no bare read in any emitter source", () => {
    const bare = emitters.flatMap((e) => readsOf(e.current).filter((r) => r.fallback === null).map((r) => `${e.file}:${lineOf(e.current, r.offset)} ${r.name}`));
    expect(bare).toEqual([]);
  });

  it("gives every read of a global token its declared value as fallback", () => {
    let judged = 0;
    const wrong: string[] = [];
    for (const e of emitters) {
      for (const r of readsOf(e.current)) {
        if (r.kind !== "global" && r.kind !== "tw-property") continue;
        judged++;
        if (r.fallback === null || unspell(r.fallback) !== r.expected) wrong.push(`${e.file}:${lineOf(e.current, r.offset)} ${r.name}: ${r.fallback} != ${r.expected}`);
      }
    }
    expect(judged).toBe(100);
    expect(wrong).toEqual([]);
  });

  it("lists scoped and inline-set reads by name, each found by code", () => {
    const listed = new Map<string, string>();
    for (const e of emitters) {
      for (const r of readsOf(e.current)) {
        if (r.kind === "global" || r.kind === "tw-property") continue;
        const at = `${e.file}:${lineOf(e.current, r.offset)} ${r.name}`;
        expect(["scoped", "runtime", "undeclared"], at).toContain(r.kind);
        if (r.kind === "runtime") {
          expect(reader.sources.runtimeSetVariables.has(r.name), at).toBe(true);
          expect(r.fallback, at).toBe("unset");
        }
        if (r.kind === "undeclared") expect(r.fallback, at).not.toBeNull();
        listed.set(r.name, r.kind);
      }
    }
    expect(Object.fromEntries([...listed].sort())).toEqual({
      "--gap": "scoped",
      "--shiny-width": "scoped",
      "--specimen-ink": "runtime",
      "--specimen-max-lines": "runtime",
      "--specimen-tile": "runtime",
      "--specimen-width": "undeclared",
    });
  });

  it("takes a scoped read's fallback from its declaration in the same stylesheet", () => {
    expect(SPECIMEN_CHROME_CSS).toContain("--gap: 12px;");
    expect(SPECIMEN_CHROME_CSS).toContain("gap: var(--gap, 12px);");
    expect(SPECIMEN_CHROME_CSS).toContain("--shiny-width: 100px;");
    expect(SPECIMEN_CHROME_CSS).toContain("var(--shiny-width, 100px)");
  });

  it("emits no bare read in the stylesheets it ships", () => {
    for (const css of [SHADCN_THEME_INLINE, SPECIMEN_CHROME_CSS]) expect(readsOf(css).filter((r) => r.fallback === null).map((r) => r.name)).toEqual([]);
  });

  it("spells an arbitrary class value in Tailwind form", () => {
    expect(alignText('<div className="grid-cols-[var(--ui-layout-sidebar-w)_1fr]" />', reader)).toBe('<div className="grid-cols-[var(--ui-layout-sidebar-w,256px)_1fr]" />');
  });
});

describe("the emitter judge", () => {
  const chrome = emitters.find((e) => e.file === "src/specimen/chrome.ts")!;
  const target = readsOf(chrome.current).find((r) => r.kind === "global" && r.fallback !== null && !r.fallback.includes("var("))!;
  const end = chrome.current.indexOf(")", target.offset) + 1;

  it("catches a stripped fallback", () => {
    const mutant = `${chrome.current.slice(0, target.offset)}var(${target.name})${chrome.current.slice(end)}`;
    expect(readsOf(mutant).some((r) => r.fallback === null)).toBe(true);
    expect(alignText(mutant, reader)).not.toBe(mutant);
  });

  it("catches a fallback that differs from the declared value", () => {
    const mutant = `${chrome.current.slice(0, target.offset)}var(${target.name}, 1px)${chrome.current.slice(end)}`;
    expect(alignText(mutant, reader)).not.toBe(mutant);
  });
});
