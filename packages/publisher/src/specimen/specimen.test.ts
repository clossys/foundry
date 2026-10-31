import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  adaptPreview, directoryRecordSource, parseSpecimenQuery, parseThemeParam, renderSpecimen, resolveFixtures,
  specimenKindOf, specimenReporterScript, specimenUrl, textCopy, themeCss, validSpecimenId, createSpecimenBuilder,
} from "./index.js";

const records = fileURLToPath(new URL("./__fixtures__/records/", import.meta.url));
const source = directoryRecordSource({ roots: [records], defaultTheme: "neutral" });

describe("specimen query", () => {
  it("accepts the four parameters and rejects bad values", () => {
    expect(parseSpecimenQuery(new URLSearchParams("element=sample-card&v=1&theme=neutral:dark&width=480")))
      .toEqual({ ok: true, query: { element: "sample-card", version: 1, theme: "neutral:dark", width: 480 } });
    for (const bad of ["element=../x", "element=a&v=0", "element=a&width=50", "element=a&width=9000", "element=a&theme=a;b"]) {
      expect(parseSpecimenQuery(new URLSearchParams(bad)).ok).toBe(false);
    }
    expect(specimenUrl("http://127.0.0.1:1/", { element: "a/b", version: 2, width: 320 })).toBe("http://127.0.0.1:1/__specimen?element=a%2Fb&v=2&width=320");
  });

  it("parses theme requests", () => {
    expect(parseThemeParam("light")).toEqual({ mode: "light" });
    expect(parseThemeParam("dark")).toEqual({ mode: "dark" });
    expect(parseThemeParam("neutral")).toEqual({ id: "neutral", mode: "light" });
    expect(parseThemeParam("neutral:dark")).toEqual({ id: "neutral", mode: "dark" });
    expect(validSpecimenId("slot/element")).toBe(true);
    expect(validSpecimenId("slot/../element")).toBe(false);
  });
});

describe("record adapter", () => {
  it("maps fuller-schema kinds onto specimen kinds", () => {
    expect(specimenKindOf({ kind: "component" })).toBe("visual");
    expect(specimenKindOf({ kind: "copy" })).toBe("text");
    expect(specimenKindOf({ kind: "table" })).toBe("data");
    expect(specimenKindOf({ kind: "logo" })).toBe("media");
    expect(specimenKindOf({ kind: "route" })).toBe("flow");
    expect(() => specimenKindOf({ id: "x", kind: "nope" })).toThrow(/unknown kind/);
  });

  it("tolerates nested container, defaults and limits", () => {
    expect(adaptPreview({ container: { kind: "page" }, defaults: { width: 640, theme: "t" }, props: { a: 1 }, copy: { k: { text: "x", limits: { maxChars: 4 } } } }))
      .toEqual({ container: "page", width: 640, theme: "t", fixtures: { a: 1 }, copy: { k: { text: "x", maxChars: 4 } } });
  });

  it("reads records by id and version, highest version by default", async () => {
    const card = await source.read("sample-card");
    expect(card).toMatchObject({ id: "sample-card", version: 1, kind: "visual", payload: { path: "sample-card.json" } });
    expect(card!.payload.files).toHaveLength(1);
    expect(card!.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(await source.read("sample-card", 2)).toBeUndefined();
    expect(await source.read("missing")).toBeUndefined();
    const hero = await source.read("hero-copy");
    expect(hero!.kind).toBe("text");
    expect(hero!.preview.copy!["hero.title"]).toEqual({ text: "Ship a calmer release, every week.", role: "display", maxChars: 48, maxLines: 2 });
  });

  it("reads the theme by shadcn var names", async () => {
    const theme = await source.theme();
    expect(theme!.light.primary).toBe("oklch(0.205 0 0)");
    const css = themeCss(theme);
    expect(css).toContain("--primary:oklch(0.205 0 0)");
    expect(css).toContain(".dark{");
    expect(css).not.toMatch(/tokens\./);
  });
});

describe("rendering", () => {
  it("resolves $copy fixtures", () => {
    expect(resolveFixtures({ a: { $copy: "k" }, b: [{ $copy: "z" }], c: 1 }, { k: { text: "hi" } })).toEqual({ a: "hi", b: ["[missing copy z]"], c: 1 });
  });

  it("falls back to markdown paragraphs for text copy", () => {
    const rows = textCopy({ id: "x", version: 1, kind: "text", preview: {}, contentHash: "", payload: { path: "x.md", files: [], raw: "---\na: b\n---\n# T\n\nOne\nline.\n\nTwo" } });
    expect(rows).toEqual([["paragraph-1", { text: "One line.", role: "body" }], ["paragraph-2", { text: "Two", role: "body" }]]);
  });

  it("renders text at its limits and marks overflow", async () => {
    const page = await renderSpecimen({ source, builder: createSpecimenBuilder(), query: { element: "hero-copy" }, nonce: "n" });
    expect(page.status).toBe(200);
    expect(page.html).toContain('data-copy-key="hero.title" data-role="display" data-chars="34" data-max-chars="48" data-max-lines="2"');
    expect(page.html).toContain('<script nonce="n">');
    expect(page.html).not.toContain("data-over");
  });

  it("renders stubs for data and a reported page for a missing record", async () => {
    const builder = createSpecimenBuilder();
    const table = await renderSpecimen({ source, builder, query: { element: "sample-table" }, nonce: "n" });
    expect(table.html).toContain('data-specimen-stub="data"');
    const missing = await renderSpecimen({ source, builder, query: { element: "nope" }, nonce: "n" });
    expect(missing.status).toBe(404);
    expect(missing.html).toContain("element nope not found");
  });

  it("escapes reporter config for inline script", () => {
    const script = specimenReporterScript({ element: "</script><x>", elementVersion: 1, kind: "visual", theme: "t", width: null, preErrors: [{ source: "build", message: " " }] });
    expect(script).not.toContain("</script>");
    expect(script).not.toContain(" ");
  });
});
