import { createHash } from "node:crypto";
import baseline from "./__fixtures__/instance-binding/layout-resolution.test.json" with { type: "json" };
import { existsSync, readFileSync } from "node:fs";
import { posix } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { checkLayoutRendererSource } from "./instance-binding.check.js";
import { LAYOUT_LEAVES, getEffectiveLayoutContract } from "../layouts/index.js";
import { instanceFixture } from "./__fixtures__/instance-binding/fixtures.js";
import type { BindingToken, LayoutRendererSource } from "./instance-binding.js";
import type { LayoutCompilerPort } from "./layout-source.js";

// Compiler enum aliases are not syntax kinds (e.g. FirstStatement aliases VariableStatement).
const kindNames = new Map(Object.entries(ts.SyntaxKind).filter(([key, value]) => typeof value === "number" && !/^(?:First|Last|Count)/.test(key)).map(([key, value]) => [value, key]));
const compiler: LayoutCompilerPort = {
  parseSourceFile: (file, source) => ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS),
  kind: value => kindNames.get((value as ts.Node).kind) ?? "Unknown",
  children: value => { const children: ts.Node[] = []; ts.forEachChild(value as ts.Node, child => { children.push(child); }); return children; },
};
const fixture = instanceFixture();
const contract = fixture.registries.layouts[0]!.contract;
const tokens: BindingToken[] = [
  ...["md", "lg", "xl"].map(value => ({ id: `themes.spacing.${value}` as const, property: `--spacing-${value}` })),
  ...["wide", "content", "prose", "form"].map(value => ({ id: `tokens.content-size.${value}` as const, property: `--ui-width-${value}-max` })),
  { id: "tokens.region-width.aside", property: "--ui-layout-aside-w" },
  ...["mobile", "tablet", "tablet-lg", "desktop"].map(value => ({ id: `tokens.breakpoint.${value}` as const, property: `--breakpoint-${value}` })),
];
const check = (source: string, files: Record<string, string> = {}) => checkLayoutRendererSource({ entry: "Layout.tsx", files: { "Layout.tsx": source, ...files } }, contract, tokens, compiler);

function closure(entry: string): LayoutRendererSource {
  const files: Record<string, string> = {};
  const pending = [entry];
  while (pending.length) {
    const file = pending.pop()!;
    if (Object.hasOwn(files, file)) continue;
    const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    files[file] = source;
    if (file.endsWith(".json")) continue;
    const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    for (const statement of parsed.statements) {
      if (!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement) || !statement.moduleSpecifier || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
      if (ts.isImportDeclaration(statement) && statement.importClause?.isTypeOnly || ts.isExportDeclaration(statement) && statement.isTypeOnly) continue;
      const specifier = statement.moduleSpecifier.text;
      if (specifier.startsWith(".")) {
        const target = posix.normalize(posix.join(posix.dirname(file), specifier));
        const candidates = [target.replace(/\.js$/, ".ts"), target.replace(/\.js$/, ".tsx"), target];
        const resolved = candidates.find(candidate => existsSync(new URL(`../${candidate}`, import.meta.url)));
        if (!resolved) throw new Error(`Missing fixture closure: ${target}`);
        pending.push(resolved);
      }
    }
  }
  return { entry, files };
}

