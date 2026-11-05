/** @vitest-environment node */
import React from "react";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { build } from "esbuild";
import { renderToString } from "react-dom/server";
import { expect, it } from "vitest";
import { AppFrame } from "./AppFrame.js";
import { PageHeaderModule } from "../shell/FrameSlots.js";
import { Button } from "../components/Button.js";
import { Menu } from "../components/Menu.js";
import { shellCopyFixtureResolver } from "./__fixtures__/shell-copy.js";
import { selectChromium } from "../__fixtures__/chromium-discovery.js";

const packageRoot = resolve(import.meta.dirname, "../..");
const ports = { React, AppFrame, PageHeaderModule, Button, Menu, copyResolver: shellCopyFixtureResolver };

// Every dependency is a parameter so exactly this fixture also runs in the browser bundle.
function fixture({ React: react, AppFrame: Frame, PageHeaderModule: Header, Button: Control, Menu: ActionMenu, copyResolver }: any, legacy = false) {
  const h = react.createElement;
  const actions = [{ id: "publish", label: "Publish", primary: true, onAction() {} }, { id: "duplicate", label: "Duplicate", onAction() {} }];
  const header = { title: "Workspace view", nav: { label: "Page views", activeId: "overview", items: [
    { id: "overview", label: "Overview", href: "#overview" }, { id: "activity", label: "Activity history", href: "#activity" }, { id: "settings", label: "Workspace settings", href: "#settings" },
  ] }, actions: { render: ({ compact }: { compact: boolean }) => compact
    ? h(ActionMenu, { trigger: h(Control, { "data-fixture-actions": "", "aria-label": "Page actions" }, "Actions") }, actions.map(action => h(ActionMenu.Item, { key: action.id, id: action.id, onAction: action.onAction }, action.label)))
    : h(react.Fragment, null, ...actions.map(action => h(Control, { key: action.id }, action.label))) } };
  return h(Frame, {
    brand: { markSrc: "/mark.svg" },
    navigation: { label: "Workspace navigation", tree: [{ id: "home", label: "Home", href: "#home" }] },
    account: { signedOutLabel: "Account", sections: [] },
    commands: { triggerLabel: "Commands", heading: "Commands", searchLabel: "Search commands", closeLabel: "Close commands", emptyMessage: "No commands", groups: [], shortcutEnabled: false },
    rightPanel: { label: "Tools", handleLabel: "Resize tools", min: 200, max: 420, defaultValue: 240, children: h("p", null, "Tools content") },
    copyResolver, themeControl: null, fill: "viewport", headerSurface: "glass", mainId: "fit-main",
    ...(legacy ? { page: { title: "Workspace view", breadcrumb: [{ id: "home", label: "Workspace", href: "#home" }], actions } } : {}),
    children: h(react.Fragment, null, !legacy && h(Header, { id: "route", header }), h("p", null, "Route content")),
  });
}

it.each([false, true])("server-renders the skip link, banner, nav, main and one h1 (legacy=%s)", legacy => {
  const html = renderToString(fixture(ports, legacy));
  expect(html).toContain('href="#fit-main"');
  expect(html).toMatch(/<header\b/);
  expect(html).toMatch(/<nav\b/);
  expect(html).toContain('<main id="fit-main"');
  expect(html.match(/<h1[\s>]/g)).toHaveLength(1);
  expect(html).toMatch(/<h1\b[^>]*>Workspace view<\/h1>/);
  if (!legacy) expect(html).toContain('aria-label="Page views"');
});

