/** @vitest-environment node */
import {expect,it} from "vitest";
import {parseSurfaceModule,analyzeSurfaceSource,relativeSurfacePath} from "./surface-source-analysis.js";
import {syntheticSurface} from "./__fixtures__/surface-engine/synthetic.js";
import {resolve} from "./api.js";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { assertSurfaceCandidate } from "./surface-library.js";
import { adoptedComponentIntegration } from "./__fixtures__/component-integration.js";

// Complete, unchanged MIT sources from tailark/blocks at this exact commit.
const tailarkRef = "8139698115c1341bfd2e3e286c04bb4d8146f472";
const tailarkHeroes = [
  { variant: "one", file: "../../references/tailark-oss/mist-hero-section-1@8139698/mist/blocks/hero-section/one/hero-section.tsx", bytes: 4903, sha256: "79d54e20adb1ba43f9353556e903509adfdd4be27bb7e2ee801c8d54b408e760", blob: "2cc712e80d07c5fa75c9999a21f6b4eb0bad40af" },
  { variant: "two", file: "./__fixtures__/surface-engine/tailark-defaults/hero-two.tsx.txt", bytes: 4452, sha256: "5f9b8b5713c734619635712592dec8439b3a5a79a7aefa844424497dccf8a3c1", blob: "d7a5749d09c52fe4789369afa7696410d612c81a" },
  { variant: "six", file: "./__fixtures__/surface-engine/tailark-defaults/hero-six.tsx.txt", bytes: 4347, sha256: "83a4ec750dd7bd46a40fec6c284d58650992408a868207a40bbd9d38c0599317", blob: "04d553c9bb7560e1ee9d3860ae9540e0d156b06e" },
];
it.each(tailarkHeroes)(`parses unchanged Tailark ${tailarkRef} Hero $variant with actual default export identity`, row => {
  const bytes = readFileSync(new URL(row.file, import.meta.url));
  expect(bytes.length).toBe(row.bytes);
  expect(createHash("sha256").update(bytes).digest("hex")).toBe(row.sha256);
  expect(createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex")).toBe(row.blob);
  const proof = parseSurfaceModule(bytes.toString("utf8"));
  expect(proof.functions).toEqual(["HeroSection"]);
  expect(proof.values).toEqual(["default"]);
  expect(proof.functionExports).toEqual([{ export: "default", local: "HeroSection" }]);
  expect(proof.imports.filter(edge => edge.name === "default")).toEqual([
    { module: "react", name: "default", local: "React", kind: "value" },
    { module: "next/link", name: "default", local: "Link", kind: "value" },
    { module: "next/image", name: "default", local: "Image", kind: "value" },
  ]);
});
it("retains the exact MIT notice for the copied Tailark sources", () => {
  const license = readFileSync(new URL("./__fixtures__/surface-engine/tailark-defaults/LICENCE.md", import.meta.url));
  expect(createHash("sha256").update(license).digest("hex")).toBe("9ceb2565db4149b699df9fb53b16963f59675f5308de1143679639b2c561410c");
});
it("keeps concrete default function local identity distinct from its exported API", () => {
  const { input, candidate } = syntheticSurface();
  candidate.impl.export = "default";
  candidate.api.exports = [{ name: "Synthetic", export: "default" }];
  expect(() => assertSurfaceCandidate(candidate)).not.toThrow();
  const files = [{ path: candidate.impl.entry, content: "export default function Main() { return null; }" }];
  const analyze = () => analyzeSurfaceSource({ fill: candidate, files, components: resolve(input).components, componentFiles: [], packages: [] });
  expect(analyze().findings).toEqual([]);
  expect(analyze().values).toEqual([{ file: candidate.impl.entry, name: "Synthetic", export: "default" }]);
  candidate.api.exports = [{ name: "Synthetic", export: "Main" }];
  expect(analyze().findings).toEqual([expect.objectContaining({ code: "S4" })]);
  candidate.api.exports = [{ name: "default", export: "default" }];
  expect(() => assertSurfaceCandidate(candidate)).toThrow(/unsafe API/);
});
it.each(["propMap", "slotMap", "config", "frameSlot", "stateValue", "stateChange"] as const)("binds %s to the actual default export, preserving API membership", position => {
  const frames = ["frameSlot", "stateValue", "stateChange"].includes(position);
  const { candidate } = syntheticSurface({ layer: frames ? "frames" : "sections" });
  candidate.impl.export = "default";
  candidate.api.exports = [{ name: "Synthetic", export: "default" }];
  const target = { export: "default", path: ["title"] };
  if (candidate.kind === "section") {
    if (position === "propMap") candidate.propMap = { title: target };
    if (position === "slotMap") candidate.slotMap = { title: target };
    if (position === "config") candidate.configs = { compact: { members: [], props: [{ ...target, value: "compact" }] } };
  } else {
    candidate.slots = { main: position === "frameSlot" ? target : { export: "default", path: ["children"] } };
    if (position === "stateValue" || position === "stateChange") candidate.statePorts = { open: {
      value: position === "stateValue" ? target : { export: "default", path: ["open"] },
      change: position === "stateChange" ? target : { export: "default", path: ["onOpenChange"] },
    } };
  }
  expect(() => assertSurfaceCandidate(candidate)).not.toThrow();
  const boundTarget = candidate.kind === "section" && position === "config" ? candidate.configs.compact!.props[0]! : target;
  boundTarget.export = "Synthetic";
  expect(() => assertSurfaceCandidate(candidate)).toThrow(/unknown local API binding/);
  boundTarget.export = "Unlisted";
  expect(() => assertSurfaceCandidate(candidate)).toThrow(/unknown local API binding/);
  boundTarget.export = "default";
  expect(() => assertSurfaceCandidate(candidate)).not.toThrow();
});
it("requires actual default export evidence and the exact local binding for imports", () => {
  const { input, candidate } = syntheticSurface();
  const files = [{ path: candidate.impl.entry, content: 'import Link from "next/link"; export function Synthetic() { return <Link />; }' }];
  const evidence = { module: "next/link", version: "1.0.0", artifactSha256: "a".repeat(64), values: ["default"], types: [] };
  candidate.dependencies = [{ module: evidence.module, version: evidence.version, license: "MIT" }];
  const analyze = (packages = [evidence]) => analyzeSurfaceSource({ fill: candidate, files, components: resolve(input).components, componentFiles: [], packages });
  expect(analyze().findings).toEqual([]);
  expect(analyze().imports).toEqual([{ file: candidate.impl.entry, module: "next/link", name: "default", local: "Link", kind: "value", target: "next/link" }]);
  expect(analyze([]).findings.some(f => f.code === "S4")).toBe(true);
  evidence.values = ["Link"];
  expect(analyze().findings.some(f => f.code === "S4")).toBe(true);
  files[0]!.content = 'import Link from "./helper.js"; export function Synthetic() { return <Link />; }';
  files.push({ path: "sections/synthetic/helper.ts", content: "export function Link() { return null; }" });
  expect(analyze([]).findings.some(f => f.code === "S4")).toBe(true);
  files[1]!.content = "export default function RealLink() { return null; }";
  expect(analyze([]).findings).toEqual([]);
  candidate.bindings = [{ file: candidate.impl.entry, module: "./helper.js", name: "default", local: "WrongLink", slot: "components.button" }];
  expect(analyze([]).findings).toContainEqual(expect.objectContaining({ message: "extra component binding" }));
});
it("does not infer a default export from a selected component implementation or spoof text", () => {
  const { input, candidate } = syntheticSurface();
  const components = resolve(adoptedComponentIntegration()).components;
  components.components["components.button"]!.impl.export = "default";
  const module = "../../components/button/index.js";
  candidate.bindings = [{ file: candidate.impl.entry, module, name: "default", local: "Button", slot: "components.button" }];
  const files = [{ path: candidate.impl.entry, content: `import Button from "${module}"; export function Synthetic() { return <Button />; }` }];
  const componentFiles = [{ path: "components/button/index.ts", content: 'export { default as Button } from "./button.js"; // default Button' }];
  const analyze = () => analyzeSurfaceSource({ fill: candidate, files, components, componentFiles, packages: [] });
  expect(analyze().findings).toContainEqual(expect.objectContaining({ code: "S4", message: "selected public API unavailable default" }));
  candidate.bindings[0]!.local = "OtherButton";
  expect(analyze().findings).toContainEqual(expect.objectContaining({ code: "S4", message: `unbound selected import ${module}#default` }));
});
it("retains named imports beside a default without conflating their local bindings", () => {
  expect(parseSurfaceModule('import Main, { Helper as LocalHelper, type Item } from "module"; export function View() {}').imports).toEqual([
    { module: "module", name: "default", local: "Main", kind: "value" },
    { module: "module", name: "Helper", local: "LocalHelper", kind: "value" },
    { module: "module", name: "Item", local: "Item", kind: "type" },
  ]);
});
it("retains genuine type default imports and contiguous arrow helpers with same-line comments", () => {
  expect(parseSurfaceModule('import type React from "react";').imports).toEqual([{ module: "react", name: "default", local: "React", kind: "type" }]);
  expect(parseSurfaceModule('export function Main() {} const Helper = () /* same line */ => (<div />)').values).toEqual(["Main"]);
});
it.each([
  'export default function () {}',
  'export default function class() {}',
  'export default function null() {}',
  'export "default" function Main() {}',
  'export default "function" Main() {}',
  'export default function Main() {} export default function Other() {}',
  'export default Main; function Main() {}',
  'export default () => null;',
  'import Main, { Helper as Main } from "module";',
  'import default from "module";',
  'import function from "react"; export function Main() { return null; }',
  'import class from "react"; export function Main() { return null; }',
  'import const from "react"; export function Main() { return null; }',
  'import null from "react"; export function Main() { return null; }',
  'import await from "react"; export function Main() { return null; }',
  'import arguments from "react"; export function Main() { return null; }',
  'import Main, from "module";',
  'import Main, * as Helpers from "module";',
  'import "type" React from "react";',
  'import React "," { Helper } from "react";',
  'import React, { "type" Item } from "react";',
  'import React, { Helper "as" LocalHelper } from "react";',
  'import React "from" "react";',
  'export function Main() {} const Helper = () "=" ">" (<div />)',
  'export function Main() {} const Helper = () "=>" (<div />)',
  'export function Main() {} const Helper "=" () => (<div />)',
  'export function Main() {} const Helper = () = > (<div />)',
  'export function Main() {} const Helper = () = /* comment */ > (<div />)',
  'export function Main() {} const Helper = ()\n=> (<div />)',
  'export function Main() {} const Helper = ()\r=> (<div />)',
  'export function Main() {} const Helper = ()\u2028=> (<div />)',
  'export function Main() {} const Helper = ()\u2029=> (<div />)',
  'export function Main() {} const Helper = () /*\n*/ => (<div />)',
  'const Missing =',
  'const Unclosed = (1',
  'const Hidden = 1\nexport function Main() {}',
  'const Hidden = 1\nimport Main from "module"',
  'const Hidden = 1\nfunction Main() {}',
  'const Hidden = 1\nasync function Main() {}',
  'const Hidden = 1\ntype Item = string',
  'const Hidden = 1\nvar Other = 2',
  'const Hidden = 1\nconst Other = 2',
  'const Helper = () => (<div />)\nexport function Main() {}',
  'const Helper = () => (<div />)\nimport Main from "module"',
  'const Helper = () => (<div />)\nconst Other = 2',
  'const Helper = () => (null)',
  'const Helper = () => ()',
  'export const Main = () => null',
])("refuses malformed defaults and declaration boundaries %s", source => {
  expect(() => parseSurfaceModule(source)).toThrow();
});
it("resolves the emitter's extensionless relative source uniquely and refuses missing or ambiguous targets", () => {
  const entry = "components/button/index.ts";
  expect(relativeSurfacePath(entry, "./button", ["components/button/button.tsx"])).toBe("components/button/button.tsx");
  expect(relativeSurfacePath(entry, "./button", ["components/button/button.ts"])).toBe("components/button/button.ts");
  expect(relativeSurfacePath(entry, "./button", [])).toBeUndefined();
  expect(relativeSurfacePath(entry, "./button", ["components/button/button.ts", "components/button/button.tsx"])).toBeUndefined();
  expect(relativeSurfacePath(entry, "../../../outside", ["outside.ts"])).toBeUndefined();
});
it("separates erased types, concrete functions and spoof text",()=>{const proof=parseSurfaceModule('export interface Item { value: string }\nexport type Alias = Item;\nconst x = "export function Fake() {}";\nfunction Main(value: Item): string { return `${value.value} ${1 / 2}`; }\nexport { Main };');expect(proof.values).toEqual(["Main"]);expect(proof.types).toEqual(["Item","Alias"]);expect(()=>parseSurfaceModule('export type { Item };')).toThrow();expect(()=>parseSurfaceModule('export const Main = () => null;')).toThrow();});
it.each(['export * from "x";','export { X } from "x";','import * as React from "react";','export function X() { return <React.X />; }','export function X() { return `${import("x")}`; }','export function X() { return /hidden/; }','export function X() { return `unterminated; }','declare function X(): void;','class X {}','export { Imported }; import { Imported } from "x";'])("refuses unsupported source %s",source=>{expect(()=>parseSurfaceModule(source)).toThrow();});
it("retains static edges inside actual type-cycle closure and rejects unavailable type/value",()=>{const {input,candidate}=syntheticSurface();const files=[{path:candidate.impl.entry,content:'import type { Item } from "./types.js"; export function Synthetic(value: Item) { return `${value.name}`; }'},{path:"sections/synthetic/types.ts",content:'import type { Synthetic } from "./Synthetic.js"; export interface Item { name: string }'}];const proof=analyzeSurfaceSource({fill:candidate,files,components:resolve(input).components,componentFiles:[],packages:[]});expect(proof.findings).toEqual(expect.arrayContaining([expect.objectContaining({code:"S4"})]));expect(proof.imports).toHaveLength(2);files[1]!.content='export interface Item { name: string }';expect(analyzeSurfaceSource({fill:candidate,files,components:resolve(input).components,componentFiles:[],packages:[]}).findings).toEqual([]);files[0]!.content=files[0]!.content.replace("import type","import");expect(analyzeSurfaceSource({fill:candidate,files,components:resolve(input).components,componentFiles:[],packages:[]}).findings.some(f=>f.code==="S4")).toBe(true);});
