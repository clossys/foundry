/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import { generate, walk } from "css-tree";
import * as catalog from "./index.js";
import { runDogfood } from "./dogfood.js";
import { parseTokenCss } from "./token-css-syntax.js";
import type { EngineInput } from "./resolve.js";

/** Synthetic scanner fixture, using actual selected catalog names and materializer. */
const shadow = (value: string) => ({ $type: "shadow", $value: value, $extensions: { "com.clossys.css": { raw: value } } });
function selected(): EngineInput {
  const data = catalog.loadCatalog();
  const empty: catalog.LibraryData = { source: { id: "example", kind: "consumer", author: "consumer", license: "UNLICENSED" }, adoptedAt: "2026-10-25", fills: [] };
  const library = catalog.applyLibraryChange(data, empty, { baseHash: catalog.libraryHash(empty), changes: [{ op: "author", slot: "themes.shadow", tokens: {
    "2xs": shadow("0 1px #000"),
    xs: shadow("0 1px 1px #000"),
    sm: shadow("0 1px 2px #000"),
    md: { $type: "shadow", $value: "{themes.shadow.sm}" },
    lg: shadow("0 10px 15px #000"),
    xl: shadow("0 20px 25px #000"),
    "2xl": shadow("0 25px 50px #000"),
  } }] });
  return { catalog: data, library };
}
const root = (value = "0 1px 2px #000", property = "--shadow-sm") => `:root { ${property}: ${value}; }`;
function scan(css: string, extra: { file: string; content: string }[] = [], tokenLibrary: EngineInput | null = selected()) {
  return runDogfood({ files: [{ file: "Page.tsx", content: 'import { PageHeaderModule } from "@clossys/designer/shell"; const Page=()=> <PageHeaderModule id="example" header={data}/>' }, { file: "tokens.css", content: css }, ...extra],
    consumerBoundary: { pages: ["Page.tsx"], sourceImports: {} }, ...(tokenLibrary ? { tokenLibrary } : {}) });
}
describe("selected token definition source contract", () => {
  it("exports expected manifest values from the same canonical materializer", () => {
    const engine = selected();
    expect(catalog.check(engine).ok).toBe(true);
    const profile = catalog.resolve(engine);
    const manifest = catalog.emittedTokenManifest(profile, ["css-scales", "tailwind-theme"]);
    expect(manifest.consumer).toBe(profile.consumer);
    expect(manifest.selectionHash).toBe(profile.selectionHash);
    expect(manifest.tokens.find(row => row.id === "themes.shadow.2xl")).toMatchObject({ outputs: ["--shadow-2xl"], values: { light: "0 25px 50px #000", dark: "0 25px 50px #000" } });
    expect(manifest.definitions.find(row => row.property === "--shadow-sm" && row.target === "css-scales")).toMatchObject({ id: "themes.shadow.sm", value: "0 1px 2px #000", theme: "light", selector: ":root", atRules: [] });
    const files = catalog.emit(profile, ["css-scales", "tailwind-theme"], { header: false });
    for (const row of manifest.definitions) expect(files.find(file => file.path === (row.target === "css-scales" ? "scales.css" : "theme.css"))!.contents).toContain(`${row.property}: ${row.value};`);
    expect(manifest.definitions.find(row => row.property === "--shadow-md")!.value).toBe("var(--shadow-sm, 0 1px 2px #000)");
  });
  it("accepts only selected canonical declarations and ordinary token consumption", () => {
    expect(scan(root() + " .component { box-shadow: var(--shadow-sm); }").findings).toEqual([]);
    const profile = catalog.resolve(selected());
    const css = catalog.emit(profile, ["css-scales"], { header: false, full: true })[0]!.contents;
    expect(scan(css).findings).toEqual([]); // media-dark and explicit-dark are distinct contexts
    expect(scan(root("var(--shadow-sm, 0 1px 2px #000)", "--shadow-md")).findings).toEqual([]);
  });
  it("rejects an unregistered name even when its value is valid", () => {
    expect(scan(root("0 1px 2px #000", "--unknown")).findings).toEqual(expect.arrayContaining([expect.objectContaining({ code: "DF2", evidence: expect.stringContaining("Unregistered") })]));
  });
  it("rejects a registered name with the wrong value", () => {
    expect(scan(root("0 1px 3px #000")).findings).toEqual(expect.arrayContaining([expect.objectContaining({ code: "DF2", evidence: expect.stringContaining("value mismatch") })]));
  });
  it("rejects duplicate correct definitions in one file and across files", () => {
    for (const report of [scan(root() + root()), scan(root(), [{ file: "copied.css", content: root() }])])
      expect(report.findings).toEqual(expect.arrayContaining([expect.objectContaining({ code: "DF2", evidence: expect.stringContaining("Duplicate") })]));
  });
  it.each([".component", ":root, .component", ".component { :root", ":root[data-preview]"])("rejects component or undeclared context %s", selector => {
    const css = `${selector} { --shadow-sm: 0 1px 2px #000; }${selector.includes("{") ? " }" : ""}`;
    expect(scan(css).findings.some(row => row.code === "DF2")).toBe(true);
  });
  it("rejects alias to an unregistered variable even with a matching fallback", () => {
    expect(scan(root("var(--unknown, 0 1px 2px #000)", "--shadow-md")).findings).toEqual(expect.arrayContaining([expect.objectContaining({ code: "DF2", evidence: expect.stringContaining("Unregistered alias") })]));
  });
  it("keeps generated-looking ordinary-property literals failing", () => {
    expect(scan("/* Generated library output */ .component { padding:4px; }").findings).toEqual(expect.arrayContaining([expect.objectContaining({ code: "DF2", evidence: expect.stringContaining("4px") })]));
  });
  it("accepts only materializer-declared theme rows with selected values", () => {
    const profile = catalog.resolve(selected());
    const css = catalog.emit(profile, ["tailwind-theme"], { header: false })[0]!.contents;
    expect(scan(css).findings).toEqual([]);
    expect(scan("@theme { --shadow-sm: 0 1px 3px #000; }").findings.some(row => row.code === "DF2" && row.evidence.includes("value mismatch"))).toBe(true);
    const other = selected(); other.library.fills = [];
    expect(scan(css, [], other).findings.some(row => row.code === "DF2")).toBe(true);
    expect(scan(css, [], null).findings.some(row => row.code === "DF2")).toBe(true);
    expect(scan(css, [{ file: "copy.css", content: css }]).findings.some(row => row.evidence.includes("Duplicate"))).toBe(true);
  });
  it("rejects nested rule stacks inside materializer-declared theme context", () => {
    for (const css of ["@theme { .component { :root { --shadow-sm:0 1px 2px #000; } } }", "@theme { .component { .child { :root { --shadow-sm:0 1px 2px #000; } } } }"])
      expect(scan(css).findings).toEqual(expect.arrayContaining([expect.objectContaining({ code: "DF2", evidence: expect.stringContaining("outside declared theme context") })]));
  });
  it("parses theme declarations before and after nested keyframes without dropping source", () => {
    const ast = parseTokenCss(`@layer theme { @theme default {
      --animate-spin: spin 1s linear infinite;
      @keyframes spin { 0%, 100% { transform: rotate(360deg); } }
      --blur-xs: 4px;
    } }`);
    const declarations: { property: string; value: string }[] = [];
    const atRules: { name: string; prelude: string }[] = [];
    walk(ast, node => {
      if (node.type === "Declaration") declarations.push({ property: node.property, value: generate(node.value) });
      if (node.type === "Atrule") atRules.push({ name: node.name, prelude: node.prelude ? generate(node.prelude) : "" });
    });
    expect(atRules).toEqual([{ name: "layer", prelude: "theme" }, { name: "theme", prelude: "default" }, { name: "keyframes", prelude: "spin" }]);
    expect(declarations).toEqual([
      { property: "--animate-spin", value: "spin 1s linear infinite" },
      { property: "transform", value: "rotate(360deg)" },
      { property: "--blur-xs", value: "4px" },
    ]);
  });
  it("keeps keyframe literals visible inside mixed themes", () => {
    const report = scan("@theme { --shadow-sm:0 1px 2px #000; @keyframes spin { to { padding:4px; } } }");
    expect(report.findings).toEqual(expect.arrayContaining([expect.objectContaining({ code: "DF2", evidence: expect.stringContaining("4px") })]));
    expect(report.findings.some(row => row.evidence.includes("Unresolved CSS"))).toBe(false);
  });
  it.each([
    "@theme default { --shadow-sm:0 1px 2px #000; @keyframes spin { to { display:block; } } }",
    "@theme inline { --shadow-sm:0 1px 2px #000; @keyframes spin { to { display:block; } } }",
    "@layer theme { @theme { --shadow-sm:0 1px 2px #000; @keyframes spin { to { display:block; } } } }",
  ])("does not grant mixed theme syntax token-definition authority: %s", css => {
    const report = scan(css);
    expect(report.findings).toEqual(expect.arrayContaining([expect.objectContaining({ code: "DF2", evidence: expect.stringContaining("outside declared theme context") })]));
    expect(report.findings.some(row => row.evidence.includes("Unresolved CSS"))).toBe(false);
  });
  it.each([
    "@theme { --shadow-sm:0 1px 2px #000; broken; @keyframes spin { to { display:block; } } }",
    "@theme { --shadow-sm:0 1px 2px #000; @keyframes spin { to { broken; } } }",
    "@theme { --shadow-sm:0 1px 2px #000; :root { broken; } }",
    "@unknown { --shadow-sm:0 1px 2px #000; @keyframes spin { to { display:block; } } }",
  ])("keeps malformed or unknown mixed theme syntax fail-closed: %s", css => {
    expect(() => parseTokenCss(css)).toThrow("Unsupported raw CSS syntax");
    expect(scan(css).findings).toEqual(expect.arrayContaining([expect.objectContaining({ code: "DF2", evidence: expect.stringContaining("Unresolved CSS") })]));
  });
  it("parses mixed utility declarations and nested conditions without hiding literals", () => {
    expect(scan("@utility marker { list-style:none; &::-webkit-details-marker { display:none; } }").findings).toEqual([]);
    expect(scan("@utility marker { @supports not ((display:grid) or (display:flex)) { &::before { display:block; } } }").findings).toEqual([]);
    const report = scan("@utility marker { padding:4px; @media (width > 10px) { &:hover { padding:8px; } } }");
    expect(report.findings.filter(row => row.code === "DF2")).toHaveLength(2);
    expect(report.findings.some(row => row.evidence.includes("Unresolved"))).toBe(false);
  });
  it("parses non-leading nesting with native grammar alternatives without minting definitions", () => {
    expect(scan('@utility marker { :root[data-theme="dark"] & { display:block; } @media (prefers-color-scheme:dark) { :root:not([data-theme="light"]) & { display:block; } } }').findings).toEqual([]);
    expect(scan('@utility marker { :root[data-theme="dark"] & { padding:4px; } }').findings).toEqual(expect.arrayContaining([expect.objectContaining({ code: "DF2", evidence: expect.stringContaining("4px") })]));
    expect(scan('@utility marker { :root[data-theme="dark"] & { --shadow-sm:0 1px 2px #000; } }').findings).toEqual(expect.arrayContaining([expect.objectContaining({ code: "DF2", evidence: expect.stringContaining("outside declared theme context") })]));
  });
  it("keeps malformed nested declarations fail-closed", () => {
    for (const css of ['@utility marker { broken; }', '@utility marker { :root[data-theme="dark"] & { broken; } }'])
      expect(scan(css).findings).toEqual(expect.arrayContaining([expect.objectContaining({ code: "DF2", evidence: expect.stringContaining("Unresolved CSS") })]));
  });
  it.each(["@theme inline { --shadow-sm: 0 1px 2px #000; }", "@theme { --unknown: 0 1px 2px #000; }", "@layer tokens { :root { --shadow-sm: 0 1px 2px #000; } }", "@utility token { :root { --shadow-sm: 0 1px 2px #000; } }"])("does not mint definitions through %s", css => {
    expect(scan(css).findings.some(row => row.code === "DF2")).toBe(true);
  });
  it("forbids inline style custom properties and keeps missing authority unresolved", () => {
    expect(scan("", [{ file: "Inline.tsx", content: 'const Inline=()=> <div style={{"--shadow-sm":"0 1px 2px #000"}} />' }]).findings.some(row => row.code === "DF2" && row.evidence.includes("inline styles"))).toBe(true);
    expect(scan(root(), [], null).findings.some(row => row.code === "DF2")).toBe(true);
    const source = selected(); source.library.fills = [];
    expect(scan(root(), [], source).findings.some(row => row.code === "DF2")).toBe(true);
  });
  it("refuses malformed CSS, !important, and altered activation contexts", () => {
    for (const css of [":root { --shadow-sm: 0 1px 2px #000 !important; }", ":root { broken }", "@media print { :root { --shadow-sm: 0 1px 2px #000; } }"])
      expect(scan(css).findings.some(row => row.code === "DF2")).toBe(true);
  });
});
