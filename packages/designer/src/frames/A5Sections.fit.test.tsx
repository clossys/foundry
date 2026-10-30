/** @vitest-environment node */
import React from "react";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { build } from "esbuild";
import { renderToString } from "react-dom/server";
import { expect, it } from "vitest";
import { AppFrame } from "./AppFrame.js";
import { StatGroup } from "../blocks/StatGroup.js";
import { NoticeList } from "../blocks/NoticeList.js";
import { ResourceList } from "../blocks/ResourceList.js";
import { shellCopyFixtureResolver } from "./__fixtures__/shell-copy.js";
import { selectChromium } from "../__fixtures__/chromium-discovery.js";
const packageRoot = resolve(import.meta.dirname, "../..");
const ports = { React, AppFrame, StatGroup, NoticeList, ResourceList, copyResolver: shellCopyFixtureResolver };
function fixture({ React: react, AppFrame: Frame, StatGroup: Stats, NoticeList: Notices, ResourceList: Resources, copyResolver }: any, dir: string) {
  const h = react.createElement;
  const stats = [{ id: "users", label: "Active users", value: "2,481" }, { id: "revenue", label: "Revenue", value: "$48.2k" }, { id: "conversion", label: "Conversion", value: "3.4%" }, { id: "churn", label: "Churn", value: "1.1%" }];
  return h(Frame, { dir, stage: "full", fill: "viewport", brand: { markSrc: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M2 2h20v20H2z'/%3E%3C/svg%3E" },
    account: { signedOutLabel: "Account", sections: [{ id: "destinations", entries: [{ id: "docs", kind: "link", label: "Docs", href: "#docs" }] }] },
    navigation: { label: "Navigation", tree: [{ id: "home", label: "Home", href: "#home" }] },
    commands: { triggerLabel: "Commands", heading: "Commands", searchLabel: "Search", closeLabel: "Close", emptyMessage: "No commands", groups: [], shortcutEnabled: false }, copyResolver,
    children: h(react.Fragment, null,
      h(Stats, { items: stats, "aria-label": "Metrics" }),
      h(Notices, { label: "Notices", notices: [{ id: "ready", message: "Review the report at " + "a".repeat(100) + ".example" }] }),
      h(Resources, { "aria-label": "Resources", items: [{ id: "report", textValue: "Quarterly report", title: "Quarterly report", actions: [{ id: "open", label: "Open", onAction() {} }, { id: "copy", label: "Copy", onAction() {} }] }], actionsLabel: (name: string) => "Actions for " + name, emptyState: { title: "No records" } })),
  });
}
async function browser(run: (evaluate: (expression: string) => Promise<any>, send: (method: string, params?: object) => Promise<any>) => Promise<void>) {
  const macChrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  const chrome = selectChromium(process.env.FOUNDRY_TEST_CHROME ?? (existsSync(macChrome) ? macChrome : undefined), (path, args) => spawnSync(path, args, { stdio: "ignore" }));
  const profile = mkdtempSync(join(tmpdir(), "sections-fit-"));
  const child = spawn(chrome, ["--headless", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--disable-background-networking", "--disable-extensions", `--user-data-dir=${profile}`, "--remote-debugging-pipe"], { stdio: ["ignore", "ignore", "pipe", "pipe", "pipe"] });
  let sequence = 0, buffer = "", sessionId: string | undefined;
  const pending = new Map<number, { resolve: (result: any) => void; reject: (error: Error) => void }>();
  const send = (method: string, params: object = {}): Promise<any> => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`Browser measurement timeout: ${method}`)); }, 10_000);
    pending.set(id, { resolve: result => { clearTimeout(timeout); resolve(result); }, reject: error => { clearTimeout(timeout); reject(error); } });
    (child.stdio[3] as NodeJS.WritableStream).write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + "\0");
  });
  (child.stdio[4] as NodeJS.ReadableStream).on("data", chunk => {
    buffer += String(chunk);
    let boundary: number;
    while ((boundary = buffer.indexOf("\0")) >= 0) {
      const message = JSON.parse(buffer.slice(0, boundary)); buffer = buffer.slice(boundary + 1);
      const task = pending.get(message.id); if (!task) continue;
      pending.delete(message.id);
      if (message.error) task.reject(new Error(message.error.message)); else task.resolve(message.result);
    }
  });
  const evaluate = async (expression: string) => {
    const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  try {
    const target = await send("Target.createTarget", { url: "about:blank" });
    sessionId = (await send("Target.attachToTarget", { targetId: target.targetId, flatten: true })).sessionId;
    await send("Page.enable");
    await run(evaluate, send);
  } finally {
    for (const task of pending.values()) task.reject(new Error("Browser measurement closed"));
    child.kill();
    if (child.exitCode === null) await new Promise<void>(resolve => child.once("exit", () => resolve()));
    rmSync(profile, { recursive: true, force: true, maxRetries: 4, retryDelay: 100 });
  }
}


