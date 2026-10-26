// @vitest-environment node
import { readFileSync } from "node:fs";
import { BLOCK_ENTRIES } from "../catalog/blocks.js";
import components from "../catalog/slots/components.json" with { type: "json" };
import aliases from "../catalog/aliases/components.json" with { type: "json" };
import { describe, expect, it } from "vitest";
import { runDogfood, dogfoodComposes, elementHash, type DogfoodInput } from "./dogfood.js";
const input = (content: string): DogfoodInput => ({ files: [{ file: "src/Page.tsx", content }],
  tokens: [{ id: "tokens.ink", contract: { emit: { primary: "--color-ink" } } }], themeCss: "@theme { --color-ink: var(--color-ink); }" });

describe("derived surface dogfood", () => {
  it("distinguishes TypeScript type arguments, casts and comparisons from JSX", () => {
    const source = 'const value = (contract as unknown as Record<string, unknown>)[name]; const result = identity<string>(name); type Box<T> = Record<string, T>; const compare = left<right; const generic = <T,>(value: T) => value;';
    const report = runDogfood(input(source));
    expect(report.findings).toEqual([]);
    expect(report.scanned[0]?.elements).toBe(0);
  });
  it("still scans return, arrow, ternary, array and fragment JSX expression positions", () => {
    const source = 'function one() { return <button/>; } const two = () => <input/>; const three = yes ? <select/> : <textarea/>; const four = [<button/>, <><button/></>];';
    const report = runDogfood(input(source));
    expect(report.scanned[0]?.elements).toBe(6);
    expect(report.findings.map(row => row.code)).toEqual(["DF1", "DF1", "DF1", "DF1", "DF1", "DF1"]);
  });
  it("derives exactly DF1 DF2 DF3 DF4 and allows an unstyled structural div", () => {
    const result = runDogfood(input('import { Button } from "@clossys/designer/components"; export function Page() { return <div><button>Go</button><span style={{width:"22rem"}}/><svg/><Button className="text-ink">Hello</Button></div>; }'));
    expect(result.findings.map(row => row.code).sort()).toEqual(["DF1", "DF2", "DF3", "DF4"]);
    expect(result.structural.div).toBe(1); expect(result.ok).toBe(false);
  });
  it("keeps the structural rule observable (named mutation removes div)", () => {
    expect(runDogfood(input("const Page = () => <div />")).findings).toEqual([]);
    expect(runDogfood(input("const Page = () => <div />")).structural.div).toBe(1);
  });
  it("parses nesting, expressions and quoted delimiters without scanning comments or string lookalikes", () => {
    const source = `// <button />\nconst fake = "<button />"; const re = /<button \\/>/; function regex() { return /<button \\/>/; }\nconst Page = () => <div title=">">{ok ? <button title={"}"}>Go</button> : <span/>}{/* <svg/> */}</div>`;
    const result = runDogfood(input(source));
    expect(result.scanned[0]?.elements).toBe(3); expect(result.findings.map(row => row.code)).toEqual(["DF1"]);
  });
  it("resolves registered import aliases and rejects lookalike third-party or local widgets", () => {
    const source = 'import { Button as Action } from "@clossys/designer/components"; import * as UI from "@clossys/designer/components"; import { Button as Fake } from "foreign-ui"; import Local from "./Widget.js"; import Default from "@clossys/designer/components"; const Page = () => <div><Action/><UI.Button/><Fake/><Local/><Default/></div>';
    const result = runDogfood(input(source));
    expect(result.findings.filter(row => row.code === "DF5").map(row => row.tag)).toEqual(["Fake", "Local", "Default"]);
    expect(result.summary.library).toBe(2);
  });
  it("resolves exact registered server exports with named and namespace aliases", () => {
    const source = 'import { Card as Plate } from "@clossys/designer/components/server"; import * as Blocks from "@clossys/designer/blocks/server"; import { Item as Row } from "@clossys/designer/blocks/server"; const Page=()=> <Plate><Blocks.Items/><Row/></Plate>';
    const fixture = input(source);
    expect(runDogfood(fixture).findings).toEqual([]);
    expect(dogfoodComposes(fixture)).toEqual([
      expect.objectContaining({ tag: "Plate", module: "@clossys/designer/components/server", symbol: "Card", slotId: "components.card" }),
      expect.objectContaining({ tag: "Blocks.Items", module: "@clossys/designer/blocks/server", symbol: "Items", slotId: "items.raw" }),
      expect.objectContaining({ tag: "Row", module: "@clossys/designer/blocks/server", symbol: "Item", slotId: "items.item" }),
    ]);
  });
  it.each([
    ["@clossys/designer/components/server/internal", "Card"],
    ["@clossys/designer/components/server-extra", "Card"],
    ["@clossys/designer/blocks/server/internal", "Item"],
    ["@clossys/designer/blocks/server-extra", "Items"],
    ["foreign-ui/components/server", "Card"],
    ["@clossys/designer/shell/server", "Card"],
  ])("refuses server-like module %s instead of trusting a prefix", (module, symbol) => {
    const report = runDogfood(input(`import { ${symbol} } from "${module}"; const Page=()=> <${symbol}/>`));
    expect(report.findings).toEqual([expect.objectContaining({ code: "DF5", tag: symbol })]);
  });
  it("accepts only registered symbols actually exported by each public server barrel", () => {
    const pascal = (id: string) => id.split(".").at(-1)!.split("-").map(part => part[0]!.toUpperCase() + part.slice(1)).join("");
    const componentSymbols = [...components.map(row => pascal(row.id)), ...aliases.map(row => pascal(row.id)), "Breadcrumb"];
    const blockSymbols = BLOCK_ENTRIES.flatMap(row => row.export ? [row.export] : []);
    const candidates = [...new Set([...componentSymbols, ...blockSymbols])].sort();
    for (const [family, registered] of [["components", componentSymbols], ["blocks", blockSymbols]] as const) {
      const barrel = readFileSync(new URL(`../${family}/server.ts`, import.meta.url), "utf8");
      expect(barrel).not.toMatch(/^export\s*\*/m);
      const exported = new Set([...barrel.matchAll(/^export\s*\{([^}]+)\}\s*from/gm)].flatMap(match => match[1]!.split(",").map(value => value.trim().split(/\s+as\s+/).at(-1)!)));
      const source = candidates.map((symbol, index) => `import { ${symbol} as Symbol${index} } from "@clossys/designer/${family}/server";`).join("\n") + `\nconst Page=()=> <>${candidates.map((_, index) => `<Symbol${index}/>`).join("")}</>`;
      expect(dogfoodComposes(input(source)).map(row => row.symbol).sort()).toEqual(candidates.filter(symbol => exported.has(symbol) && registered.includes(symbol)));
    }
  });
  it.each([
    ["components", "Button"], ["components", "Item"], ["blocks", "Card"], ["blocks", "Button"],
  ])("rejects non-exported or wrong-family %s/server#%s", (family, symbol) => {
    const source = `import { ${symbol} as Fake } from "@clossys/designer/${family}/server"; const Page=()=> <Fake/>`;
    expect(runDogfood(input(source)).findings).toEqual([expect.objectContaining({ code: "DF5", tag: "Fake" })]);
  });
  it.each([["components", "Card"], ["blocks", "Item"], ["blocks", "Items"]])("rejects invented named and namespace members of %s/server#%s", (family, symbol) => {
    const source = `import { ${symbol} as Plate } from "@clossys/designer/${family}/server"; import * as Server from "@clossys/designer/${family}/server"; const Page=()=> <><Plate/><Server.${symbol}/><Plate.NotAnExport/><Server.${symbol}.NotAnExport/></>`;
    const fixture = input(source);
    expect(runDogfood(fixture).findings.map(row => [row.code, row.tag])).toEqual([["DF5", "Plate.NotAnExport"], ["DF5", `Server.${symbol}.NotAnExport`]]);
    expect(dogfoodComposes(fixture).map(row => row.tag)).toEqual(["Plate", `Server.${symbol}`]);
  });
  it("retains fake, default and local server lookalike rejection", () => {
    const source = 'import { NotRegistered as Card } from "@clossys/designer/components/server"; import Default from "@clossys/designer/blocks/server"; import { Fragment } from "react"; function Helper(){return null}; const Page=()=> <><Card/><Default/><Helper/><Fragment/></>';
    expect(runDogfood(input(source)).findings.map(row => [row.code, row.tag])).toEqual([["DF5", "Card"], ["DF5", "Default"], ["DF5", "Helper"], ["DF5", "Fragment"]]);
  });
  it("keeps source-runner identity and authored compose contracts authoritative for server exports", () => {
    const fixture = input('import { Card } from "@clossys/designer/components/server"; const Page=()=> <Card/>');
    expect(runDogfood({ ...fixture, resolvedImports: {} }).findings).toEqual([expect.objectContaining({ code: "DF5", tag: "Card" })]);
    expect(runDogfood({ ...fixture, contracts: { "src/Page.tsx": { id: "authored", allowedReads: {}, allowedComposes: [] } } }).findings).toEqual([expect.objectContaining({ code: "DF4", evidence: "missing-declared-compose: components.card" })]);
  });
  it("scans raw controls and inline colors inside registered server exports", () => {
    const fixture = input('import { Card } from "@clossys/designer/components/server"; const Page=()=> <Card><button>Publish</button><span style={{color:"#123456"}}/></Card>');
    const report = runDogfood(fixture);
    expect(report.findings).toEqual(expect.arrayContaining([expect.objectContaining({ code: "DF1", tag: "button" }), expect.objectContaining({ code: "DF2", tag: "span" })]));
    expect(report.findings.filter(row => row.code === "DF5")).toEqual([]);
  });
  it("reports unresolved attributes, spreads and malformed JSX explicitly", () => {
    for (const source of ['const Page=()=> <div style={styles}/>', 'const Page=()=> <div className={classes}/>', 'const Page=()=> <div className={"foo" + value + "bar"}/>', 'const Page=()=> <div style={{width:`${size}`}}/>', 'const Page=()=> <div {...props}/>', 'const Page=()=> <div><span></div>']) {
      const result = runDogfood(input(source)); expect(result.ok).toBe(false); expect(result.findings.some(row => row.evidence.includes("unresolved"))).toBe(true);
    }
  });
  it("uses identical value shapes and explicit same-line ignore markers", () => {
    expect(runDogfood(input('const Page=()=> <div className="w-[22rem]"/>')).findings.some(row => row.code === "DF2")).toBe(true);
    const ignored = runDogfood(input('const Page=()=> <div style={{width:"22rem"}}/>; // token-gate:ignore fixture'));
    expect(ignored.ignored).toHaveLength(1); expect(ignored.findings).toEqual([]);
  });
  it("does not accept fake ignore comments in strings or visual structural classes as bare wrappers", () => {
    const source = 'const Page=()=> <div title="// token-gate:ignore fake" style={{width:"22rem"}}/>';
    expect(runDogfood(input(source)).findings.some(row => row.code === "DF2")).toBe(true);
    expect(runDogfood(input('const Page=()=> <div className="bg-red-500"/>')).ok).toBe(false);
    expect(runDogfood(input('const Page=()=> <div className="text-ink"/>')).findings.some(row => row.code === "DF1")).toBe(true);
  });
  it("pins exception content, expiry and presence; expired or missing exceptions are DF6", () => {
    const source = 'const Page=()=> <button />', report = runDogfood(input(source)), finding = report.findings[0]!;
    const exception = { name: "temporary-button", file: finding.file, elementId: finding.elementId, hash: elementHash("<button />"), reason: "fixture", owner: "owner", expiry: "2027-01-01" };
    expect(runDogfood({ ...input(source), exceptions: [exception], now: "2026-10-24" }).findings).toEqual([]);
    for (const change of [{ hash: "bad" }, { expiry: "2020-01-01" }, { file: "gone.tsx" }]) expect(runDogfood({ ...input(source), exceptions: [{ ...exception, ...change }], now: "2026-10-24" }).findings.some(row => row.code === "DF6")).toBe(true);
  });
  it("does not infer a parent from comments or strings that resemble capitalized declarations", () => {
    const source = '// function Fake() {}\nconst decoy="const Fake ="; const Page=()=> <button/>';
    expect(runDogfood(input(source)).findings[0]?.raisedBy).toBe("src/Page.tsx#surface");
  });
  it("keeps element identity when a source line moves and never mutates the input", () => {
    const source = "const Page=()=> <button />", fixture = input(source), snapshot = JSON.stringify(fixture);
    expect(runDogfood(input("\n" + source)).findings[0]?.elementId).toBe(runDogfood(fixture).findings[0]?.elementId);
    expect(JSON.stringify(fixture)).toBe(snapshot);
  });
});
