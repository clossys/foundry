import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import ts from "typescript";
import { createLeafAnalyzer } from "./lib/surface-leaf-check.mjs";

function fixture(files, exported = "Surface") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(),"surface-leaves-"));
  for (const [name,content] of Object.entries(files)) { const file=path.join(root,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,content); }
  const program=ts.createProgram(Object.keys(files).map(name=>path.join(root,name)),{target:ts.ScriptTarget.ESNext,module:ts.ModuleKind.ESNext,moduleResolution:ts.ModuleResolutionKind.Bundler,jsx:ts.JsxEmit.ReactJSX});
  const source=program.getSourceFile(path.join(root,"surface.tsx"));
  const checker=program.getTypeChecker(), symbol=checker.getExportsOfModule(checker.getSymbolAtLocation(source)).find(row=>row.name===exported);
  const components=new Map();
  const componentSource=program.getSourceFile(path.join(root,"leaf.tsx"));
  if(componentSource)for(const declaration of componentSource.statements.filter(ts.isFunctionDeclaration))components.set(`${componentSource.fileName}:${declaration.pos}:${declaration.end}`,"components.button");
  const analyzer=createLeafAnalyzer({program,root,componentRoots:components,componentLeaves:new Set(["components.button","components.semantic-content"]),leafFactory:path.join(root,"component-leaf.tsx")});
  const result=analyzer.analyze(symbol.declarations);
  fs.rmSync(root,{recursive:true,force:true});
  return result;
}

