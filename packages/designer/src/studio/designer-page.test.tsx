import { renderToString } from "react-dom/server";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { checkWiring, type WiringSource } from "../catalog-core/wiring.js";
import { expect, it } from "vitest";
import { AppFrame } from "../frames/AppFrame.js";
import { Studio } from "./Studio.js";
import { labels, smallCatalog, emptyLibrary } from "./__fixtures__/studio.js";
it("mounts only the system page canvas and its right rail on the existing Studio entry", () => {
  const html = renderToString(<AppFrame brand={{markSrc:"/mark.svg",wordmark:"Example",label:"Home"}} navigation={{tree:[]}} account={{signedOutLabel:"Account",sections:[]}} commands={{heading:"Commands",triggerLabel:"Search",searchLabel:"Search commands",closeLabel:"Close",emptyMessage:"No commands",groups:[]}}><Studio catalog={smallCatalog} adapter={{ load: async () => ({ library: emptyLibrary() }) }} labels={labels} /></AppFrame>);
  const host = document.createElement("div"); host.innerHTML = html;
  expect(host.querySelectorAll("[data-application-frame]")).toHaveLength(1);
  expect(host.querySelectorAll("main")).toHaveLength(1);
  expect(host.querySelectorAll("section[data-designer-region=canvas]")).toHaveLength(1);
  expect(host.querySelectorAll("[data-system-canvas]")).toHaveLength(1);
  expect([...host.querySelectorAll<HTMLElement>("[data-studio-rail-card]")].map(card=>card.dataset.studioRailCard)).toEqual(["explorer","map","zoom","checks"]);
  expect(host.querySelector('[data-studio-rail-card=checks] [aria-expanded]')).toHaveAttribute("aria-expanded","false");
  expect(host.querySelector("[data-frame-module]")).toBeNull();
  expect(host.querySelectorAll("[data-studio-rail]")).toHaveLength(1);
  expect(host.querySelector('[role="tablist"], [data-frame-slot="dock-strip"]')).toBeNull();
});

it("checks the complete system-canvas source closure for WL1, WL6, WL10 and raw values",()=>{
  const root=resolve(process.cwd(),"src/studio/system-canvas");
  const files=(dir:string):string[]=>readdirSync(dir,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?entry.name==="__fixtures__"||entry.name==="thumbnails"?[]:files(resolve(dir,entry.name)):/\.tsx?$/.test(entry.name)&&!entry.name.includes(".test.")?[resolve(dir,entry.name)]:[]);
  const sources:WiringSource[]=files(root).map(path=>({path,content:readFileSync(path,"utf8"),layer:"sections"}));
  expect(sources.some(s=>s.path.endsWith("DesignerPage.tsx"))).toBe(true);
  const report=checkWiring({sources});
  // WL1/WL6 are runtime codes: this source proof claims no captured DOM evidence.
  expect(report.findings.filter(f=>["WL1","WL6","WL10","WL4"].includes(f.code))).toEqual([]);
});