it("F3 F4 F5 F7 F9 fits section gutters and compact stats at 390 and 200-percent reflow in both directions", async () => {
  const css = ["tokens.css", "compiled.css"].map(file => readFileSync(join(packageRoot, "styles", file), "utf8")).join("\n");
  for (const dir of ["ltr", "rtl"]) {
    const html = renderToString(fixture(ports, dir));
    const bundle = await build({ stdin: { contents: `
      import React from 'react'; import {hydrateRoot} from 'react-dom/client';
      import {AppFrame} from './src/frames/AppFrame.js'; import {StatGroup} from './src/blocks/StatGroup.js';
      import {NoticeList} from './src/blocks/NoticeList.js'; import {ResourceList} from './src/blocks/ResourceList.js';
      import {shellCopyFixtureResolver as copyResolver} from './src/frames/__fixtures__/shell-copy.js';
      window.fitErrors=[]; hydrateRoot(document.getElementById('root'), (${fixture.toString()})({React,AppFrame,StatGroup,NoticeList,ResourceList,copyResolver},${JSON.stringify(dir)}),{onRecoverableError:error=>window.fitErrors.push(String(error))});
    `, resolveDir: packageRoot, loader: "tsx" }, bundle: true, write: false, platform: "browser", format: "esm", define: { "process.env.NODE_ENV": '"production"' } });
    await browser(async (evaluate, send) => {
      await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
      const { frameTree } = await send("Page.getFrameTree");
      await send("Page.setDocumentContent", { frameId: frameTree.frame.id, html: `<!doctype html><meta charset="utf-8"><style>${css}html,body,#root{margin:0;min-height:100%}*{box-sizing:border-box}</style><div id="root">${html}</div>` });
      await evaluate(`import(${JSON.stringify("data:text/javascript;base64," + Buffer.from(bundle.outputFiles[0]!.text).toString("base64"))}).then(() => true)`);
      const settle = () => evaluate("new Promise(resolve=>setTimeout(resolve,200))");
      for (const width of [1440, 390, 320]) {
        // 320 CSS px also models a 640px viewport reflowed at 200% browser zoom.
        await send("Emulation.setDeviceMetricsOverride", { width, height: 1000, deviceScaleFactor: width === 320 ? 2 : 1, mobile: false }); await settle();
        const measured = await evaluate(`(() => {
          const main=document.querySelector('main'),m=main.getBoundingClientRect();
          const roots=['sections.stats','sections.notices','sections.resource-list'].map(id=>document.querySelector('[data-ds-leaf="'+id+'"]'));
          const statRects=[...roots[0].children].map(e=>e.getBoundingClientRect());
          const statBounds={left:Math.min(...statRects.map(r=>r.left)),right:Math.max(...statRects.map(r=>r.right))};
          const children=[statBounds,roots[1].querySelector('[role=status]').getBoundingClientRect(),roots[2].querySelector('[role=grid]').getBoundingClientRect()];
          const stats=[...roots[0].children].map(e=>({x:e.getBoundingClientRect().x,y:e.getBoundingClientRect().y}));
          return {gutters:children.map(r=>({start:r.left-m.left,end:m.right-r.right})),padding:roots.map(e=>({start:getComputedStyle(e).paddingInlineStart,end:getComputedStyle(e).paddingInlineEnd})),stats,overflow:main.scrollWidth-main.clientWidth,actions:[...roots[2].querySelectorAll('button')].map(b=>({label:b.textContent,width:b.getBoundingClientRect().width,display:getComputedStyle(b).display})),errors:window.fitErrors};
        })()`);
        console.info("sections-fit", JSON.stringify({width,dir,...measured}));
        for (const padding of measured.padding) expect(padding).toEqual({start:"16px",end:"16px"});
        for (const gutter of measured.gutters) { expect(gutter.start).toBeCloseTo(16,0); expect(gutter.end).toBeCloseTo(16,0); }
        expect(measured.overflow).toBeLessThanOrEqual(1); expect(measured.errors).toEqual([]);
        if(width<768) { expect(measured.stats[0].y).toBe(measured.stats[1].y); expect(measured.stats[2].y).toBeGreaterThan(measured.stats[0].y); }
        expect(measured.actions.map((a:any)=>a.label)).toEqual(["Open","Copy"]);
        expect(measured.actions.every((a:any)=>a.width>0&&a.display!=="none")).toBe(true);
        const output = process.env.FOUNDRY_TEST_ARTIFACT_DIR;
        if (output) {
          mkdirSync(output, { recursive: true });
          writeFileSync(join(output, `sections-${dir}-${width}.json`), JSON.stringify(measured, null, 2));
          const shot = await send("Page.captureScreenshot", { format: "png" });
          writeFileSync(join(output, `sections-${dir}-${width}.png`), Buffer.from(shot.data, "base64"));
        }
      }
    });
  }
}, 60_000);