describe("bounded layout source closure", () => {
  it.each([
    ["literal", 'export const Layout = () => <div className="grid gap-lg" style={{gap:"var(--spacing-lg)"}} />;'],
    ["constant", 'const C="grid"; const S={gap:"var(--spacing-lg)"}; export const Layout = () => <div className={C} style={S} />;'],
    ["finite branch", 'export const Layout = (props) => <div className={props.wide ? "grid grid-cols-2" : "flex flex-col"} style={{width: props.wide ? "100%" : undefined}} />;'],
    ["local return", 'function gap(){return "var(--spacing-lg)";} export const Layout = () => <div style={{gap:gap()}} />;'],
    ["numeric computation", 'export const Layout = () => <div style={{gridRowStart:Math.floor(8 / 4)}} />;'],
    ["local argument", 'function size(value){return {width:value};} export const Layout = () => <div style={size("100%")} />;'],
    ["calc", 'export const Layout = () => <div style={{gap:"calc(var(--spacing-lg) * 2)"}} />;'],
  ])("passes %s", (_, source) => expect(check(source)).toEqual([]));

  it.each([
    ["unknown class", 'export const Layout = (props) => <div className={props.className} />;'],
    ["opaque map receiver", 'export const Layout = (props) => {props.map(()=>0); return <div />;};'],
    ["opaque get receiver", 'export const Layout = (props) => {props.get("style"); return <div />;};'],
    ["opaque test receiver", 'export const Layout = (props) => {props.test("x"); return <div />;};'],
    ["opaque callback", 'export const Layout = (props) => { [1,2].map(props.render); return <div />;};'],
    ["branch array shape", 'export const Layout=(props)=>{const x=(props.flag?["grid"]:["flex","bg-red-500"]).map(value=>value);return <div className={x[1]}/>;};'],
    ["bad Number map", 'const x=["bad"].map(Number); export const Layout = () => <div style={{width:x[0]}} />;'],
    ["unknown Number map", 'export const Layout = (props) => {const x=props.values.map(Number);return <div style={{width:x[0]}} />;};'],
    ["shadowed Number map", 'const Number=(value)=>value; const x=["red"].map(Number); export const Layout = () => <div style={{width:x[0]}} />;'],
    ["spread member", 'export const Layout = (props) => {const s={gap:"var(--spacing-lg)",...props};return <div style={{gap:s.gap}} />;};'],
    ["out of range", 'const x=["grid"];export const Layout = () => <div className={x[9]} />;'],
    ["class helper", 'function get(p){return p;} export const Layout = (props) => <div className={get(props.name)} />;'],
    ["class template", 'export const Layout = (props) => <div className={`grid ${props.name}`} />;'],
    ["class concatenation", 'const C="grid"; export const Layout = () => <div className={C+" bg-red-500"} />;'],
    ["style helper argument", 'function size(value){return {width:value};} export const Layout = (props) => <div style={size(props.width)} />;'],
    ["unknown arithmetic", 'export const Layout = (props) => <div style={{width:props.raw - 0}} />;'],
    ["unknown unary", 'export const Layout = (props) => <div style={{width:-props.raw}} />;'],
    ["unknown coercion", 'export const Layout = (props) => <div style={{width:Number(props.width)}} />;'],
    ["division infinity", 'export const Layout = () => <div style={{width:1/0}} />;'],
    ["numeric overflow", 'export const Layout = () => <div style={{width:1e300 * 1e300}} />;'],
    ["NaN", 'export const Layout = () => <div style={{width:NaN}} />;'],
    ["Infinity", 'export const Layout = () => <div style={{width:Infinity}} />;'],
    ["failed number conversion", 'export const Layout = () => <div style={{width:Number("bad")}} />;'],
    ["style annotation", 'export const Layout = (props: {width:number}) => <div style={{width:props.width}} />;'],
    ["style assertion", 'export const Layout = (props) => <div style={{width:props.value as number}} />;'],
    ["computed style key", 'export const Layout = (props) => <div style={{[props.key]:0}} />;'],
    ["object spread", 'const S={gap:"var(--spacing-lg)"}; export const Layout = () => <div style={{...S}} />;'],
    ["helper spread", 'function size(value){return {...value};} export const Layout = () => <div style={size({width:0})} />;'],
    ["JSX spread", 'const S={className:"grid"}; export const Layout = () => <div {...S} />;'],
    ["style template", 'export const Layout = (props) => <div style={{gridColumn:`${props.index} / span 2`}} />;'],
    ["raw style", 'export const Layout = () => <div style={{gap:"12px"}} />;'],
    ["visual key", 'export const Layout = () => <div style={{color:"red"}} />;'],
    ["fallback", 'export const Layout = () => <div style={{gap:"var(--spacing-lg, 12px)"}} />;'],
    ["token outside reads", 'export const Layout = () => <div style={{gap:"var(--color-red)"}} />;'],
    ["mutable class", 'let C="grid"; C="bg-red-500"; export const Layout = () => <div className={C} />;'],
    ["mutable style", 'const S={gap:"var(--spacing-lg)"}; S.color="red"; export const Layout = () => <div style={S} />;'],
    ["mutated alias", 'const S={gap:"var(--spacing-lg)"}; const A=S; A.color="red"; export const Layout = () => <div style={S} />;'],
    ["argument mutation", 'function mutate(s){s.color="red";} const S={gap:"var(--spacing-lg)"}; mutate(S); export const Layout = () => <div style={S} />;'],
    ["raw query", 'const Q="@media (min-width: 768px)"; export const Layout = () => <div />;'],
    ["query constructor", 'const Q=matchMedia("(min-width: 768px)"); export const Layout = () => <div />;'],
    ["raw control", 'export const Layout = () => <button />;'],
    ["style tag", 'export const Layout = () => <style />;'],
    ["HTML", 'export const Layout = () => <div dangerouslySetInnerHTML={{__html:""}} />;'],
    ["unknown attribute", 'export const Layout = () => <div bgcolor="red" />;'],
    ["foreign dependency", 'import {X} from "other-library"; export const Layout = () => <X />;'],
    ["missing dependency", 'import {X} from "./missing.js"; export const Layout = () => <X />;'],
    ["missing reexport", 'export * from "./missing.js"; export const Layout = () => <div />;'],
    ["dynamic import", 'const X=import("./missing.js"); export const Layout = () => <div />;'],
    ["CSS order", 'export const Layout = () => <div className="order-2" />;'],
    ["CSS reverse", 'export const Layout = () => <div style={{flexDirection:"row-reverse"}} />;'],
  ])("refuses %s", (_, source) => expect(check(source)).not.toEqual([]));

  const arrayGuard = 'export const Layout=(props)=>{const list=props.items;if(!Array.isArray(list))throw new Error("items");list.map(()=>0);return <div/>;};';
  it("proves array receivers from a rejecting runtime guard",()=>expect(check(arrayGuard)).toEqual([]));
  it.each([
    ["mutated alias", arrayGuard.replace("list.map", "const alias=list;alias.map=props.call;list.map")],
    ["rebound", arrayGuard.replace("const list", "let list").replace("list.map", "list=props.other;list.map")],
    ["missing", arrayGuard.replace('if(!Array.isArray(list))throw new Error("items");','')],
    ["inverted", arrayGuard.replace('!Array.isArray','Array.isArray')],
    ["swallowed", arrayGuard.replace('throw new Error("items");','{try{throw new Error("items");}catch{}}')],
    ["nested", arrayGuard.replace('if(!Array.isArray(list))throw new Error("items");','if(props.enabled){if(!Array.isArray(list))throw new Error("items");}')],
    ["shadowed", 'const Array={isArray:()=>true};'+arrayGuard],
  ])("refuses %s array guard",(_,source)=>expect(check(source)).not.toEqual([]));

  const guard = 'function coordinate(value:unknown){if(typeof value!=="number" || !Number.isSafeInteger(value) || value<1) throw new Error("coordinate");return value;}';
  it("proves an unchanged finite integer through a source guard of any name", () => {
    expect(check(`${guard} export const Layout = (props) => <div style={{gridRowStart:coordinate(props.row)}} />;`)).toEqual([]);
    expect(check(`${guard.replaceAll("coordinate", "otherName")} export const Layout = (props) => <div style={{gridRowStart:otherName(props.row)}} />;`)).toEqual([]);
  });
  it.each([
    ["missing finite", guard.replace(' || !Number.isSafeInteger(value)', '')],
    ["missing type", guard.replace('typeof value!=="number" || ', '')],
    ["positive finite", guard.replace('!Number.isSafeInteger(value)', 'Number.isSafeInteger(value)')],
    ["changed type", guard.replace('typeof value!=="number"', 'typeof value==="number"')],
    ["wrong subject", guard.replace('Number.isSafeInteger(value)', 'Number.isSafeInteger(1)')],
    ["wrong connective", guard.replaceAll(' || ', ' && ')],
    ["fallthrough", guard.replace('throw new Error("coordinate")', '{}')],
    ["swallowed throw", guard.replace('throw new Error("coordinate")', '{try{throw new Error("coordinate");}catch{}}')],
    ["different return", guard.replace('return value;', 'return value+1;')],
    ["shadowed Number", 'const Number={isSafeInteger:()=>true};'+guard],
  ])("refuses %s guard", (_, helper) => {
    expect(check(`${helper} export const Layout = (props) => <div style={{gridRowStart:coordinate(props.row)}} />;`)).not.toEqual([]);
  });

  it("follows imported helpers and refuses hidden visual values", () => {
    const source = 'import {style} from "./helper.js"; export const Layout = () => <div style={style()} />;';
    expect(check(source, { "helper.ts": 'export function style(){return {gap:"var(--spacing-lg)"};}' })).toEqual([]);
    expect(check(source, { "helper.ts": 'export function style(){return {background:"red"};}' })).not.toEqual([]);
    expect(check(source, { "helper.ts": 'function style(){return {gap:"var(--spacing-lg)"};}' })).not.toEqual([]);
    expect(check(source, { "helper.ts": 'import {hidden} from "./hidden.js"; export function style(){return hidden();}' })).not.toEqual([]);
    expect(check(source, { "helper.ts": 'import {hidden} from "./hidden.js"; export function style(){return hidden();}', "hidden.ts": 'export function hidden(){return {background:"red"};}' })).not.toEqual([]);
  });

  it.each(["flag", "throw", "empty", "range", "unknown", "children", "descendants", "argument"])("refuses %s parser failures", mode => {
    const source = mode === "argument" ? 'const widths={zero:0};export const Layout=()=> <div style={{width:widths["zero"]}}/>;' : 'export const Layout = () => <div />;';
    const bad: LayoutCompilerPort = {
      ...compiler,
      parseSourceFile: (file, text) => {
        if (mode === "flag") return { passed: true, findings: [] };
        if (mode === "throw") throw new Error("unavailable");
        const parsed = compiler.parseSourceFile(file, text) as ts.SourceFile;
        if (mode === "empty") return { ...parsed, statements: [] };
        if (mode === "range") return { ...parsed, end: text.length + 1 };
        return parsed;
      },
      kind: value => mode === "unknown" ? "UnknownSyntax" : compiler.kind(value),
      children: value => mode === "children" || mode === "descendants" && compiler.kind(value) === "ArrowFunction" ? [] : compiler.children(value).filter(child => mode !== "argument" || compiler.kind(value) !== "ElementAccessExpression" || child !== (value as ts.ElementAccessExpression).argumentExpression),
    };
    expect(checkLayoutRendererSource({ entry: "Layout.tsx", files: { "Layout.tsx": source } }, contract, tokens, bad)).not.toEqual([]);
  });

  const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
  it("preserves the pre-extraction eight-config and 42 member selection outputs", () => {
    expect(baseline.base).toBe("9d50477e479ea0398b6a567b09a59ac8dcd38cf3");
    expect(baseline.cases).toHaveLength(42);
    expect(new Set(baseline.cases.map(row=>row.config)).size).toBe(8);
    for (const row of baseline.cases) expect(digest(getEffectiveLayoutContract(row.leaf, row.config, row.members))).toBe(row.expectedSha256);
  });
  it("detects a changed default member against the immutable parity baseline", () => {
    const leaf = structuredClone(LAYOUT_LEAVES.find(leaf=>leaf.id==="layouts.stack")!);
    const original = baseline.cases.find(row=>row.leaf===leaf.id && row.config==="stack.document" && !Object.keys(row.members).length)!;
    const config = leaf.contract.configs.find(config=>config.id === original.config)!;
    (config.members as Record<string,string>).measure = "form";
    const resolved = getEffectiveLayoutContract(leaf, original.config, original.members);
    expect(resolved.memberValues.measure).toBe("form");
    expect(digest(resolved)).not.toBe(original.expectedSha256);
  });
  it("refuses an unknown supplied-leaf breakpoint without a token fallback", () => {
    const leaf = structuredClone(LAYOUT_LEAVES.find(leaf=>leaf.id==="layouts.sidebar-content")!);
    (leaf.contract.members as Record<string,string[]>).breakpoint = ["unknown"];
    expect(()=>getEffectiveLayoutContract(leaf, undefined, {breakpoint:"unknown"})).toThrow("Unknown layout breakpoint");
  });
  it("keeps the compiler out of shipped runtime imports and declaration dependencies", () => {
    for (const file of ["layout-source.js", "layout-source.d.ts", "instance-binding.check.js", "instance-binding.check.d.ts"]) {
      const source = readFileSync(new URL(`../../dist/core/${file}`, import.meta.url), "utf8");
      expect(source).not.toMatch(/(?:from\s*|import\s*\()["']typescript["']/);
      expect(source).not.toContain("ts.SourceFile");
    }
  });

  const matrix = LAYOUT_LEAVES.filter(leaf => leaf.status !== "held").flatMap(leaf => leaf.contract.configs.map(config => ({ leaf, config: config.id,
    entry: `web/layouts/${({ "layouts.stack": "Stack", "layouts.split": "Split", "layouts.sidebar-content": "SidebarContent", "layouts.bento": "Bento" } as Record<string, string>)[leaf.id]}.tsx` })));
  it("measures four leaves and eight registered configurations", () => {
    expect(new Set(matrix.map(row => row.entry)).size).toBe(4);
    expect(matrix.map(row => row.config)).toEqual(["stack.landing", "stack.document", "stack.focus", "stack.index", "split.default", "sidebar-content.record", "sidebar-content.docs", "bento.default"]);
  });
  it.each(matrix)("clears source closure for $config", ({ leaf, config, entry }) => {
    const reachable = closure(entry);
    const descriptor = JSON.parse(readFileSync(new URL(`../layouts/fills/foundry/${leaf.id}.json`, import.meta.url), "utf8")) as {configs:string[];pin:{files:{path:string;sha256:string}[]}};
    expect(descriptor.configs).toContain(config);
    const files = Object.fromEntries(descriptor.pin.files.map(pin => {
      const bytes = readFileSync(new URL(`../../${pin.path}`, import.meta.url));
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(pin.sha256);
      return [pin.path.replace(/^src\//,""), bytes.toString("utf8")];
    }));
    expect(Object.keys(files).sort()).toEqual(Object.keys(reachable.files).sort());
    const renderer = { entry, files };
    expect(Object.keys(renderer.files)).toEqual(expect.arrayContaining(["web/layouts/preview/structure.tsx", "layouts/resolve.ts", "layouts/ids.ts", "layouts/slots/layouts.json"]));
    expect(checkLayoutRendererSource(renderer, getEffectiveLayoutContract(leaf, config), tokens, compiler)).toEqual([]);
  });
});
