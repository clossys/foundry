// @vitest-environment node
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Hero } from "@clossys/designer/blocks/server";
import { SiteFrame, surfaceRuntimeRenderers } from "@clossys/designer/frames";
import type { RuntimeJson, RuntimeRenderInput } from "@clossys/designer/catalog";
import { STANDARD_WEBSITE_INSTANCES, validateInstanceRecord } from "../core/index.js";
import { SectionedView } from "./index.js";

const content = (values: Record<string, RuntimeJson>) => Object.fromEntries(Object.entries(values).map(([slot, value]) => [slot, {
  reference: { kind: "region", ref: `example:${slot}` }, value, hash: "sha256:0",
}]));
function heroNode(members: readonly string[] = ["size.display"]): ReactNode {
  return surfaceRuntimeRenderers["sections.hero"]!.render({
    fill: { leaf: "sections.hero", slots: ["header"], members },
    selection: { leaf: "sections.hero", members }, content: content({ header: { heading: "Native home" } }),
  } as unknown as RuntimeRenderInput<ReactNode>);
}
function shellInput(main: ReactNode, overlay = true): RuntimeRenderInput<ReactNode> {
  return {
    fill: { leaf: "frames.site-shell" }, slots: { main: [main] },
    selection: { leaf: "frames.site-shell", members: [overlay ? "footer-placement.overlay" : "footer-placement.flow"] },
    content: content({
      "skip-link": "Skip to content",
      header: { brand: { label: "Example home", mark: { src: "/mark.svg", width: 32, height: 32 } }, surface: "glass", tone: "inverse" },
      footer: { legal: { entity: "Example", links: [] } },
    }),
  } as unknown as RuntimeRenderInput<ReactNode>;
}
const frame = (main: ReactNode, overlay = true) => surfaceRuntimeRenderers["frames.site-shell"]!.render(shellInput(main, overlay));
const html = (main: ReactNode, overlay = true) => renderToStaticMarkup(<>{frame(main, overlay)}</>);

