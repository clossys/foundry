// @vitest-environment jsdom
import { createCopyResolver, type CopyRegistry } from "@clossys/writer";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { resolveSectionedViewDocument, validateSectionedViewDocument, type SectionedViewDocument } from "../../core/sectioned-view.js";
import { SectionedView } from "./SectionedView.js";
import { SectionedView as ServerSectionedView } from "./SectionedView.server.js";
import { assertRenderableSectionedViewDocument } from "./SectionedViewContent.js";
const copy = { heading: "Example heading", first: "First question", second: "Second question", third: "Third question", fourth: "Fourth question", detail: "A short answer.", link: "Read more" };
const ref = (key: keyof typeof copy) => ({ id: `compatibility.${key}` });
const registry = { id: "compatibility", revision: "1", locale: "en", source: { kind: "consumer", reference: "test" }, entries: Object.entries(copy).map(([key,text])=>({ id: `compatibility.${key}`, text, context: "Compatibility fixture", status: "approved" })) } satisfies CopyRegistry;
const resolver = createCopyResolver(registry);
const authored = (disclosed: boolean): SectionedViewDocument => ({ id: "compatibility", sections: [{ id: "hero", kind: "hero", ground: "inverse", heading: ref("heading") }, { id: "topics", kind: "content-section", heading: ref("heading"), block: { type: "items", recipe: disclosed ? "faq" : "topics", items: (["first","second","third","fourth"] as const).map(id=>({ id, heading: ref(id), description: ref("detail") })) } }] });
describe("canonical content anatomy compatibility", () => {
  it("renders current disclosed items with ordinary and server disclosure semantics", () => {
    const input=authored(true);expect(validateSectionedViewDocument(input)).toEqual([]);const resolved=resolveSectionedViewDocument(input,resolver);expect(()=>assertRenderableSectionedViewDocument(resolved)).not.toThrow();
    for(const [View,server] of [[SectionedView,false],[ServerSectionedView,true]] as const) {
      const host=document.createElement("div");host.innerHTML=renderToStaticMarkup(<View document={resolved}/>);
      expect(host.querySelectorAll(server ? "summary" : "button")).toHaveLength(4);expect(host.querySelector("[data-rac]")!==null).toBe(!server);expect(host.querySelector("summary")!==null).toBe(server);
      for(const text of Object.values(copy).slice(1,6))expect(host.textContent).toContain(text);
    }
  });
  it("refuses retired raw blocks at the precise boundary rather than rendering them through compatibility", () => {
    const resolved=resolveSectionedViewDocument(authored(false),resolver);const section=resolved.sections[1]!;if(section.kind!=="content-section")throw new Error("Expected content section");
    const retired={...resolved,sections:[{...section,block:{type:"topic-list",columns:1,items:[{id:"one",heading:copy.first},{id:"two",heading:copy.second}]}}]};
    expect(()=>assertRenderableSectionedViewDocument(retired)).toThrow(/sections\.0\.block\.type.*topic-list is retired; use the topics recipe on items/);
    const missing={...resolved,sections:[{id:section.id,kind:section.kind,ground:section.ground,heading:section.heading,block:section.block}]};
    expect(()=>assertRenderableSectionedViewDocument(missing)).toThrow(/sections\.0\.size must be an explicit resolved axis/);
  });
});
