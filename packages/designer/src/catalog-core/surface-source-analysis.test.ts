/** @vitest-environment node */
import {expect,it} from "vitest";
import {parseSurfaceModule,analyzeSurfaceSource,relativeSurfacePath} from "./surface-source-analysis.js";
import {syntheticSurface} from "./__fixtures__/surface-engine/synthetic.js";
import {resolve} from "./api.js";
it("resolves the emitter's extensionless relative source uniquely and refuses missing or ambiguous targets", () => {
  const entry = "components/button/index.ts";
  expect(relativeSurfacePath(entry, "./button", ["components/button/button.tsx"])).toBe("components/button/button.tsx");
  expect(relativeSurfacePath(entry, "./button", ["components/button/button.ts"])).toBe("components/button/button.ts");
  expect(relativeSurfacePath(entry, "./button", [])).toBeUndefined();
  expect(relativeSurfacePath(entry, "./button", ["components/button/button.ts", "components/button/button.tsx"])).toBeUndefined();
  expect(relativeSurfacePath(entry, "../../../outside", ["outside.ts"])).toBeUndefined();
});
it("separates erased types, concrete functions and spoof text",()=>{const proof=parseSurfaceModule('export interface Item { value: string }\nexport type Alias = Item;\nconst x = "export function Fake() {}";\nfunction Main(value: Item): string { return `${value.value} ${1 / 2}`; }\nexport { Main };');expect(proof.values).toEqual(["Main"]);expect(proof.types).toEqual(["Item","Alias"]);expect(()=>parseSurfaceModule('export type { Item };')).toThrow();expect(()=>parseSurfaceModule('export const Main = () => null;')).toThrow();});
it.each(['export * from "x";','export { X } from "x";','export default function X() {}','import * as React from "react";','export function X() { return <React.X />; }','export function X() { return `${import("x")}`; }','export function X() { return /hidden/; }','export function X() { return `unterminated; }','declare function X(): void;','class X {}','export { Imported }; import { Imported } from "x";'])("refuses unsupported source %s",source=>{expect(()=>parseSurfaceModule(source)).toThrow();});
it("retains static edges inside actual type-cycle closure and rejects unavailable type/value",()=>{const {input,candidate}=syntheticSurface();const files=[{path:candidate.impl.entry,content:'import type { Item } from "./types.js"; export function Synthetic(value: Item) { return `${value.name}`; }'},{path:"sections/synthetic/types.ts",content:'import type { Synthetic } from "./Synthetic.js"; export interface Item { name: string }'}];const proof=analyzeSurfaceSource({fill:candidate,files,components:resolve(input).components,componentFiles:[],packages:[]});expect(proof.findings).toEqual(expect.arrayContaining([expect.objectContaining({code:"S4"})]));expect(proof.imports).toHaveLength(2);files[1]!.content='export interface Item { name: string }';expect(analyzeSurfaceSource({fill:candidate,files,components:resolve(input).components,componentFiles:[],packages:[]}).findings).toEqual([]);files[0]!.content=files[0]!.content.replace("import type","import");expect(analyzeSurfaceSource({fill:candidate,files,components:resolve(input).components,componentFiles:[],packages:[]}).findings.some(f=>f.code==="S4")).toBe(true);});
