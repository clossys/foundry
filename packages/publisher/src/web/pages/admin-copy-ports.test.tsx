/** @vitest-environment jsdom */
import { expect, it, vi } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { surfaceRuntimeRenderers } from "@clossys/designer/frames";
import type { RuntimeRenderInput } from "@clossys/designer/catalog";
import type { ReactNode } from "react";
import { adminCopyFixture, copyEnvelopes, pages } from "./__fixtures__/copy.mjs";
import { prepareAdminPageCopyEnvelopes } from "./admin-copy-source.js";
import { adminPageContent, createAdminPageCopy, writerCopy } from "./admin-copy.js";
import { adminPageSectionHosts, ADMIN_CHAT_LABEL_KEYS } from "./admin-copy-ports.js";
import { createAdminPageRegistry } from "./admin-page.js";
import { createRegisteredPublicationSession } from "../registered-route-query.js";

function input(leaf: string, values: Record<string, unknown>, sectionHost?: Record<string, unknown>): RuntimeRenderInput<ReactNode> {
  return { fill:{leaf,slots:Object.keys(values),members:["part.message"]},selection:{leaf,members:leaf === "sections.chat"?["part.message"]:[]},cell:{state:"default"},content:Object.fromEntries(Object.entries(values).map(([key,value])=>[key,{value}])),sectionHost,slots:{} } as unknown as RuntimeRenderInput<ReactNode>;
}
it("renders Writer-bound item and empty-table copy through the selected native renderers", () => {
  const copy=adminCopyFixture(), title={id:"strings.admin.page.writer"};
  const fields=adminPageContent(copy,{kind:"records",ref:"item.fields"},[{label:writerCopy({id:"strings.admin.column.key"}),value:writerCopy(title)}]);
  const hosts=adminPageSectionHosts({copy,title,item:true,fields});
  const detail=renderToStaticMarkup(<>{surfaceRuntimeRenderers["sections.record-detail"]!.render(input("sections.record-detail",{fields:[],actions:[{id:"open",label:copy("strings.admin.action.openItem")}]},hosts["sections.record-detail"]))}</>);
  const empty=renderToStaticMarkup(<>{surfaceRuntimeRenderers["sections.data-table"]!.render(input("sections.data-table",{rows:[],columns:[{id:"key",label:copy("strings.admin.column.key")}]},hosts["sections.data-table"]))}</>);
  expect(detail).toContain(hosts["sections.record-detail"]!.recordDetail.title);
  expect(detail).toContain(copy("strings.admin.column.key"));
  expect(detail).not.toMatch(/Order #?1042/);
  expect(empty).toContain(copy("strings.admin.empty.title")); expect(empty).toContain(copy("strings.admin.empty.description"));
  expect(empty).not.toMatch(/No orders yet|customer checks out/);
  expect(hosts["sections.data-table"].paginationSummary({start:101,end:200,total:250,page:2,pageCount:3})).toBe(copy("strings.admin.pagination.range",{start:101,end:200,total:250}));
  expect(copy.provenance().some(value=>value.provenance.cellId === "strings.admin.item.heading")).toBe(true);
  expect(()=>adminPageSectionHosts({copy,title,item:true})).toThrow(/fields/);
});
it("mounts one native shared Chat with real Writer copy on all six route contexts", async () => {
  const sources=JSON.parse(JSON.stringify(copyEnvelopes()));
  const codeId=pages.aliases["strings.admin.chat.copyCodeLabel"];
  const codeSource=sources.find(source=>source.envelope.records.some(record=>record.id===codeId));
  codeSource.envelope.records.find(record=>record.id===codeId).text="Writer clipboard sentinel";
  for (const [key, text] of [["copiedLabel", "Writer copied sentinel"], ["copyUnavailableLabel", "Writer unavailable sentinel"]]) {
    const id = pages.aliases[`strings.admin.chat.${key}`];
    sources.find(source => source.envelope.records.some(record => record.id === id)).envelope.records.find(record => record.id === id).text = text;
  }
  const copy=createAdminPageCopy({locale:"en",envelopes:prepareAdminPageCopyEnvelopes(sources)});
  const skeleton={l0:[{id:"strings",label:{id:"strings.admin.group.writer.strings"},count:0,estimate:100,l1:[]}]};
  const result=createAdminPageRegistry({copy,publication:{id:"admin",mainSlot:"body",frame:{leaf:"frames.app-shell"},layout:{leaf:"layouts.stack",config:"stack.workspace"},format:"web.page.responsive",surface:"app",context:{consumer:"example",medium:"web"},packIds:[]},manifests:{designer:skeleton,writer:skeleton,publisher:skeleton}});
  let view: ReturnType<typeof render> | undefined;
  const host={bind:vi.fn(publication=>{
    expect(publication.inspector.section).toBe("sections.chat");
    view=render(<>{surfaceRuntimeRenderers["sections.chat"]!.render(input("sections.chat",{parts:[{id:"code",role:"assistant",content:"```\nconst value = 1;\n```"}],composer:{}},result.publicationHosts["sections.chat"]))}</>);
  }),setRegions:vi.fn(),setState:vi.fn(),setCommands:vi.fn(),setChunks:vi.fn()};
  const publication=createRegisteredPublicationSession(result.registry.publication!,host);
  let original: HTMLElement | undefined;
  for(const route of result.registry.routes){
    publication.activate(route.routeId); publication.setPage({routeId:route.routeId,trail:{title:route.title},regions:{main:[],"page-module":[]},inspectorContext:{routeId:route.routeId}});
    const chat=view!.getByRole("region",{name:result.publicationHosts["sections.chat"].chatCopy.label});
    original??=chat; expect(chat).toBe(original);
    expect(view!.getByRole("button",{name:"Writer clipboard sentinel"})).toBeTruthy();
  }
  expect(host.bind).toHaveBeenCalledTimes(1); expect(host.setRegions).toHaveBeenCalledTimes(6);
  const previousClipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");
  const writeText = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("fixture clipboard unavailable"));
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  try {
    fireEvent.click(view!.getByRole("button", { name: "Writer clipboard sentinel" }));
    expect(await view!.findByText("Writer copied sentinel")).toBeTruthy();
    fireEvent.click(view!.getByRole("button", { name: "Writer clipboard sentinel" }));
    expect(await view!.findByText("Writer unavailable sentinel")).toBeTruthy();
  } finally {
    if (previousClipboard) Object.defineProperty(navigator, "clipboard", previousClipboard);
    else Reflect.deleteProperty(navigator, "clipboard");
  }
  for(const key of ADMIN_CHAT_LABEL_KEYS) expect(copy.provenance().some(value=>value.provenance.cellId===`strings.admin.chat.${key}`)).toBe(true);
  const missing=JSON.parse(JSON.stringify(result.publicationHosts["sections.chat"]));delete missing.chatCopy.labels.copyCodeLabel;
  expect(()=>surfaceRuntimeRenderers["sections.chat"]!.render(input("sections.chat",{parts:[],composer:{}},missing))).toThrow(/copyCodeLabel/);
  cleanup();
});