async function browser(run: (evaluate: (expression: string) => Promise<any>, send: (method: string, params?: object) => Promise<any>) => Promise<void>) {
  const macChrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  const chrome = selectChromium(process.env.FOUNDRY_TEST_CHROME ?? (existsSync(macChrome) ? macChrome : undefined), (path, args) => spawnSync(path, args, { stdio: "ignore" }));
  const profile = mkdtempSync(join(tmpdir(), "header-fit-"));
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

it("keeps a full-stage surface, docked tools and intrinsic overflow at 390/1440/2880", async () => {
  const css = ["tokens.css", "compiled.css"].map(file => readFileSync(join(packageRoot, "styles", file), "utf8")).join("\n");
  for (const legacy of [false, true]) {
    const html = renderToString(fixture(ports, legacy));
    const bundle = await build({ stdin: { contents: `
      import React from 'react'; import {hydrateRoot} from 'react-dom/client';
      import {AppFrame} from './src/frames/AppFrame.js';
      import {PageHeaderModule} from './src/shell/FrameSlots.js';
      import {Button} from './src/components/Button.js'; import {Menu} from './src/components/Menu.js';
      import {shellCopyFixtureResolver as copyResolver} from './src/frames/__fixtures__/shell-copy.js';
      window.fitErrors=[]; hydrateRoot(document.getElementById('root'), (${fixture.toString()})({React,AppFrame,PageHeaderModule,Button,Menu,copyResolver},${legacy}),{onRecoverableError:error=>window.fitErrors.push(String(error))});
    `, resolveDir: packageRoot, loader: "tsx" }, bundle: true, write: false, platform: "browser", format: "esm", define: { "process.env.NODE_ENV": '"production"' } });
    await browser(async (evaluate, send) => {
      await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
      const { frameTree } = await send("Page.getFrameTree");
      await send("Page.setDocumentContent", { frameId: frameTree.frame.id, html: `<!doctype html><meta charset="utf-8"><style>${css}body{margin:0}</style><div id="root">${html}</div>` });
      await evaluate(`import(${JSON.stringify("data:text/javascript;base64," + Buffer.from(bundle.outputFiles[0]!.text).toString("base64"))}).then(() => true)`);
      const settle = () => evaluate("new Promise(resolve=>setTimeout(resolve,250))");
      for (const width of [1440, 390, 2880]) {
        await send("Emulation.setDeviceMetricsOverride", { width, height: 1000, deviceScaleFactor: 1, mobile: false });
        await settle();
        const result = await evaluate(`(() => {
          const bar=document.querySelector('[data-application-frame-region="bar"]'),stage=document.querySelector('[data-application-frame-region="stage"]'),tools=document.querySelector('[data-application-frame-panel="trigger"]');
          const b=bar.getBoundingClientRect(),s=stage.getBoundingClientRect(),t=tools.getBoundingClientRect(),m=stage.querySelector('main').getBoundingClientRect();
          return {mainInset:m.x-s.x,mainWidth:m.width,bar:b.width,stage:s.width,x:b.x-s.x,navPosition:getComputedStyle(bar.querySelector('nav')).position,position:getComputedStyle(bar).position,toolsInBar:tools.closest('header')===bar,toolsPosition:getComputedStyle(tools).position,toolsVisible:t.x>=b.x&&t.right<=b.right,inset:parseFloat(getComputedStyle(stage).paddingInlineStart),token:parseFloat(getComputedStyle(stage).getPropertyValue(matchMedia('(min-width: 1024px)').matches?'--spacing-xl':'--spacing-lg')),headings:document.querySelectorAll('h1').length,overflow:document.querySelector('[data-frame-header-overflow]')?.dataset.frameHeaderOverflow,errors:window.fitErrors};
        })()`);
        console.info("header-fit", JSON.stringify({ legacy, width, ...result }));
        expect(result.bar, `legacy=${legacy} width=${width}`).toBeCloseTo(result.stage, 0);
        expect(result.x).toBeCloseTo(0, 0);
        expect(result.position).toBe("relative");
        expect(result.toolsInBar).toBe(true);
        expect(["absolute", "fixed"]).not.toContain(result.toolsPosition);
        expect(result.toolsVisible).toBe(true);
        expect(result.inset).toBeGreaterThan(0);
        expect(result.inset).toBe(result.token);
        expect(result.mainInset).toBe(result.inset);
        expect(result.mainWidth).toBeCloseTo(result.stage - result.inset * 2, 0);
        expect(["absolute", "fixed"]).not.toContain(result.navPosition);
        expect(result.headings).toBe(1);
        expect(result.errors).toEqual([]);
        if (!legacy) expect(result.overflow).toBe(width === 390 ? "navigation" : "none");
        if (width === 390) {
          const selector = legacy ? 'button[aria-label="More page actions"]' : 'button[data-fixture-actions]';
          expect(await evaluate(`!!document.querySelector(${JSON.stringify(selector)})`)).toBe(true);
          await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`); await settle();
          expect(await evaluate(`document.querySelector('[role="menu"]')?.textContent`)).toContain("Duplicate");
          await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
          await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
        }
      }
      // The inset assertion observes layout rather than merely finding a token string.
      await evaluate(`document.querySelector('[data-application-frame-region="stage"]').style.padding='0'`);
      expect(await evaluate(`parseFloat(getComputedStyle(document.querySelector('[data-application-frame-region="stage"]')).paddingInlineStart)`)).toBe(0);
    });
  }
}, 60_000);
