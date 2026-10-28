// @vitest-environment jsdom
import { createCopyResolver, type CopyRegistry } from "@clossys/writer";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { resolveSectionedViewDocument, validateSectionedViewDocument, type SectionedViewDocument } from "../../core/sectioned-view.js";
import { LandingView } from "@clossys/designer/frames";
import { ServerLandingView as ServerLandingView } from "@clossys/designer/frames";
import { assertRenderableSectionedViewDocument } from "./SectionedViewContent.js";
const copy = { heading: "Example heading", first: "First question", second: "Second question", third: "Third question", fourth: "Fourth question", detail: "A short answer.", link: "Read more" };
const ref = (key: keyof typeof copy) => ({ id: `compatibility.${key}` });
const registry = { id: "compatibility", revision: "1", locale: "en", source: { kind: "consumer", reference: "test" }, entries: Object.entries(copy).map(([key,text])=>({ id: `compatibility.${key}`, text, context: "Compatibility fixture", status: "approved" })) } satisfies CopyRegistry;
const resolver = createCopyResolver(registry);
const authored = (disclosed: boolean): SectionedViewDocument => ({ id: "compatibility", sections: [{ id: "hero", kind: "hero", ground: "inverse", heading: ref("heading") }, { id: "topics", kind: "content-section", heading: ref("heading"), block: { type: "items", recipe: disclosed ? "faq" : "topics", items: (["first","second","third","fourth"] as const).map(id=>({ id, heading: ref(id), description: ref("detail") })) } }] });
describe("canonical content anatomy compatibility", () => {
  it("renders current unordered topics in their own band through both entries", () => {
    const input=authored(false);expect(validateSectionedViewDocument(input)).toEqual([]);const resolved=resolveSectionedViewDocument(input,resolver);
    resolved.sections = resolved.sections.map(section => section.id === "topics" ? { ...section, ground: "sunken" as const } : section); resolved.viewGrounds = resolved.viewGrounds?.filter(id => id !== "topics");
    for(const View of [LandingView,ServerLandingView]) {
      const host=document.createElement("div");host.innerHTML=renderToStaticMarkup(<View document={resolved} header="reserved" peek={false} afterSection={{ topics: <p data-after="">After content</p> }} />);
      const topics=host.querySelector("#topics")!;expect(topics.matches("[data-content-section]")).toBe(true);expect(topics.parentElement?.closest("[data-content-section]")).toBeNull();
      const frame=topics.closest("[data-landing-ground]") as HTMLElement;expect(frame.getAttribute("data-landing-ground")).toBe("sunken");expect(["0","0px"]).toContain(frame.style.paddingBlock);
      expect(topics.querySelectorAll("h3")).toHaveLength(4);for(const text of Object.values(copy).slice(1,5))expect(topics.textContent).toContain(text);
      expect(topics.querySelector("[data-after]")?.textContent).toBe("After content");
    }
  });
  it("renders current disclosed items with ordinary and server disclosure semantics", () => {
    const input=authored(true);expect(validateSectionedViewDocument(input)).toEqual([]);const resolved=resolveSectionedViewDocument(input,resolver);expect(()=>assertRenderableSectionedViewDocument(resolved)).not.toThrow();
    for(const [View,server] of [[LandingView,false],[ServerLandingView,true]] as const) {
      const host=document.createElement("div");host.innerHTML=renderToStaticMarkup(<View document={resolved} header="reserved" peek={false}/>);
      expect(host.querySelectorAll(server ? "summary" : "button")).toHaveLength(4);expect(host.querySelector("[data-rac]")!==null).toBe(!server);expect(host.querySelector("summary")!==null).toBe(server);
      for(const text of Object.values(copy).slice(1,6))expect(host.textContent).toContain(text);
    }
  });
  it("keeps quiet actions unfilled in the split text column and appends consumer content after the block", () => {
    const input: SectionedViewDocument = { ...authored(false), sections: [authored(false).sections[0]!, { id:"split",kind:"content-section",layout:"split-end",heading:ref("heading"),actions:[{id:"more",label:ref("link"),href:"/more",emphasis:"quiet"}],block:{type:"items",arrangement:"rows",items:[{id:"first",heading:ref("first")},{id:"second",heading:ref("second")}]},media:{type:"specimen",label:ref("heading"),panel:{id:"record",title:ref("heading"),parts:[{id:"fields",type:"fields",items:[{id:"one",label:ref("first"),value:ref("second")}] }]}} }] };
    const findings = validateSectionedViewDocument(input); expect(findings, JSON.stringify(findings)).toEqual([]); const resolved=resolveSectionedViewDocument(input,resolver);
    for(const View of [LandingView,ServerLandingView]) {
      const host=document.createElement("div");host.innerHTML=renderToStaticMarkup(<View document={resolved} header="reserved" peek={false} afterSection={{split:<p data-after="">After content</p>}}/>);
      const split=host.querySelector("#split")!;const action=split.querySelector<HTMLElement>('[data-content-section-text] a[href="/more"]')!;
      expect(action.getAttribute("data-action-emphasis")).toBe("quiet");expect(action.className.split(" ")).toEqual(expect.arrayContaining(["text-body","text-control-quiet","quiet-action"]));expect(action.className.split(" ")).not.toContain("underline");
      const modules=split.querySelector("[data-content-section-modules]")!;expect(modules.lastElementChild?.hasAttribute("data-after")).toBe(true);expect(modules.querySelector("[data-items]")).not.toBeNull();expect(split.getAttribute("data-layout")).toBe("split-end");
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
