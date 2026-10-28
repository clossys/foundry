/** @vitest-environment node */
import React from "react";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { build } from "esbuild";
import { renderToString } from "react-dom/server";
import { expect, it } from "vitest";
import { InspectorFrame } from "./InspectorFrame.js";
import { AppFrame } from "./AppFrame.js";
import { shellCopyFixtureResolver } from "./__fixtures__/shell-copy.js";
import { selectChromium } from "../__fixtures__/chromium-discovery.js";

const packageRoot = resolve(import.meta.dirname, "../..");
const ports = { React, AppFrame, InspectorFrame, copyResolver: shellCopyFixtureResolver };
function fixture({ React: react, AppFrame: Frame, InspectorFrame: Inspector, copyResolver }: any) {
  const h = react.createElement;
  const mark = (fill: string) => "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="'+fill+'" d="M3 3h18v18H3z"/></svg>');
  return h(Frame, {
    brand: { markSrc: mark("black"), reversedMarkSrc: mark("white"), navigationMark: { label: "Workspace" } },
    navigation: { label: "Workspace navigation", tree: [{ id: "home", label: "Home", href: "#home" }, { id: "files", label: "Files", href: "#files" }], activeId: "home" },
    account: { actor: { name: "Alexandria Montgomery de la Cruz" }, signedOutLabel: "Account", sections: [{ id: "account", entries: [
      { kind: "link", id: "profile", label: "Profile", href: "#profile" },
      { kind: "action", id: "unavailable", label: "Unavailable", isDisabled: true, onAction() {} },
    ] }] },
    commands: { triggerLabel: "Commands", heading: "Commands", searchLabel: "Search commands", closeLabel: "Close commands", emptyMessage: "No commands", groups: [], shortcutEnabled: false },
    rightPanel: { label: "Context tools", handleLabel: "Resize tools", openLabel: "Show context tools", closeLabel: "Close context tools", min: 200, max: 420, defaultValue: 240, children: h("button", null, "Panel task") },
    copyResolver, theme: { defaultPreference: "light" }, fill: "viewport",
    children: h(react.Fragment, null, h("h1", null, "Workspace"),
      h(Inspector, { label: "Details", handleLabel: "Resize details", openLabel: "Show details", closeLabel: "Close details", min: 220, max: 420, defaultValue: 280 }, h("button", null, "Inspector task"))),
  });
}
async function browser(run: (evaluate: (expression: string) => Promise<any>, send: (method: string, params?: object) => Promise<any>) => Promise<void>) {
  const macChrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  const chrome = selectChromium(process.env.FOUNDRY_TEST_CHROME ?? (existsSync(macChrome) ? macChrome : undefined), (path, args) => spawnSync(path, args, { stdio: "ignore" }));
  const profile = mkdtempSync(join(tmpdir(), "shell-regions-"));
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
    rmSync(profile, { recursive: true, force: true });
  }
}

