import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { runtimeHash, type RuntimeRenderInput, type RuntimeJson } from "../../catalog-core/runtime-ports.js";
import { renderArticleSection } from "./article.js";
import { renderTableOfContents } from "./table-of-contents.js";

/** Actual generated descriptor keys, not an invented permissive member/slot fixture. */
function input(leaf: "article" | "table-of-contents", values: Record<string, RuntimeJson>, members: readonly string[] = []): RuntimeRenderInput<ReactNode> {
  const doc=JSON.parse(readFileSync(resolve(import.meta.dirname, `../../catalog/fills/foundry/sections.${leaf}.json`),"utf8"));
  const descriptor=doc.sections[leaf];
  const source={entry:"index.ts",files:{"index.ts":"export {};\n"},dependencies:{}};
  const content=Object.fromEntries(Object.entries(values).map(([key,value])=>[key,{value,reference:{kind:"region" as const,ref:key},hash:runtimeHash(value)}]));
  return {path:"sections.main.0",fill:{kind:"section",library:"foundry",fill:doc.$extensions["com.clossys.fill"].id,leaf:`sections.${leaf}`,config:null,slots:Object.keys(descriptor.slotMap),members:Object.keys(descriptor.propMap),states:["default"],renderer:{id:`package:sections.${leaf}`,source,sourceHash:runtimeHash(source)}},selection:{leaf:`sections.${leaf}`,fill:doc.$extensions["com.clossys.fill"].id,config:null,members,content:Object.fromEntries(Object.entries(content).map(([key,row])=>[key,row.reference]))},cell:{theme:"light",state:"default",width:1280},content,slots:{},profile:{} as RuntimeRenderInput<ReactNode>["profile"]};
}
const body: RuntimeJson = [
  {kind:"heading",id:"overview",level:2,text:"Overview"},
  {kind:"paragraph",text:"Example body."},
  {kind:"pull-quote",text:"Example quote.",items:["Example attribution"]},
  {kind:"figure-caption",text:"Example caption."},
  {kind:"footnote-reference",text:"1",id:"ref-one",noteId:"note-one"},
  {kind:"footnotes",text:"Notes",items:["Example note."],references:[{id:"note-one",referenceId:"ref-one"}]},
];
describe("generated article and TOC adapter bindings",()=>{
  it("selects the real drop-cap member and renders every editorial kind through its native part",()=>{
    const value=input("article",{body},["typography.drop-cap"]);
    expect(value.fill.members).toContain("typography.drop-cap");
    const html=renderToStaticMarkup(renderArticleSection(value));
    const root=document.createElement("div");root.innerHTML=html;
    expect(root.querySelector("blockquote")).toHaveTextContent("Example quote.");
    expect(root.querySelector("figcaption")).toHaveTextContent("Example caption.");
    expect(root.querySelector('[data-footnote-reference]')).toHaveAttribute("href","#note-one");
    expect(root.querySelector('[data-footnote-backlink]')).toHaveAttribute("href","#ref-one");
    expect(root.querySelector("article")?.className).toContain("first-letter");
  });
  it("refuses unknown members, slots and mismatched footnote metadata without dropping data",()=>{
    expect(()=>renderArticleSection(input("article",{body},["typography.unknown"]))).toThrow(/not mapped/);
    expect(()=>renderArticleSection(input("article",{body,unexpected:"Example"}))).toThrow(/not mapped/);
    expect(()=>renderToStaticMarkup(renderArticleSection(input("article",{body:[{kind:"footnotes",text:"Notes",items:["One"],references:[]}]})))).toThrow(/references/);
  });
  it("maps the generated CSS tracking member without an observer and requires the Writer-authored label",()=>{
    const values={label:"Contents",headings:[{id:"overview",label:"Overview"},{id:"details",label:"Details"}]};
    const value=input("table-of-contents",values,["tracking.css"]);
    expect(value.fill.members).toContain("tracking.css");
    const observer=vi.fn();vi.stubGlobal("IntersectionObserver",observer);
    try{const view=render(renderTableOfContents(value));expect(observer).not.toHaveBeenCalled();expect(view.getByRole("link",{name:"Details"})).toHaveAttribute("href","#details");expect(view.container.querySelector("style")?.textContent).toContain("animation-timeline:");}finally{vi.unstubAllGlobals();}
    expect(()=>renderTableOfContents(input("table-of-contents",{headings:values.headings},["tracking.css"]))).toThrow(/host label/);
  });
});
