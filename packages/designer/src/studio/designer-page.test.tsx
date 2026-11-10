import { renderToString as renderToStringBare } from "react-dom/server";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { checkWiring, type WiringSource } from "../catalog-core/wiring.js";
import { expect, it } from "vitest";
import { AppFrame } from "../frames/AppFrame.js";
import { Studio } from "./Studio.js";
import { labels, smallCatalog, emptyLibrary } from "./__fixtures__/studio.js";
import { studioHostCopy } from "./__fixtures__/copy-hand-roll.js";
import { hostedMarkup } from "../frames/__fixtures__/shell-copy.js";
const renderToString = hostedMarkup(renderToStringBare);
it("mounts only the vertical scroll of boards and its right rail on the existing Studio entry", () => {
  const html = renderToString(<AppFrame brand={{markSrc:"/mark.svg",wordmark:"Example",label:"Home"}} navigation={{tree:[]}} account={{signedOutLabel:"Account",sections:[]}} commands={{heading:"Commands",triggerLabel:"Search",searchLabel:"Search commands",closeLabel:"Close",emptyMessage:"No commands",groups:[]}}><Studio catalog={smallCatalog} adapter={{ load: async () => ({ library: emptyLibrary() }) }} labels={labels} copy={studioHostCopy} /></AppFrame>);
  const host = document.createElement("div"); host.innerHTML = html;
  expect(host.querySelectorAll("[data-application-frame]")).toHaveLength(1);
  expect(host.querySelectorAll("main")).toHaveLength(1);
  expect(host.querySelectorAll("section[data-designer-region=scroll]")).toHaveLength(1);
  expect(host.querySelectorAll("[data-studio-world][data-designer-scroll]")).toHaveLength(1);
  // R2F-19: the canvas, its map and its zoom are retired; nothing canvas-shaped mounts.
  expect(host.querySelector("[data-system-canvas], section[data-designer-region=canvas], [data-canvas-world]")).toBeNull();
  expect([...host.querySelectorAll<HTMLElement>("[data-studio-rail-card]")].map(card=>card.dataset.studioRailCard)).toEqual(["explorer","checks"]);
  expect(host.querySelector('[data-studio-rail-card=checks] [aria-expanded]')).toHaveAttribute("aria-expanded","false");
  expect(host.querySelector("[data-frame-module]")).toBeNull();
  expect(host.querySelectorAll("[data-studio-rail]")).toHaveLength(1);
  expect(host.querySelector('[role="tablist"], [data-frame-slot="dock-strip"]')).toBeNull();
});

it("checks the complete Designer page source closure for WL1, WL6, WL10 and raw values",()=>{
  const files=["src/studio/DesignerPage.tsx","src/studio/canvas-boards.tsx","src/studio/studio-url.ts"].map(path=>resolve(process.cwd(),path));
  const sources:WiringSource[]=files.map(path=>({path,content:readFileSync(path,"utf8"),layer:"sections"}));
  expect(sources.some(s=>s.path.endsWith("DesignerPage.tsx"))).toBe(true);
  const report=checkWiring({sources});
  // WL1/WL6 are runtime codes: this source proof claims no captured DOM evidence.
  const findings=report.findings.filter(f=>["WL1","WL6","WL10","WL4"].includes(f.code));
  expect(findings,JSON.stringify(findings)).toEqual([]);
});
