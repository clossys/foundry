// @vitest-environment node
import { expect, it } from "vitest";
import { build } from "esbuild";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { generateCompiledCss } from "../compiled-css/generate.js";
import { scanClassCandidates } from "../compiled-css/class-scan.js";
import { selectChromium } from "../__fixtures__/chromium-discovery.js";

it("real Chromium: panels have zero overflowing text nodes at 390/1440; removing row ellipsis breaks the proof", async () => {
  const root = mkdtempSync(join(tmpdir(), "studio-panels-"));
  const pkg = resolve(import.meta.dirname, "../..");
  const modulePath = (path: string) => JSON.stringify(join(pkg, "src", path));
  const fixture = `import React,{useEffect}from'react';import{createRoot}from'react-dom/client';
import{TreeView}from${modulePath("studio/TreeView.tsx")};
import{ExplorerTree}from${modulePath("studio/rail/ExplorerTree.tsx")};
import{StudioDataValue}from${modulePath("studio/data-value.tsx")};
import{createRouteStudioLabels}from${modulePath("studio/route-labels.ts")};
const long='unbroken-candidate-and-helper-data-'.repeat(18);
const copy={locale:'en',messages:new Proxy({},{get:(_,id)=>({id})}),resolver:ref=>({ref,text:'[['+ref.id+']]',servedLocale:'en',chain:['en']})};
const labels={...createRouteStudioLabels(copy),howToChange:long};
function App(){useEffect(()=>{window.ready=true},[]);return <main>
<aside data-panel='tree'><TreeView aria-label='Fixture tree' nodes={[{id:'root',label:long,children:[{id:'child',label:long}]}]} defaultExpandedIds={['root']}/></aside>
<aside data-panel='values'><StudioDataValue kind='hash' value={'f'.repeat(128)}/><StudioDataValue kind='path' value={long}/></aside>
<aside data-panel='zero'><ExplorerTree copy={copy} labels={labels} placements={[]} onNavigate={()=>{}}/></aside>
</main>};createRoot(document.getElementById('root')).render(<App/>);
window.measure=()=>{const failures=[];for(const panel of document.querySelectorAll('[data-panel]')){const bounds=panel.getBoundingClientRect();const walker=document.createTreeWalker(panel,NodeFilter.SHOW_TEXT);let node;while(node=walker.nextNode()){if(!node.textContent.trim())continue;const parent=node.parentElement;const style=getComputedStyle(parent);if(style.visibility==='hidden'||!parent.getClientRects().length)continue;if(style.textOverflow==='ellipsis'&&style.overflowX==='hidden'&&style.whiteSpace==='nowrap')continue;const range=document.createRange();range.selectNodeContents(node);for(const rect of range.getClientRects()){if(rect.width&& (rect.left<bounds.left-1||rect.right>bounds.right+1)){failures.push({panel:panel.dataset.panel,text:node.textContent.slice(0,80),left:rect.left,right:rect.right,bounds:bounds.right});break;}}}}return failures;};`;
  const bundled = await build({ stdin: { contents: fixture, loader: "jsx", resolveDir: pkg }, bundle: true, write: false, format: "esm", platform: "browser", jsx: "automatic", define: { "process.env.NODE_ENV": '"development"' } });
  const { css } = await generateCompiledCss({ stylesDir: join(pkg, "styles"), candidates: [...scanClassCandidates(join(pkg, "src")).candidates] });
  const file = join(root, "index.html");
  writeFileSync(file, `<!doctype html><meta charset="utf-8"><style>${readFileSync(join(pkg, "styles/tokens.css"), "utf8")}${css}body{margin:0}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,280px),1fr));gap:16px;padding:16px}aside{min-width:0;max-width:100%}dl,dd{margin-inline:0}</style><div id="root"></div><script>window.fixtureErrors=[];window.addEventListener("error",event=>window.fixtureErrors.push(event.message));window.addEventListener("unhandledrejection",event=>window.fixtureErrors.push(String(event.reason)));</script><script type="module">${bundled.outputFiles[0]!.text.replaceAll("</script", "<\\/script")}</script>`);
  const chrome = selectChromium(process.env.FOUNDRY_TEST_CHROME, (path, args) => spawnSync(path, args, { stdio: "ignore" }));
  const child = spawn(chrome, ["--headless", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", "--no-first-run", "--disable-background-networking", `--user-data-dir=${join(root, "profile")}`, "--remote-debugging-pipe"], { stdio: ["ignore", "ignore", "pipe", "pipe", "pipe"] });
  let id = 0, pending = "", sessionId: string | undefined;
  const waiting = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>();
  const send = (method: string, params: object = {}, session = sessionId): Promise<any> => new Promise((resolve, reject) => {
    const next = ++id, timer = setTimeout(() => { waiting.delete(next); reject(new Error(`Chrome timeout: ${method}`)); }, 15000);
    waiting.set(next, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } });
    (child.stdio[3] as NodeJS.WritableStream).write(JSON.stringify({ id: next, method, params, ...(session ? { sessionId: session } : {}) }) + "\0");
  });
  (child.stdio[4] as NodeJS.ReadableStream).on("data", chunk => {
    pending += chunk.toString(); let end: number;
    while ((end = pending.indexOf("\0")) >= 0) {
      const message = JSON.parse(pending.slice(0, end)); pending = pending.slice(end + 1);
      const task = waiting.get(message.id); if (!task) continue; waiting.delete(message.id);
      if (message.error) task.reject(new Error(JSON.stringify(message.error))); else task.resolve(message.result);
    }
  });
  const evaluate = async (expression: string) => {
    const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  try {
    // Reuse LogoCloud.test.tsx: mount into about:blank with Page.setDocumentContent.
    const target = await send("Target.createTarget", { url: "about:blank" }, undefined);
    sessionId = (await send("Target.attachToTarget", { targetId: target.targetId, flatten: true }, undefined)).sessionId;
    await send("Page.enable");
    const { frameTree } = await send("Page.getFrameTree");
    await send("Page.setDocumentContent", { frameId: frameTree.frame.id, html: readFileSync(file, "utf8") });
    await evaluate("new Promise((resolve,reject)=>{const end=Date.now()+10000;const t=setInterval(()=>{if(window.ready){clearInterval(t);resolve(true)}else if(Date.now()>end){clearInterval(t);reject(Error('fixture did not mount: '+JSON.stringify(window.fixtureErrors)))}},20)})");
    for (const width of [390, 1440]) {
      await send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: false });
      await evaluate("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
      expect(await evaluate("innerWidth")).toBe(width);
      expect(await evaluate("window.measure()"), `overflow at ${width}`).toEqual([]);
      expect(await evaluate("[...document.querySelectorAll('[data-tree-label]')].every(n=>getComputedStyle(n).textOverflow==='ellipsis'&&n.scrollWidth>n.clientWidth)")).toBe(true);
      expect(await evaluate("document.querySelectorAll('[data-panel=zero] [data-ds-leaf=\"sections.empty-state\"]').length")).toBe(1);
      expect(await evaluate("getComputedStyle(document.querySelector('[data-studio-data-kind=hash]')).fontFamily")).toMatch(/mono/i);
      await evaluate("document.querySelectorAll('[data-tree-label]').forEach(n=>n.classList.remove('truncate'))");
      // Hyphenated labels may wrap without overflowing after mutation; the row must still ellipsize.
      expect(await evaluate("[...document.querySelectorAll('[data-tree-label]')].every(n=>getComputedStyle(n).textOverflow==='ellipsis'&&n.scrollWidth>n.clientWidth)"), "ellipsis-removal mutation must fail the row invariant").toBe(false);
      await evaluate("document.querySelectorAll('[data-tree-label]').forEach(n=>n.classList.add('truncate'))");
    }
  } finally { child.kill(); await new Promise(resolve => child.once("exit", resolve)); rmSync(root, { recursive: true, force: true }); }
}, 90000);