it("F10 anchors the theme popup above a visible account trigger clear of the footer divider", async () => {
  const css=["tokens.css","compiled.css"].map(f=>readFileSync(join(packageRoot,"styles",f),"utf8")).join("\n");
  const html=renderToString(fixture(ports,"ltr"));
  const bundle=await build({stdin:{contents:`import React from 'react';import{hydrateRoot}from'react-dom/client';import{AppFrame}from'./src/frames/AppFrame.js';import{StatGroup}from'./src/blocks/StatGroup.js';import{NoticeList}from'./src/blocks/NoticeList.js';import{ResourceList}from'./src/blocks/ResourceList.js';import{shellCopyFixtureResolver as copyResolver}from'./src/frames/__fixtures__/shell-copy.js';hydrateRoot(document.getElementById('root'),(${fixture.toString()})({React,AppFrame,StatGroup,NoticeList,ResourceList,copyResolver},'ltr'));`,resolveDir:packageRoot,loader:"tsx"},bundle:true,write:false,platform:"browser",format:"esm",define:{"process.env.NODE_ENV":'"production"'}});
  await browser(async(evaluate,send)=>{
    await send("Emulation.setDeviceMetricsOverride",{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
    const{frameTree}=await send("Page.getFrameTree");
    await send("Page.setDocumentContent",{frameId:frameTree.frame.id,html:`<!doctype html><style>${css}html,body,#root{margin:0;min-height:100%}*{box-sizing:border-box}</style><div id="root">${html}</div>`});
    await evaluate(`import(${JSON.stringify("data:text/javascript;base64,"+Buffer.from(bundle.outputFiles[0]!.text).toString("base64"))}).then(()=>true)`);
    await evaluate("new Promise(r=>setTimeout(r,250))");
    await evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent==='Account').click()");
    await evaluate("new Promise(r=>setTimeout(r,250))");
    const popup=await evaluate(`(()=>{const trigger=[...document.querySelectorAll('button')].find(b=>b.textContent==='Account'),menu=document.querySelector('[role=menu]'),popover=menu.closest('[data-placement]'),t=trigger.getBoundingClientRect(),p=popover.getBoundingClientRect(),f=document.querySelector('[data-application-navigation-region=footer]').getBoundingClientRect();return{placement:popover.dataset.placement,gap:t.top-p.bottom,dividerGap:f.top-p.bottom,triggerWidth:t.width,triggerHeight:t.height,triggerDisplay:getComputedStyle(trigger).display,labels:[...menu.querySelectorAll('[role=menuitem],[role=menuitemradio]')].map(e=>e.textContent)}})()`);
    console.info("footer-fit",JSON.stringify(popup));
    expect(popup.placement).toBe("top");expect(popup.gap).toBeGreaterThanOrEqual(15);expect(popup.dividerGap).toBeGreaterThan(0);
    expect(popup.triggerWidth).toBeGreaterThan(0);expect(popup.triggerHeight).toBeGreaterThan(0);expect(popup.triggerDisplay).not.toBe("none");
    expect(popup.labels).toEqual(["System","Light","Dark","Docs"]);
    const output=process.env.FOUNDRY_TEST_ARTIFACT_DIR;if(output){mkdirSync(output,{recursive:true});const shot=await send("Page.captureScreenshot",{format:"png"});writeFileSync(join(output,"footer-popup.png"),Buffer.from(shot.data,"base64"));}
  });
},60_000);
