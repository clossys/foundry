import * as React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import * as Aria from "react-aria-components";
import * as Designer from "../components/index.js";
import * as Server from "../components/server.js";
import { beforeAll, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { act, createElement, type ComponentType } from "react";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { consumedInputFixture, consumedInputLeaves } from "../catalog-core/__fixtures__/consumed-inputs.js";
import { TextField } from "../components/text-field/index.js";
import { SearchField } from "../components/search-field/index.js";
import { TagGroup } from "../components/tag-group/index.js";
import { Toolbar } from "../components/toolbar/index.js";
import { Link } from "../components/link/index.js";
import { NativeAction } from "../components/native-action/index.js";
import { StatusMark } from "../components/status-mark/status-mark.js";
import { GridList } from "../components/grid-list/grid-list.js";
import { Toaster, toast } from "../components/toast/sonner.js";
import { emitComponents } from "../catalog-core/emit-components.js";
import { componentOf } from "../catalog-core/resolve-components.js";

const fixture=consumedInputFixture();
fixture.profile.packageExports = {react:Object.keys(React),"react/jsx-runtime":Object.keys(jsxRuntime),"react-aria-components":Object.keys(Aria),"@clossys/designer/components":Object.keys(Designer),"@clossys/designer/components/server":Object.keys(Server)};
const writer=JSON.parse(readFileSync(join(import.meta.dirname,"../../../writer/src/catalog/records/admin-studio.r1.en.json"),"utf8"));
const copy=(ref:{id:string})=>({ref,text:writer.records.find((row:{id:string})=>row.id===ref.id)!.text});
beforeAll(()=>{Object.defineProperty(window,"matchMedia",{configurable:true,value:()=>({matches:false,addEventListener(){},removeEventListener(){}})});});

it("adopts the entire consumed input and feedback closure through the real planner and apply path",()=>{
  expect(fixture.plan.findings).toEqual([]);
  expect(fixture.plan.rows.every(row=>row.status==="default")).toBe(true);
  for(const leaf of consumedInputLeaves) {
    const row=fixture.plan.rows.find(row=>row.slot===`components.${leaf}`)!;
    expect(row,leaf).toMatchObject(leaf==="native-action"?{rule:"compose:native-action@1"}:{source:"shadcn@aria"});
    expect(fixture.profile.components[row.slot],leaf).toBeDefined();
  }
  expect(fixture.profile.check.ok).toBe(true);
  expect(fixture.profile.check.findings.filter(row=>row.severity==="error")).toEqual([]);
  const glyphs=Object.fromEntries(Object.values(fixture.resolvedValues.members).filter(row=>row.slot.startsWith("assets.icon-")).map(row=>[row.slot,row.value.light]));
  const emitted=emitComponents(fixture.profile,["component-index"],{glyphModule:{path:"adapters/glyphs.ts",glyphs}});
  expect(emitted.some(file=>file.path==="components/text-field/index.ts")).toBe(true);
  for(const leaf of ["field","form","number-field","date-field","date-picker","spinner"]) expect(fixture.profile.components[`components.${leaf}`]).toBeUndefined();
});

it("edits single-line and multiline text with real accessible labels",async()=>{
  const user=userEvent.setup(),change=vi.fn();render(<TextField label="Subject" onChange={change}/>);
  await user.type(screen.getByRole("textbox",{name:"Subject"}),"Draft");expect(change).toHaveBeenLastCalledWith("Draft");
  render(<TextField label="Body" line="multiline"/>);expect(screen.getByRole("textbox",{name:"Body"}).tagName).toBe("TEXTAREA");
});

it("resolves Writer-backed search chrome and clears through RAC's clear slot",async()=>{
  const user=userEvent.setup(),change=vi.fn();render(<SearchField label="Find" defaultValue="Draft" copy={copy} onChange={change}/>);
  await user.click(screen.getByRole("button",{name:copy({id:"st.kcathn07y7"}).text}));expect(screen.getByRole("searchbox",{name:"Find"})).toHaveValue("");expect(change).toHaveBeenLastCalledWith("");
});

it("removes tags through the peer and keeps host labels",async()=>{
  const user=userEvent.setup(),remove=vi.fn();render(<TagGroup label="Filters" items={[{id:"one",label:"Open"}]} removable copy={copy} onRemove={remove}/>);
  await user.click(screen.getByRole("button",{name:`${copy({id:"st.cxp8286800"}).text} Open`}));expect(remove).toHaveBeenCalled();
});

it("keeps toolbar orientation and link classes in their actual native roles",()=>{
  render(<Toolbar aria-label="Actions" orientation="vertical"><Link href="/draft" className="resting">Draft</Link></Toolbar>);
  expect(screen.getByRole("toolbar",{name:"Actions"})).toHaveAttribute("aria-orientation","vertical");expect(screen.getByRole("link",{name:"Draft"})).toHaveAttribute("href","/draft");expect(screen.getByRole("link")).toHaveClass("resting");
});

it("keeps native submit behavior and rejects client-engine props",()=>{
  const click=vi.fn();render(<NativeAction type="submit" onClick={click}>Save</NativeAction>);fireEvent.click(screen.getByRole("button",{name:"Save"}));expect(click).toHaveBeenCalledOnce();expect(screen.getByRole("button")).toHaveAttribute("type","submit");
  expect(()=>NativeAction({type:"button",onPress:()=>{}} as never)).toThrow("onPress");expect(()=>NativeAction({children:"Save"} as never)).toThrow("explicit native button type");
});

it("exposes status shapes and selection actions without a second collection engine",async()=>{
  const user=userEvent.setup(),action=vi.fn();render(<StatusMark tone="neutral">Queued</StatusMark>);expect(screen.getByText("Queued")).toBeInTheDocument();
  render(<GridList aria-label="Records" onAction={action}><GridList.Item id="one" textValue="Draft">Draft</GridList.Item></GridList>);
  await user.click(screen.getByRole("row",{name:"Draft"}));expect(action).toHaveBeenCalled();
});

it("draws and dismisses a real queued toast with Writer chrome",async()=>{
  const user=userEvent.setup();render(<Toaster copy={copy}/>);act(()=>{toast.info("Saved");});expect(await screen.findByText("Saved")).toBeInTheDocument();await user.click(screen.getByRole("button",{name:copy({id:"st.5t6kmpqx5k"}).text}));expect(screen.queryByText("Saved")).not.toBeInTheDocument();
});

it("executes the materialized native source through the real public server helper and package implementation",()=>{
  const descriptor=componentOf(fixture.adopted.components.fills.find(doc=>componentOf(doc).slot==="components.native-action")!);
  expect(descriptor.rac).toBeUndefined();
  const result=JSON.parse(execFileSync(process.execPath,["--input-type=module","-e",`
    import {readFileSync,mkdtempSync,mkdirSync} from 'node:fs';import {resolve,posix,join} from 'node:path';import {pathToFileURL} from 'node:url';import {build} from 'esbuild';import {createElement} from 'react';import {renderToStaticMarkup} from 'react-dom/server';
    const input=JSON.parse(readFileSync(0,'utf8')),files=new Map(input.files.map(file=>[file.path,file.content]));mkdirSync('node_modules/.cache',{recursive:true});const outfile=resolve(mkdtempSync('node_modules/.cache/native-consumer-'),'source.mjs');
    const built=await build({entryPoints:[input.entry],outfile,bundle:true,format:'esm',platform:'node',jsx:'automatic',metafile:true,packages:'external',plugins:[{name:'consumer',setup(b){b.onResolve({filter:/^components\\//},args=>({path:args.path,namespace:'consumer'}));b.onResolve({filter:/^\\./,namespace:'consumer'},args=>{const base=posix.normalize(posix.join(posix.dirname(args.importer),args.path));const path=[base,base+'.ts',base+'.tsx',base+'/index.ts'].find(path=>files.has(path));if(!path)throw Error('Missing '+base);return {path,namespace:'consumer'};});b.onLoad({filter:/.*/,namespace:'consumer'},args=>({contents:files.get(args.path),loader:'tsx',resolveDir:process.cwd()}));}}]});
    const source=await import(pathToFileURL(outfile));const local=await import(pathToFileURL(resolve('dist/components/native-action/native-action.js')));const props={type:'button',className:'px-md px-lg',children:'Save'};const actual=renderToStaticMarkup(createElement(source.NativeAction,props)),expected=renderToStaticMarkup(createElement(local.NativeAction,props));
    const graph=await build({entryPoints:[resolve('dist/components/server.js')],bundle:true,write:false,format:'esm',platform:'node',packages:'external',metafile:true,logLevel:'silent'});
    process.stdout.write(JSON.stringify({actual,expected,imports:Object.values(built.metafile.outputs).flatMap(row=>row.imports.map(x=>x.path)),serverGraph:Object.keys(graph.metafile.inputs),serverImports:Object.values(graph.metafile.outputs).flatMap(row=>row.imports.map(x=>x.path))}));
  `],{cwd:join(import.meta.dirname,"../.."),input:JSON.stringify({entry:descriptor.impl.kind==="source"?descriptor.impl.entry:"",files:fixture.adopted.components.files}),encoding:"utf8"}));
  expect(result.actual).toBe(result.expected);expect(result.actual).toContain("<button");expect(result.imports).toContain("@clossys/designer/components/server");expect([...result.serverGraph,...result.serverImports].some((path:string)=>/react-aria|react-stately/.test(path))).toBe(false);
});