it("fits the account label, changes the dark mark and reaches both inspector sheets at 390", async () => {
  const css = ["tokens.css", "compiled.css"].map(file => readFileSync(join(packageRoot, "styles", file), "utf8")).join("\n");
  for (const legacy of [false]) {
    const html = renderToString(fixture(ports));
    const bundle = await build({ stdin: { contents: `
      import React from 'react'; import {hydrateRoot} from 'react-dom/client';
      import {AppFrame} from './src/frames/AppFrame.js'; import {InspectorFrame} from './src/frames/InspectorFrame.js';
      import {shellCopyFixtureResolver as copyResolver} from './src/frames/__fixtures__/shell-copy.js';
      window.fitErrors=[]; hydrateRoot(document.getElementById('root'), (${fixture.toString()})({React,AppFrame,InspectorFrame,copyResolver},${legacy}),{onRecoverableError:error=>window.fitErrors.push(String(error))});
    `, resolveDir: packageRoot, loader: "tsx" }, bundle: true, write: false, platform: "browser", format: "esm", define: { "process.env.NODE_ENV": '"production"' } });
    await browser(async (evaluate, send) => {
      await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
      const { frameTree } = await send("Page.getFrameTree");
      await send("Page.setDocumentContent", { frameId: frameTree.frame.id, html: `<!doctype html><meta charset="utf-8"><style>${css}body{margin:0}</style><div id="root">${html}</div>` });
      await evaluate(`import(${JSON.stringify("data:text/javascript;base64," + Buffer.from(bundle.outputFiles[0]!.text).toString("base64"))}).then(() => true)`);
      const settle = () => evaluate("new Promise(resolve=>setTimeout(resolve,250))");
      const capture = async (name: string) => {
        const output = process.env.FOUNDRY_TEST_ARTIFACT_DIR;
        if (!output) return;
        const screenshot = await send("Page.captureScreenshot", { format: "png" });
        mkdirSync(output, { recursive: true });
        writeFileSync(join(output, name + ".png"), Buffer.from(screenshot.data, "base64"));
      };
      const actor = "Alexandria Montgomery de la Cruz";
      const click = async (label: string) => {
        expect(await evaluate("(() => {const b=[...document.querySelectorAll('button')].find(b=>b.getAttribute('aria-label')==="+JSON.stringify(label)+"||b.textContent==="+JSON.stringify(label)+");b?.focus();b?.click();return !!b})()"), label).toBe(true);
        await settle();
      };
      const escape = async () => {
        await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
        await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
        await settle();
      };
      const measure = () => evaluate("(() => {const b=[...document.querySelectorAll('button')].find(b=>b.getAttribute('aria-label')==="+JSON.stringify(actor)+"),n=[...b.querySelectorAll('span')].find(s=>s.textContent==="+JSON.stringify(actor)+"&&!s.querySelector('span')),g=n.getBoundingClientRect(),r=b.getBoundingClientRect(),c=getComputedStyle(n),links=[...document.querySelectorAll('[data-application-navigation-region=links] [data-application-navigation-control]')];return {name:n.textContent,overflow:c.textOverflow,whiteSpace:c.whiteSpace,fits:n.scrollWidth<=n.clientWidth,nameHeight:g.height,buttonHeight:r.height,glyphs:links.map(l=>({svg:!!l.querySelector('[aria-hidden=true] svg'),text:l.querySelector('[aria-hidden=true]')?.textContent})),indicator:getComputedStyle(links[0]).borderInlineStartWidth,token:getComputedStyle(links[0]).getPropertyValue('--ui-border-rule').trim(),themeControls:document.querySelectorAll('[role=menuitemradio]').length,errors:window.fitErrors}})()");
      await settle();
      const wide = await measure();
      console.info("shell-regions", JSON.stringify({ width:1440,...wide }));
      expect(wide.name).toBe(actor); expect(wide.overflow).not.toBe("ellipsis"); expect(wide.whiteSpace).toBe("normal"); expect(wide.fits).toBe(true); expect(wide.buttonHeight).toBeGreaterThanOrEqual(wide.nameHeight);
      expect(wide.glyphs.every((g: any) => g.svg && g.text === "")).toBe(true);
      expect(wide.indicator).toBe(wide.token); expect(wide.themeControls).toBe(0); expect(wide.errors).toEqual([]);
      await click(actor);
      expect(await evaluate("document.querySelectorAll('[role=menuitemradio]').length")).toBe(3);
      expect(await evaluate("!!document.querySelector('[role=menuitem][aria-disabled=true]')")).toBe(false);
      await evaluate("[...document.querySelectorAll('[role=menuitemradio]')].find(e=>e.textContent==='Dark').click()"); await settle();
      expect(await evaluate("document.documentElement.dataset.theme")).toBe("dark");
      expect(await evaluate("decodeURIComponent(document.querySelector('[data-application-navigation-region=header] img').getAttribute('src')).includes('white')")).toBe(true);
      await capture("desktop-dark-account");
      await escape();
      for (const width of [768, 390]) {
        await send("Emulation.setDeviceMetricsOverride", { width, height: 1000, deviceScaleFactor: 1, mobile: false }); await settle();
        if (width === 768) {
          expect(await evaluate("!!document.querySelector('aside[aria-label=Details]')")).toBe(true);
          continue;
        }
        expect(await evaluate("!!document.querySelector('aside[aria-label=Details]')")).toBe(false);
        await click("Show details");
        const sheet = await evaluate("(() => {const d=[...document.querySelectorAll('[role=dialog]')].find(d=>d.textContent.includes('Inspector task')),r=d?.getBoundingClientRect();return {task:!!d?.querySelector('button'),placement:d?.querySelector('[data-drawer-placement]')?.dataset.drawerPlacement,x:r?.x,right:r?.right}})()");
        console.info("inspector-390", JSON.stringify(sheet));
        await capture("mobile-inspector");
        expect(sheet.task).toBe(true); expect(sheet.placement).toBe("end"); expect(sheet.x).toBeGreaterThanOrEqual(0); expect(sheet.right).toBeLessThanOrEqual(390);
        await escape();
        expect(await evaluate("document.activeElement.textContent")).toBe("Show details");
        await click("Show context tools");
        expect(await evaluate("[...document.querySelectorAll('[role=dialog]')].some(d=>d.textContent.includes('Panel task'))")).toBe(true);
        await escape();
        await click("Open navigation");
        const mobile = await measure();
        console.info("shell-regions", JSON.stringify({ width,...mobile }));
        await capture("mobile-navigation");
        expect(mobile.fits).toBe(true); expect(mobile.overflow).not.toBe("ellipsis"); expect(mobile.glyphs.every((g: any) => g.svg && g.text === "")).toBe(true); expect(mobile.errors).toEqual([]);
      }
    });
  }
}, 60_000);
