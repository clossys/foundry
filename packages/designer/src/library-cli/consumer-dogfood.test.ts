/** @vitest-environment node */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { consumerDogfoodSources, parseConsumerDogfoodContract, runConsumerDogfood, type ConsumerDogfoodContract } from "./consumer-dogfood.js";
import { main } from "./cli.js";
import { runDogfood } from "../catalog-core/dogfood.js";
let root: string;
beforeEach(async () => { root = await fs.realpath(await fs.mkdtemp(join(tmpdir(), "consumer-dogfood-"))); });
afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });
const header = 'import { PageHeaderModule as Lease } from "@clossys/designer/shell";';
const page = `${header} export default function Page() { return <Lease id="example" header={{title:"Example"}}/>; }`;
const contract: ConsumerDogfoodContract = { version: 1, sources: { "@example/publisher": "Publisher.tsx", "@/": "src" }, pages: ["Page.tsx"] };
async function write(file: string, content: string) { await fs.mkdir(join(root, file, ".."), { recursive: true }); await fs.writeFile(join(root, file), content); }
const sources = () => consumerDogfoodSources(["Page.tsx"], contract, root, root);
describe("consumer source boundary (zero finding allowlist)", () => {
  it("collects mixed utility syntax and nested rules through the real AST", async () => {
    await write("Page.tsx", `${page} import "./root.css";`);
    await write("root.css", '@import "./nested.css"; @utility marker { list-style:none; &::-webkit-details-marker { display:none; } }');
    await write("nested.css", ".component { padding:4px; }");
    const input = await sources();
    expect(input.files.map(file => file.file)).toContain("nested.css");
    expect(runConsumerDogfood(input).findings).toEqual(expect.arrayContaining([expect.objectContaining({ file: "nested.css", code: "DF2" })]));
  });
  it("refuses stylesheet imports whose package resolution selects JavaScript", async () => {
    await write("Page.tsx", `${page} import "./root.css";`);
    await write("root.css", '@import "@example/styles";');
    await write("node_modules/@example/styles/package.json", JSON.stringify({ name: "@example/styles", version: "1.0.0", exports: { ".": { default: "./index.cjs" } } }));
    await write("node_modules/@example/styles/index.css", ".component { padding:4px; }");
    await write("node_modules/@example/styles/index.cjs", "module.exports={};");
    await expect(sources()).rejects.toThrow(/Stylesheet import resolved to non-CSS/);
  });
  it("follows actual stylesheet imports and exported package CSS without exemptions", async () => {
    await write("Page.tsx", `${page} import "./root.css";`);
    await write("root.css", '@import "@example/styles/tokens.css";');
    await write("node_modules/@example/styles/package.json", JSON.stringify({ name: "@example/styles", version: "1.0.0", exports: { "./tokens.css": "./tokens.css" } }));
    await write("node_modules/@example/styles/tokens.css", '@import "./nested.css";');
    await write("node_modules/@example/styles/nested.css", ".component { padding:4px; }");
    const input = await sources();
    expect(input.files.map(file => file.file)).toContain("node_modules/@example/styles/nested.css");
    expect(runConsumerDogfood(input).findings).toEqual(expect.arrayContaining([expect.objectContaining({ file: "node_modules/@example/styles/nested.css", code: "DF2" })]));
    await write("node_modules/@example/styles/nested.css", '@import "./missing.css";');
    await expect(sources()).rejects.toThrow(/Unresolved/);
  });
  it("refuses conditional imports whose activation cannot be reconstructed", async () => {
    await write("Page.tsx", `${page} import "./root.css";`);
    await write("root.css", '@import "./nested.css" layer(tokens);');
    await write("nested.css", ":root { --tracking-label: 0.04; }");
    await expect(sources()).rejects.toThrow(/conditional/);
  });
  it("recognizes the migrated public Frame by its actual registered module/export, retaining DF5 for fake symbols", async () => {
    await write("Page.tsx", `${header} import { AppFrame as Frame } from "@clossys/designer/frames"; export default function Page(){return <Frame><Lease id="example" header={{title:"Example"}}/></Frame>}`);
    expect(runConsumerDogfood(await sources()).findings).toEqual([]);
    await write("Page.tsx", `${header} import { FakeFrame as Frame } from "@clossys/designer/frames"; export default function Page(){return <Frame><Lease id="example" header={{title:"Example"}}/></Frame>}`);
    expect(runConsumerDogfood(await sources()).findings.some(finding => finding.code === "DF5")).toBe(true);
    await write("Page.tsx", `${header} import { AppFrame as Frame } from "./Fake.js"; export default function Page(){return <Frame><Lease id="example" header={{title:"Example"}}/></Frame>}`);
    await write("Fake.tsx", 'export function AppFrame({children}){return <div style={{background:"#123456"}}>{children}</div>}');
    expect(runConsumerDogfood(await sources()).findings.some(finding => finding.code === "DF2")).toBe(true);
  });
  it("recognizes the canonical direct imported FrameStage part, including a named alias", async () => {
    for (const declaration of ['import { FrameStage } from "@clossys/designer/frames";', 'import { FrameStage as Stage } from "@clossys/designer/frames";']) {
      const tag = declaration.includes(" as ") ? "Stage" : "FrameStage";
      await write("Page.tsx", `${header} ${declaration} export default function Page(){return <><Lease id="example" header={{title:"Example"}}/><${tag}/></>}`);
      expect(runConsumerDogfood(await sources()).findings).toEqual([]);
    }
  });
  it.each([
    ['import { FrameStage } from "foreign-ui";', "FrameStage"],
    ['import { FrameStage } from "@clossys/designer/frames-extra";', "FrameStage"],
    ['import { FrameStage } from "@clossys/designer/frames/extra";', "FrameStage"],
    ['function FrameStage(){return null}', "FrameStage"],
    ['import { FakeStage as FrameStage } from "@clossys/designer/frames";', "FrameStage"],
    ['import * as Frames from "@clossys/designer/frames";', "Frames.FrameStage"],
    ['export { FrameStage } from "@clossys/designer/frames";', "FrameStage"],
    ['import { FrameStage } from "reexported-ui";', "FrameStage"],
  ])("refuses foreign/local/name-only/namespace/re-export Stage identity: %s", async (declaration, tag) => {
    await write("Page.tsx", `${header} ${declaration} export default function Page(){return <><Lease id="example" header={{title:"Example"}}/><${tag}/></>}`);
    expect(runConsumerDogfood(await sources()).findings).toEqual(expect.arrayContaining([expect.objectContaining({ code: "DF5", tag })]));
  });
  it("still scans canonical Stage style/class props, children and raw page chrome", async () => {
    await write("Page.tsx", `${header} import { FrameStage as Stage } from "@clossys/designer/frames"; export default function Page(){return <><Lease id="example" header={{title:"Example"}}/><Stage style={{color:"#123456"}} className="bg-[#abcdef]"><div style={{padding:7}}/><h1>Raw heading</h1></Stage></>}`);
    const findings = runConsumerDogfood(await sources()).findings;
    expect(findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "DF2", tag: "Stage" }),
      expect.objectContaining({ code: "DF2", tag: "div" }),
      expect.objectContaining({ code: "DF7", tag: "h1" }),
    ]));
    expect(findings.filter(finding => finding.tag === "Stage" && finding.code === "DF5")).toEqual([]);
  });
  it("imports the single typed Stage identity without a scanner string copy", async () => {
    const source = await fs.readFile(fileURLToPath(new URL("../catalog-core/dogfood.ts", import.meta.url)), "utf8");
    expect(source).toContain('import { runtimeStageModuleIdentity } from "./runtime-ports.js"');
    expect(source).not.toContain('"@clossys/designer/frames"');
    expect(source).not.toContain('"FrameStage"');
  });
  it("recognizes only direct lexical React context Providers, including direct named aliases", async () => {
    for (const factory of ["createContext", "make"]) {
      const declaration = factory === "make" ? "createContext as make" : "createContext";
      await write("Page.tsx", `${header} import { ${declaration}, useContext as read } from "react"; const Context = ${factory}<unknown>(null); function useValue(){return read(Context)} export default function Page(){return <><Lease id="example" header={{title:"Example"}}/><Context.Provider value={{ready:true}}><div/></Context.Provider></>}`);
      expect(runConsumerDogfood(await sources()).findings).toEqual([]);
    }
  });
  it.each([
    'import { createContext } from "foreign-react"; const Context = createContext(null);',
    'function createContext(){return {Provider(){return null}}} const Context = createContext(null);',
    'import { createContext } from "react"; function factory(){return createContext(null)} const Context = factory();',
    'const Context = {Provider(){return null}};',
    'import { createContext } from "react"; let Context = createContext(null);',
    'import { createContext } from "react"; const Context = createContext(null); Context = foreign;',
    'import { createContext } from "react"; const Context = createContext(null); Context.Provider = foreign;',
    'import { createContext } from "react"; const Context = createContext(null); function shadow(Context){return Context}',
    'import { createContext as make } from "react"; const Context = make(null); function shadow(make){return make}',
    'import * as React from "react"; const Context = React.createContext(null);',
    'import { createContext } from "react"; const Context = createContext(null); eval("Context.Provider = foreign");',
  ])("refuses unresolved/factory/fake/shadowed/reassigned context provenance: %s", async declaration => {
    await write("Page.tsx", `${header} ${declaration} export default function Page(){return <><Lease id="example" header={{title:"Example"}}/><Context.Provider value={null}/></>}`);
    expect(runConsumerDogfood(await sources()).findings).toContainEqual(expect.objectContaining({ code: "DF5", tag: "Context.Provider" }));
  });
  it("refuses a createContext alias re-exported through a real local barrel", async () => {
    await write("Barrel.ts", 'export { createContext as make } from "react";');
    await write("Page.tsx", `${header} import { make } from "./Barrel.js"; const Context = make(null); export default function Page(){return <><Lease id="example" header={{title:"Example"}}/><Context.Provider value={null}/></>}`);
    const input = await sources();
    expect(input.files.some(file => file.file === "Barrel.ts")).toBe(true);
    expect(runConsumerDogfood(input).findings).toContainEqual(expect.objectContaining({ code: "DF5", tag: "Context.Provider" }));
  });
  it("still scans a lexical Provider value style object, style props and child chrome", async () => {
    await write("Page.tsx", `${header} import { createContext } from "react"; const Context = createContext(null); export default function Page(){return <><Lease id="example" header={{title:"Example"}}/><Context.Provider value={{style:{padding:"7px"}}} style={{color:"#123456"}}><h1 style={{color:"#abcdef"}}>Raw</h1></Context.Provider></>}`);
    const findings = runConsumerDogfood(await sources()).findings;
    expect(findings).toContainEqual(expect.objectContaining({ code: "DF2", tag: "Context.Provider", evidence: "Style object in Provider value remains authored styling." }));
    expect(findings).toContainEqual(expect.objectContaining({ code: "DF2", tag: "Context.Provider", evidence: expect.stringContaining("Consumer inline styles") }));
    expect(findings).toContainEqual(expect.objectContaining({ code: "DF7", tag: "h1" }));
    expect(findings.some(row => row.code === "DF5" && row.tag === "Context.Provider")).toBe(false);
  });
  it("follows the state entry through the actual original provider and transitive implementation", async () => {
    await write("Page.tsx", `${page} import { useWholeStudio } from "@clossys/designer/studio/state";`);
    const input = await sources(), edge = input.consumerBoundary.sourceImports["Page.tsx:@clossys/designer/studio/state"];
    expect(edge).toMatch(/\/studio\/WholeStudioProvider\.tsx$/);
    expect(input.files.find(file => file.file === edge)?.content).toContain("export function WholeStudioProvider");
    expect(input.files.some(file => file.file.endsWith("/studio/StudioProvider.tsx"))).toBe(true);
    expect(input.files.some(file => file.file.endsWith("/studio/whole-model.ts"))).toBe(true);
    expect(input.files.some(file => file.file.endsWith("/studio/matrix-model.ts"))).toBe(true);
    expect(Object.keys(input.consumerBoundary.sourceImports).some(edge => edge.includes("/studio/StudioProvider.tsx:"))).toBe(true);
    expect(input.files.some(file => file.file.endsWith("/studio/StudioSurface.tsx"))).toBe(false);
  });
  it("follows actual mapped package/alias source, Next Link and parsed JSON data", async () => {
    await write("Page.tsx", `${header} import Link from "next/link"; import { Publisher } from "@example/publisher"; import data from "./copy.json"; export default function Page(){return <><Lease id="example" header={{title:data.title}}/><Link href="/">Home</Link><Publisher/></>}`);
    await write("Publisher.tsx", 'import { Button } from "@clossys/designer/components"; export function Publisher(){return <Button>Publish</Button>}');
    await write("copy.json", '{"title":"Example","quoted":"<button/>"}');
    const input = await sources(); const report = runConsumerDogfood(input);
    expect(report.findings).toEqual([]); expect(report.ok).toBe(true);
    expect(input.consumerBoundary.projectSourceImports).toEqual(["Page.tsx:@example/publisher"]);
    expect(runConsumerDogfood({ ...input, consumerBoundary: { ...input.consumerBoundary, projectSourceImports: [] } }).findings).toContainEqual(expect.objectContaining({ code: "DF5", tag: "Publisher" }));
    expect(input.data).toEqual(["copy.json"]);
    expect(report.scanned.map(file => file.file)).toEqual(["Page.tsx", "Publisher.tsx"]);
    // The existing strict checker is unchanged: unresolved project widgets stay findings.
    expect(runDogfood({ files: input.files }).findings.some(finding => finding.code === "DF5")).toBe(true);
    await write("Publisher.tsx", 'export function Publisher(){return <button>Publish</button>}');
    expect(runConsumerDogfood(await sources()).findings).toEqual(expect.arrayContaining([expect.objectContaining({ file: "Publisher.tsx", code: "DF1" })]));
  });
  it("qualifies nested explicitly mapped project views with observed JSON dependencies and refuses missing or spoofed observations", async () => {
    await write("Page.tsx", `${header} import { Publisher } from "@example/publisher"; export default function Page(){return <><Lease id="example" header={{title:"Example"}}/><Publisher/></>}`);
    await write("Publisher.tsx", 'import {Inner} from "@/Inner.js";export function Publisher(){return <Inner/>}');
    await write("src/Inner.tsx", 'import {Button} from "@clossys/designer/components";import copy from "./copy.json";export function Inner(){return <Button>{copy.title}</Button>}');
    await write("src/copy.json", '{"title":"Example","quoted":"<button/>"}');
    const input = await sources();
    expect(input.data).toEqual(["src/copy.json"]);
    expect(input.consumerBoundary.sourceImports["src/Inner.tsx:./copy.json"]).toBe("src/copy.json");
    expect(input.consumerBoundary.projectSourceImports).toEqual(["Page.tsx:@example/publisher", "Publisher.tsx:@/Inner.js"]);
    expect(runConsumerDogfood(input).findings).toEqual([]);
    expect(runDogfood({ ...input, data: [] }).findings).toContainEqual(expect.objectContaining({ code: "DF5", tag: "Publisher" }));
    for (const data of [[], ["src/copy.json", "src/copy.json"], ["Publisher.tsx"], ["unknown.json"], ["raw.css"], ["src/copy.json", "Page.tsx"]]) expect(() => runConsumerDogfood({ ...input, data })).toThrow();
    for (const projectSourceImports of [["missing:edge"], [""], ["Page.tsx:@example/publisher", "Page.tsx:@example/publisher"]]) expect(() => runConsumerDogfood({ ...input, consumerBoundary: { ...input.consumerBoundary, projectSourceImports } })).toThrow(/project source edge/);
    expect(() => runConsumerDogfood({ ...input, files: [...input.files, { file: "src/copy.json", content: "{}" }] })).toThrow(/conflicting/);
    for (const content of ['export function Inner(){return null}', 'import {Button} from "@clossys/designer/components";export function Inner(){return <div/>}', 'import {Button} from "@clossys/designer/components";function Inner(){return <Button/>}']) {
      await write("src/Inner.tsx", content);
      expect(runConsumerDogfood(await sources()).findings).toContainEqual(expect.objectContaining({ code: "DF5", tag: "Publisher" }));
    }
    await write("src/Inner.tsx", 'import {Button} from "@clossys/designer/components";export function Inner(){return <Button><button/><span style={{color:"#123456"}}/></Button>}');
    const raw = runConsumerDogfood(await sources());
    expect(raw.findings).toContainEqual(expect.objectContaining({ code: "DF1", file: "src/Inner.tsx", tag: "button" }));
    expect(raw.findings).toContainEqual(expect.objectContaining({ code: "DF2", file: "src/Inner.tsx", tag: "span" }));
  });
  it("qualifies the actual PublisherCompositionsView through the real project source runner", async () => {
    const publisher = fileURLToPath(new URL("../../../publisher/src/web/index.ts", import.meta.url));
    await write("Page.tsx", `${header} import {PublisherCompositionsView as Published} from "@clossys/publisher/web";export default function Page(){return <><Lease id="example" header={{title:"Example"}}/><Published/></>}`);
    const input = await consumerDogfoodSources(["Page.tsx"], { ...contract, sources: { "@clossys/publisher/web": publisher } }, root, root);
    expect(input.consumerBoundary.projectSourceImports).toContain("Page.tsx:@clossys/publisher/web");
    expect(input.files.some(file => file.file.endsWith("/web/compositions/PublisherCompositionsView.tsx"))).toBe(true);
    expect(input.data.some(file => file.endsWith(".json"))).toBe(true);
    expect(input.files.some(file => file.file.endsWith("/package.json"))).toBe(false);
    expect(runConsumerDogfood(input).findings.filter(row => row.code === "DF5" && row.tag === "Published")).toEqual([]);
    expect(runDogfood({ files: input.files }).findings).toContainEqual(expect.objectContaining({ code: "DF5", tag: "Published" }));
  });
  it("passes mapped project views through the actual dogfood-consumer CLI without promoting JSON to source", async () => {
    await write("Page.tsx", `${header} import {Publisher} from "@example/publisher";export default function Page(){return <><Lease id="example" header={{title:"Example"}}/><Publisher/></>}`);
    await write("Publisher.tsx", 'import {Button} from "@clossys/designer/components";import copy from "./copy.json";export function Publisher(){return <Button>{copy.title}</Button>}');
    await write("copy.json", '{"title":"Example"}');
    await write("contract.json", JSON.stringify(contract));
    const out: string[] = [], errors: string[] = [];
    const code = await main(["dogfood-consumer", join(root, "Page.tsx"), "--root", root, "--contract", join(root, "contract.json"), "--json"], { out: text => out.push(text), error: text => errors.push(text) });
    expect(errors).toEqual([]); expect(code).toBe(0);
    const report = JSON.parse(out.join(""));
    expect(report.findings).toEqual([]);
    expect(report.scanned.map((file: { file: string }) => file.file.split("/").at(-1))).toEqual(["Page.tsx", "Publisher.tsx"]);
  });
  it("scans stylesheet colors and does not honor suppression comments or source labels", async () => {
    await write("Page.tsx", `${header} import "./console.css"; export default function Page(){return <><Lease id="example" header={{title:"Example"}}/><div style={{color:"#123456"}}/></>} // token-gate:ignore test`);
    await write("console.css", ".console { color: rgb(1 2 3); background: #abcdef; }");
    const report = runConsumerDogfood(await sources());
    expect(report.ignored).toEqual([]); expect(report.exceptions).toEqual([]);
    expect(report.findings.filter(finding => finding.file === "console.css").length).toBeGreaterThanOrEqual(2);
    expect(report.findings.some(finding => finding.evidence.includes("inline styles"))).toBe(true);
  });
  it.each(["header", "h1", "nav"])("forbids raw %s even in a reachable page helper", async tag => {
    await write("Page.tsx", `${header} import { Publisher } from "@example/publisher"; export default function Page(){return <><Lease id="example" header={{title:"Example"}}/><Publisher/></>}`);
    await write("Publisher.tsx", `export function Publisher(){return <${tag}>Title</${tag}>}`);
    expect(runConsumerDogfood(await sources()).findings).toEqual(expect.arrayContaining([expect.objectContaining({ file: "Publisher.tsx", code: "DF7", tag })]));
  });
  it("finds hand-styled tab strips through imported aliases", async () => {
    await write("Page.tsx", `${header} import { Tabs as Navigation } from "@clossys/designer/components"; export default function Page(){return <><Lease id="example" header={{title:"Example"}}/><Navigation.List className="flex"/></>}`);
    expect(runConsumerDogfood(await sources()).findings.some(finding => finding.code === "DF7")).toBe(true);
  });
  it.each([
    'function PageHeaderModule(){return null}; const Page=()=> <PageHeaderModule id="fake" header={{title:"Fake"}}/>',
    'import { PageHeaderModule } from "foreign-ui"; const Page=()=> <PageHeaderModule id="fake" header={{title:"Fake"}}/>',
    `${header} const Page=()=> <div/>`,
    `${header} const Page=()=> <Lease id="example"/>`,
    `${header} const Page=()=> <><Lease id="a" header={a}/><Lease id="b" header={b}/></>`,
    `// <Lease id="fake" header={data}/>\n${header} const fake='<Lease id="fake" header={data}/>'; const Page=()=> <div/>`,
  ])("requires one actual imported lease, not a lookalike or comment", async content => {
    await write("Page.tsx", content);
    expect(runConsumerDogfood(await sources()).findings.some(finding => finding.code === "DF8")).toBe(true);
  });
  it("refuses unscanned pages, malformed data, missing mapped source and remapped primitives", async () => {
    await write("Page.tsx", page);
    await expect(consumerDogfoodSources(["Page.tsx"], { ...contract, pages: ["missing.tsx"] }, root, root)).rejects.toThrow(/not reached/);
    await write("Page.tsx", 'import { Publisher } from "@example/publisher";');
    await expect(sources()).rejects.toThrow(/Unresolved project source/);
    await write("Page.tsx", `${page} import bad from "./copy.json";`); await write("copy.json", "not json");
    await expect(sources()).rejects.toThrow();
    for (const sources of [{ "react-aria-components": "fake.tsx" }, { "@clossys/designer/components": "fake.tsx" }, { "next/link": "fake.tsx" }]) expect(() => parseConsumerDogfoodContract({ ...contract, sources })).toThrow(/cannot be remapped/);
    expect(() => parseConsumerDogfoodContract({ ...contract, allowlist: [] })).toThrow();
    expect(() => parseConsumerDogfoodContract({ ...contract, pages: [] })).toThrow();
  });
  it("exposes a supported read-only command with truthful exits and no exception manifest", async () => {
    await write("Page.tsx", page); await write("contract.json", JSON.stringify(contract));
    await write("dogfood-exceptions.json", "not even valid JSON; consumer mode must not load it");
    const invoke = async () => { const out: string[] = [], errors: string[] = []; const code = await main(["dogfood-consumer", join(root, "Page.tsx"), "--root", root, "--contract", join(root, "contract.json"), "--json"], { out: text => out.push(text), error: text => errors.push(text) }); return { code, out: out.join(""), errors }; };
    expect(await invoke()).toMatchObject({ code: 0, errors: [] });
    await write("Page.tsx", `${header} import { Button } from "react-aria-components"; const Page=()=> <><Lease id="example" header={{title:"Example"}}/><Button/></>`);
    const failed = await invoke(); expect(failed.code).toBe(1); expect(JSON.parse(failed.out).findings.some((row: { code: string }) => row.code === "DF5")).toBe(true);
    const bin = fileURLToPath(new URL("../../dist/library-cli/cli.js", import.meta.url));
    const compiled = spawnSync(process.execPath, [bin, "dogfood-consumer", join(root, "Page.tsx"), "--root", root, "--contract", join(root, "contract.json"), "--json"], { encoding: "utf8" });
    expect(compiled.status).toBe(1); expect(JSON.parse(compiled.stdout).ok).toBe(false);
  });
});

it("counts the one real header lease across an async route adapter and its resolved composition graph", async () => {
  await write("Page.tsx", 'export { default } from "./Emitted.js";');
  await write("Emitted.tsx", page);
  expect(runConsumerDogfood(await sources()).findings).toEqual([]);
  await write("Page.tsx", `${header} import Emitted from "./Emitted.js"; export default function Page(){return <><Lease id="duplicate" header={{title:"Duplicate"}}/><Emitted/></>}`);
  expect(runConsumerDogfood(await sources()).findings.some(f => f.code === "DF8")).toBe(true);
  await write("Page.tsx", 'export { default } from "./Emitted.js";');
  await write("Emitted.tsx", 'function PageHeaderModule(){return null}; export default function Page(){return <PageHeaderModule id="fake" header={{title:"Fake"}}/>}');
  expect(runConsumerDogfood(await sources()).findings.some(f => f.code === "DF8")).toBe(true);
});