describe("native site-shell after Landing retirement", () => {
  it("keeps the registered Designer frame and Hero renderer identities with the existing native Pack body", () => {
    expect((frame(heroNode()) as ReactElement).type).toBe(SiteFrame);
    expect((heroNode() as ReactElement).type).toBe(Hero);
    const home = STANDARD_WEBSITE_INSTANCES.find(row => row.instanceId === "standard.home")!;
    expect(home.frameBlockRef).toEqual({ blockId: "SiteFrame", configId: "site" });
    expect(home.viewBlockRef).toEqual({ blockId: "SectionedView", configId: "home" });
    expect(SectionedView).toBeTypeOf("function");
    expect(validateInstanceRecord({ ...home, viewBlockRef: { blockId: "LandingView", configId: "home" } })).toMatchObject({ status: "refused", reason: "view" });
  });

  it("renders one native hero and one set of landmarks with intrinsic footer reservation", () => {
    const output = html(heroNode());
    for (const tag of ["header", "main", "footer", "h1"]) expect(output.match(new RegExp(`<${tag}\\b`, "g"))).toHaveLength(1);
    expect(output).toContain("Native home");
    expect(output).toContain('data-ds-leaf="frames.site-shell"');
    expect(output).toMatch(/<main[^>]*><section[^>]*data-ds-leaf="sections.hero"[^>]*class="[^"]*flex-1/);
    expect(output).toMatch(/data-frame-footer-overlay=""[^>]*class="[^"]*shrink-0/);
    expect(output).toContain('href="#publisher-main-content"');
    expect(output).not.toMatch(/data-landing-|height:100dvh/);
    expect(output.indexOf("</main>")).toBeLessThan(output.indexOf("<footer"));
    expect(html(heroNode(), false)).not.toContain("data-frame-footer-overlay");
  });

  it("refuses stamped markup, wrappers, fragments and multiple children before evaluating them", () => {
    let invoked = false;
    function Wrapper() { invoked = true; return <Hero heading="Wrapped" />; }
    const native = heroNode();
    for (const body of [
      <section data-ds-leaf="sections.hero"><h1>Spoofed</h1></section>,
      <Wrapper />, <>{native}</>, [native, <Hero key="second" heading="Second" />],
    ]) expect(() => html(body)).toThrow(/shell\.footer\.placement/);
    expect(invoked).toBe(false);
  });

  it.each([
    { size: "compact" }, { size: "standard" }, { headingLevel: 2 }, { heading: " " },
    { children: <p>Extra</p> }, { className: "h-dvh" }, { style: { height: "100dvh" } },
    { callToAction: { heading: "Extra" } }, { trailing: [] }, { afterSection: {} },
  ])("refuses unsupported native overlay geometry or extra body props %#", extra => {
    expect(() => html(createElement(Hero, { heading: "Native home", ...extra } as never))).toThrow(/shell\.footer\.placement/);
  });

  it("removes executable Landing sources and keeps native frame/section registration", () => {
    for (const name of ["LandingView.tsx", "LandingView.server.tsx", "LandingViewContent.tsx"]) {
      expect(existsSync(new URL(`../../../designer/src/frames/site-frame/landing/web/views/${name}`, import.meta.url))).toBe(false);
    }
    for (const file of ["index.ts", "server.ts"]) {
      const source = readFileSync(new URL(`../../../designer/src/frames/${file}`, import.meta.url), "utf8");
      expect(source).not.toMatch(/(?:export|import).*\b(?:LandingView|ServerLandingView)\b/);
    }
    expect(Object.keys(surfaceRuntimeRenderers)).toEqual(expect.arrayContaining(["frames.site-shell", "sections.hero"]));
  });

  it("imports the real react-server entries and evaluates the registered native Hero through the frame guard", () => {
    const script = `
      import { createElement } from "react";
      import * as frames from "@clossys/designer/frames";
      import * as web from "@clossys/publisher/web";
      import { Hero } from "@clossys/designer/blocks/server";
      const content = values => Object.fromEntries(Object.entries(values).map(([key,value])=>[key,{value}]));
      const delegated = frames.surfaceRuntimeRenderers["sections.hero"].render({
        fill:{leaf:"sections.hero",slots:["header"],members:["size.display"]},
        selection:{leaf:"sections.hero",members:["size.display"]},content:content({header:{heading:"RSC native home"}})
      });
      const hero = createElement(Hero, { heading: "RSC native home" });
      const input = {
        fill:{leaf:"frames.site-shell"},slots:{main:[hero]},selection:{leaf:"frames.site-shell",members:["footer-placement.overlay"]},
        content:content({"skip-link":"Skip to content",header:{brand:{label:"Example home",mark:{src:"/mark.svg",width:32,height:32}},surface:"glass"},footer:{legal:{entity:"Example",links:[]}}})
      };
      const element = frames.surfaceRuntimeRenderers["frames.site-shell"].render(input);
      const tree = element.type(element.props);
      function find(node) {
        if (Array.isArray(node)) return node.flatMap(find);
        if (!node || typeof node !== "object") return [];
        return [...(node.type === Hero ? [node] : []),...find(node.props?.children)];
      }
      const selected = find(tree);
      const tags=[]; const text=[];
      function evaluate(node) {
        if (Array.isArray(node)) return node.forEach(evaluate);
        if (typeof node === "string") { text.push(node); return; }
        if (!node || typeof node !== "object") return;
        if (typeof node.type === "function") return evaluate(node.type(node.props));
        if (typeof node.type === "string") tags.push(node.type);
        evaluate(node.props?.children);
      }
      selected.forEach(evaluate);
      console.log(JSON.stringify({designerLanding:"LandingView" in frames,serverLanding:"ServerLandingView" in frames,publisherLanding:"LandingView" in web,
        registered:hero.type===Hero,sectionClientBoundary:delegated.type?.$$typeof===Symbol.for("react.lazy"),siteFrame:element.type===frames.SiteFrame,heroes:selected.length,grows:selected[0]?.props.className.includes("flex-1"),tags,text}));
    `;
    const result = JSON.parse(execFileSync(process.execPath, ["--conditions=react-server", "--input-type=module", "-e", script], { cwd: process.cwd(), encoding: "utf8" }));
    expect(result).toMatchObject({ designerLanding: false, serverLanding: false, publisherLanding: false, registered: true, sectionClientBoundary: true, siteFrame: true, heroes: 1, grows: true });
    expect(result.tags.filter((tag: string) => tag === "h1")).toHaveLength(1);
    expect(result.text).toContain("RSC native home");
  }, 20_000);
});