test("follows aliased imports, re-exports, local closures and compound component references",()=>{
  const result=fixture({"leaf.tsx":"export function Button(){return <button/>}","barrel.ts":"export {Button as Action} from './leaf.js';","surface.tsx":"import {Action as Control} from './barrel.js'; function helper(){return <Control/>} export function Surface(){return helper()}"});
  assert.ok(result.findings.some(row=>row.rule==="direct-component-binding"&&row.componentLeaf==="components.button"));
  assert.ok(!result.findings.some(row=>row.file==="leaf.tsx"&&row.rule==="raw-interactive-element"),"registered leaf internals are separate ownership");
});
test("catches JSX, factory calls, roles and mixed token fallbacks through helpers",()=>{
  const result=fixture({"surface.tsx":"import {createElement as element} from 'react'; function helper(){return <div role='button' style={{color:'var(--ink, #ff0000)',width:'18px'}}><p>Copy</p></div>} export function Surface(){return <>{helper()}{element('button',null,'Go')}</>}"});
  for(const rule of ["raw-text-element","raw-interactive-element","color-literal","size-literal"])assert.ok(result.findings.some(row=>row.rule===rule),rule);
});
test("does not bless a component-looking local wrapper or vendor alias",()=>{
  const result=fixture({"surface.tsx":"import * as vendor from 'react-aria-components'; const ComponentLeaf=()=> <span>raw</span>; export function Surface(){return <><ComponentLeaf/><vendor.Button>Go</vendor.Button></>}"});
  assert.ok(result.findings.some(row=>row.rule==="raw-text-element"));
  assert.ok(result.findings.some(row=>row.rule==="vendor-import"&&row.detail==="react-aria-components"));
});
test("token references and structural layout do not count as authored literals",()=>{
  const result=fixture({"surface.tsx":"export function Surface({children}:{children:unknown}){return <section className='grid gap-frame' style={{width:'var(--region-width-content)'}}>{children}</section>}"});
  assert.deepEqual(result.findings,[]);
});
test("plain content records are not mistaken for CSS until a rendered style consumes them",()=>{
  const result=fixture({"surface.tsx":"const records=[{width:1280,color:'#ff0000'}];export function Surface(){return <div data-records={JSON.stringify(records)}/>}"});
  assert.deepEqual(result.findings,[]);
  const consumed=fixture({"surface.tsx":"const data={width:12,color:'#ff0000'};export function Surface(){return <div style={data}/>}"});
  assert.ok(consumed.findings.some(row=>row.rule==="size-literal"));
  assert.ok(consumed.findings.some(row=>row.rule==="color-literal"));
});
test("style property reads do not backtrack into sibling metadata or component API types",()=>{
  const result=fixture({"surface.tsx":"const data={css:{color:'var(--ink)'},metadata:{width:1280,color:'#ff0000'}};type API={readonly title:'18px'};export function Surface(){return <div style={data.css}/>}"});
  assert.deepEqual(result.findings,[]);
  const consumed=fixture({"surface.tsx":"const data={css:{color:'#ff0000'}};export function Surface(){return <div style={data.css}/>}"});
  assert.ok(consumed.findings.some(row=>row.rule==="color-literal"));
});
test("a forged leaf function in another module is scanned as ordinary code",()=>{
  const result=fixture({"fake.tsx":"export function componentLeaf(){return <input/>}","surface.tsx":"import {componentLeaf} from './fake.js'; export function Surface(){return componentLeaf()}"});
  assert.ok(result.findings.some(row=>row.rule==="raw-interactive-element"));
});
test("dynamic source names remain explicit findings",()=>{
  const result=fixture({"surface.tsx":"export function Surface(name:string){return import(name)}"});
  assert.ok(result.findings.some(row=>row.rule==="unresolved-render-source"));
});
test("resolves dynamic intrinsic aliases and aliased CSS values",()=>{
  const result=fixture({"surface.tsx":"const tag='button';const a={color:'#fedcba',width:'13px'};const b=a; export function Surface(){const Tag=tag;return <Tag style={b}/>}"});
  for(const rule of ["raw-interactive-element","color-literal","size-literal"])assert.ok(result.findings.some(row=>row.rule===rule),rule);
});
test("dynamic JSX from a literal union still exposes intrinsic text tags",()=>{
  const result=fixture({"surface.tsx":"export function Surface({as:Tag}:{as:'p'|'span'}){return <Tag>Copy</Tag>}"});
  assert.ok(result.findings.some(row=>row.rule==="raw-text-element"&&row.detail==="p"));
  assert.ok(result.findings.some(row=>row.rule==="raw-text-element"&&row.detail==="span"));
});
test("finds factory-only role controls and text through aliased tags",()=>{
  const result=fixture({"surface.tsx":"import {createElement as el} from 'react';const tag='div';const role='button'; export function Surface(){return el(tag,{role,onClick(){},style:{width:'14px'}},'Go')}"});
  for(const rule of ["raw-interactive-element","raw-text-content","size-literal"])assert.ok(result.findings.some(row=>row.rule===rule),rule);
});
test("finds rendered text expressions and numeric utility sizes without confusing layout ratios",()=>{
  const result=fixture({"surface.tsx":"const copy='Go';export function Surface(){return <div className='w-8 p-2 text-black'>{copy}<div className='w-1/2'/></div>}"});
  for(const rule of ["raw-text-content","size-literal","color-literal"])assert.ok(result.findings.some(row=>row.rule===rule),rule);
  assert.ok(!result.findings.some(row=>row.detail==="w-1/2"));
});
test("semantic content cannot conceal a control role or event handler",()=>{
  const result=fixture({"component-leaf.tsx":"export function componentLeaf(id:string):any{throw Error(id)}", "surface.tsx":"import {componentLeaf} from './component-leaf.js';const Content=componentLeaf('components.semantic-content');export function Surface(){return <Content as='div' role='button' onClick={()=>{}}>Go</Content>}"});
  assert.ok(result.findings.some(row=>row.rule==="raw-interactive-element"&&row.detail==="semantic-content.role"));
  assert.ok(result.findings.some(row=>row.rule==="raw-interactive-element"&&row.detail==="semantic-content.onClick"));
});
test("dynamic string and number content still require a text leaf",()=>{
  const result=fixture({"surface.tsx":"export function Surface({title,count}:{title:string,count:number}){return <div>{title}{count}</div>}"});
  assert.equal(result.findings.filter(row=>row.rule==="raw-text-content").length,2);
});
test("JSX factories and JSX spread aliases expose actual props without blessing unrelated local factories",()=>{
  const result=fixture({"surface.tsx":"import * as R from 'react';import {jsx as emit} from 'react/jsx-runtime';const p={role:'button',onClick(){},children:'Go'};function createElement(tag:string){return tag}export function Surface(){return <>{emit('div',p)}{R.createElement('button',null,'Go')}<div {...p}/>{createElement('button')}</>}"});
  assert.ok(result.findings.some(row=>row.rule==="raw-text-content"&&row.detail==="div factory children"));
  assert.ok(result.findings.some(row=>row.rule==="raw-interactive-element"&&row.detail==="div.role"));
  assert.equal(result.findings.filter(row=>row.rule==="raw-interactive-element"&&row.detail==="button").length,1);
});
