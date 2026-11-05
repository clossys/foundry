/** @vitest-environment node */
import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import ts from "typescript";

const root = resolve(import.meta.dirname, "../..");
const dist = resolve(root, "dist");
const probe = (script: string, server = false) => execFileSync(process.execPath, [...(server ? ["--conditions=react-server"] : []), "--input-type=module", "-e", script], { encoding: "utf8", timeout: 10_000 }).trim();

describe("NativeAction actual public artifact", () => {
  it("exports the identical reusable function from ordinary/root/server entries", () => {
    expect(probe(`import{NativeAction as a}from${JSON.stringify(dist + "/components/index.js")};import{NativeAction as b}from${JSON.stringify(dist + "/components/server.js")};import{NativeAction as c}from${JSON.stringify(dist + "/index.js")};console.log(a===b&&b===c&&typeof a.render==='function');`)).toBe("true");
  });
  for (const server of [false, true]) it(`executes the actual public native action with react-server=${server}`, () => {
    const script = `import{NativeAction}from${JSON.stringify(dist + "/components/server.js")};const ref={current:null},click=()=>{};const node=NativeAction.render({type:'button',id:'host',disabled:true,onClick:click,children:'Caller','aria-label':'Caller',style:{opacity:0.8}},ref);console.log(JSON.stringify({tag:node.type,ref:node.props.ref===ref,click:node.props.onClick===click,type:node.props.type,id:node.props.id,disabled:node.props.disabled,children:node.props.children,style:node.props.style}));`;
    expect(JSON.parse(probe(script, server))).toEqual({ tag: "button", ref: true, click: true, type: "button", id: "host", disabled: true, children: "Caller", style: { opacity: 0.8 } });
  });
  it("emits required explicit type, real button ref and native props while refusing aliases/render functions", () => {
    const filename = resolve(root, "native-action-public.check.tsx");
    const options: ts.CompilerOptions = { strict: true, noEmit: true, skipLibCheck: true, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler };
    const diagnostics = (text: string) => {
      const host = ts.createCompilerHost(options), original = host.getSourceFile.bind(host);
      host.getSourceFile = (path, language, error, fresh) => path === filename ? ts.createSourceFile(path, text, language, true, ts.ScriptKind.TSX) : original(path, language, error, fresh);
      return ts.getPreEmitDiagnostics(ts.createProgram([filename], options, host));
    };
    const imports = `import {createRef} from 'react';import{NativeAction,type NativeActionProps}from${JSON.stringify(dist + "/components/server.js")};`;
    expect(diagnostics(`${imports}const ref=createRef<HTMLButtonElement>();const p:NativeActionProps={type:'button',ref,disabled:true,name:'intent',value:'save',form:'host','aria-label':'Caller',style:{opacity:.8},onClick:e=>{e.currentTarget.focus();e.preventDefault()}};const a=<NativeAction {...p}/>;const b=<NativeAction type="submit"/>;const c=<NativeAction type="reset"/>;`)).toEqual([]);
    for (const props of ["", 'type="link"', 'type="button" ref={createRef<HTMLAnchorElement>()}', 'type="button" role="link"', 'type="button" dangerouslySetInnerHTML={{__html:"text"}}', 'type="button" onPress={()=>{}}', 'type="button" isDisabled', 'type="button" isPending', 'type="button" as="a"', 'type="button" href="/"', 'type="button" variant="primary"', 'type="button" size="md"', 'type="button" ground="base"', 'type="button" children={()=>"Caller"}', 'type="button" className={()=>"class"}', 'type="button" style={()=>({})}']) {
      const result = diagnostics(`${imports}const invalid=<NativeAction ${props}/>;`);
      expect(result.length, props).toBeGreaterThan(0);
      expect(result.every(error => error.file?.fileName === filename), props).toBe(true);
    }
  }, 30_000);
});

import { renderToStaticMarkup } from "react-dom/server";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { generateCompiledCss } from "../compiled-css/generate.js";
import { createElement } from "react";
import { NativeAction } from "./NativeAction.js";
import { buttonClassName } from "./button-classes.js";

it("actual Chrome proves native activation/forms/focus and compiled Button appearance in all intrinsic states", async () => {
  const chrome = ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium"].find(existsSync);
  if (!chrome) throw new Error("NativeAction proof requires actual Chrome; DOM simulation is insufficient");
  const root = mkdtempSync(join(tmpdir(), "native-action-proof-"));
  const packageRoot = resolve(import.meta.dirname, "../..");
  const nativeClasses = /class="([^"]+)"/.exec(renderToStaticMarkup(createElement(NativeAction, { type: "button" }, "Caller")))![1]!;
  const candidates = [...new Set([...nativeClasses.split(/\s+/), ...buttonClassName("primary", "md", "base").split(/\s+/)])];
  const { css } = await generateCompiledCss({ stylesDir: join(packageRoot, "styles"), candidates });
  const fixture = `import React,{createRef,useEffect,useState} from "react";import{createRoot}from"react-dom/client";import{NativeAction}from${JSON.stringify(join(packageRoot, "src/components/NativeAction.tsx"))};import{Button}from${JSON.stringify(join(packageRoot, "src/components/Button.tsx"))};
const ref=createRef();window.counts={native:0,annotation:0,submit:0,reset:0};function App(){const[disabled,setDisabled]=useState(false);window.disable=setDisabled;window.ref=ref;useEffect(()=>{window.ready=true},[]);return <><span id="name">Caller name</span><span id="description">Caller description</span><form id="form" onSubmit={e=>{e.preventDefault();window.counts.submit++}} onReset={()=>window.counts.reset++}>
<NativeAction id="native" type="button" ref={ref} disabled={disabled} name="intent" value="save" aria-labelledby="name" aria-describedby="description" onClick={()=>window.counts.native++}>Caller</NativeAction>
<Button id="aria" type="button" isDisabled={disabled}>Caller</Button>
<NativeAction id="submit" type="submit">Submit</NativeAction><NativeAction id="prevent" type="submit" onClick={e=>e.preventDefault()}>Prevent</NativeAction><NativeAction id="reset" type="reset">Reset</NativeAction><input id="value" defaultValue="original" />
<NativeAction id="annotation" type="button" aria-disabled="true" onClick={()=>window.counts.annotation++}>Annotated</NativeAction>
<NativeAction id="override" type="button" disabled style={{padding:19,opacity:0.8,outline:"3px solid rgb(255, 0, 0)",outlineOffset:7,backgroundColor:"rgb(1, 2, 3)"}}>Styled</NativeAction></form></>};createRoot(document.getElementById("root")).render(<App/>);`;
  const bundled = await build({ stdin: { contents: fixture, loader: "jsx", resolveDir: packageRoot }, bundle: true, write: false, format: "esm", platform: "browser", jsx: "automatic", define: { "process.env.NODE_ENV": '"development"' } });
  const file = join(root, "index.html");
  writeFileSync(file, `<!doctype html><meta charset="utf-8"><style>${readFileSync(join(packageRoot, "styles/tokens.css"), "utf8")}${css}body{margin:24px}form{display:flex;flex-direction:column;align-items:flex-start;gap:12px}</style><body tabindex="-1"><div id="root"></div><script type="module">${bundled.outputFiles[0]!.text.replaceAll("</script", "<\\/script")}</script></body>`);
  const child = spawn(chrome, ["--headless", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--disable-background-networking", "--disable-extensions", `--user-data-dir=${join(root, "profile")}`, "--remote-debugging-pipe"], { stdio: ["ignore", "ignore", "pipe", "pipe", "pipe"] });
  let id = 0, pending = "", sessionId: string | undefined;
  const waiting = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>();
  const send = (method: string, params: object = {}, session = sessionId): Promise<any> => new Promise((resolve, reject) => {
    const next = ++id;
    const timer = setTimeout(() => { waiting.delete(next); reject(new Error(`Chrome proof timeout: ${method}`)); }, 10_000);
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
  const settle = () => evaluate("new Promise(resolve=>setTimeout(resolve,250))");
  const styles = (name: string) => evaluate(`(()=>{const s=getComputedStyle(document.getElementById(${JSON.stringify(name)}));return Object.fromEntries(["backgroundColor","color","fontFamily","fontSize","lineHeight","borderRadius","paddingTop","paddingLeft","opacity","outlineStyle","outlineWidth","outlineOffset","outlineColor","transitionProperty"].map(k=>[k,s[k]]))})()`);
  const point = async (name: string) => evaluate(`(()=>{const n=document.getElementById(${JSON.stringify(name)});n.scrollIntoView();const r=n.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  const mouse = async (name: string, pressed = false) => {
    const p = await point(name); await send("Input.dispatchMouseEvent", { type: "mouseMoved", ...p });
    if (pressed) await send("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", clickCount: 1, ...p });
    await settle(); return p;
  };
  const click = async (name: string) => { const p = await mouse(name, true); await send("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", clickCount: 1, ...p }); await settle(); };
  const key = async (key: string, code: string, number: number) => {
    await send("Input.dispatchKeyEvent", { type: "rawKeyDown", key, code, windowsVirtualKeyCode: number });
    await send("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode: number }); await settle();
  };
  const observed: Record<string, unknown> = {};
  try {
    const target = await send("Target.createTarget", { url: pathToFileURL(file).href }, undefined);
    sessionId = (await send("Target.attachToTarget", { targetId: target.targetId, flatten: true }, undefined)).sessionId;
    await send("Runtime.enable");
    await evaluate("new Promise((resolve,reject)=>{const end=Date.now()+5000;const t=setInterval(()=>{if(window.ready){clearInterval(t);resolve(true)}else if(Date.now()>end){clearInterval(t);reject(Error('fixture did not mount'))}},20)})");
    expect(await evaluate("window.counts")).toEqual({ native: 0, annotation: 0, submit: 0, reset: 0 });
    const appearance = (value: any) => Object.fromEntries(["backgroundColor", "color", "fontFamily", "fontSize", "lineHeight", "borderRadius", "paddingTop", "paddingLeft"].map(k => [k, value[k]]));
    observed.rest = await styles("native"); expect(appearance(observed.rest)).toEqual(appearance(await styles("aria")));
    await mouse("native"); observed.hover = await styles("native"); await mouse("aria"); expect(appearance(observed.hover)).toEqual(appearance(await styles("aria")));
    let p = await mouse("native", true); observed.active = await styles("native"); await send("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", clickCount: 1, ...p });
    p = await mouse("aria", true); expect(appearance(observed.active)).toEqual(appearance(await styles("aria"))); await send("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", clickCount: 1, ...p });
    expect((observed.active as any).backgroundColor).not.toBe((observed.rest as any).backgroundColor);
    await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 0, y: 0 }); await evaluate("document.body.focus()"); await key("Tab", "Tab", 9);
    expect(await evaluate("document.activeElement.id")).toBe("native"); observed.focus = await styles("native");
    expect((observed.focus as any).outlineStyle).toBe("solid"); expect((observed.focus as any).outlineWidth).toBe("2px"); expect((observed.focus as any).outlineOffset).toBe("2px");
    const before = await evaluate("window.counts.native"); await key("Enter", "Enter", 13); expect(await evaluate("window.counts.native")).toBe(before + 1);
    await key(" ", "Space", 32); expect(await evaluate("window.counts.native")).toBe(before + 2);
    await key("Tab", "Tab", 9); const ariaFocus = await styles("aria");
    for (const prop of ["outlineStyle", "outlineWidth", "outlineOffset", "outlineColor"]) expect((observed.focus as any)[prop]).toBe(ariaFocus[prop]);
    await evaluate("window.disable(true)"); await settle(); observed.disabled = await styles("native"); expect((observed.disabled as any).opacity).toBe((await styles("aria")).opacity); expect((observed.disabled as any).opacity).toBe("0.5");
    await evaluate("window.ref.current.focus()"); expect(await evaluate("document.activeElement.id")).not.toBe("native");
    const disabledBefore = await evaluate("window.counts.native"); await click("native"); expect(await evaluate("window.counts.native")).toBe(disabledBefore);
    await evaluate("document.body.focus()"); await key("Tab", "Tab", 9); expect(await evaluate("document.activeElement.id")).toBe("submit");
    await evaluate("window.disable(false)"); await settle(); await click("annotation"); expect(await evaluate("window.counts.annotation")).toBe(1);
    await click("native"); expect(await evaluate("window.counts.submit")).toBe(0); await click("submit"); expect(await evaluate("window.counts.submit")).toBe(1); await click("prevent"); expect(await evaluate("window.counts.submit")).toBe(1);
    await evaluate("document.getElementById('value').value='changed'"); await click("reset"); expect(await evaluate("[window.counts.reset,document.getElementById('value').value]")).toEqual([1, "original"]);
    expect(await evaluate("window.ref.current===document.getElementById('native')")).toBe(true);
    await evaluate("window.ref.current.focus()"); expect(await evaluate("document.activeElement.id")).toBe("native");
    expect(await evaluate("['type','name','value','aria-labelledby','aria-describedby'].map(k=>window.ref.current.getAttribute(k))")).toEqual(["button", "intent", "save", "name", "description"]);
    observed.override = await styles("override"); expect(observed.override).toMatchObject({ backgroundColor: "rgb(1, 2, 3)", paddingTop: "19px", paddingLeft: "19px", opacity: "0.8", outlineStyle: "solid", outlineWidth: "3px", outlineOffset: "7px" });
    await evaluate("document.documentElement.style.setProperty('--color-action','rgb(17,34,51)')"); await evaluate("document.body.focus()"); await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 0, y: 0 }); await settle();
    observed.hostCascade = await styles("native"); expect((observed.hostCascade as any).backgroundColor).toBe("rgb(17, 34, 51)"); expect(appearance(observed.hostCascade)).toEqual(appearance(await styles("aria")));
    await evaluate("document.documentElement.removeAttribute('style');document.documentElement.dataset.theme='dark'"); await settle(); observed.dark = await styles("native"); expect(appearance(observed.dark)).toEqual(appearance(await styles("aria")));
    await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] }); await settle(); observed.reduced = await styles("native"); expect((observed.reduced as any).transitionProperty).toBe("none");
    await send("Emulation.setEmulatedMedia", { features: [{ name: "forced-colors", value: "active" }] }); await evaluate("document.body.focus()"); await key("Tab", "Tab", 9); observed.forced = await styles("native"); expect((observed.forced as any).outlineStyle).toBe("solid"); expect(parseFloat((observed.forced as any).outlineWidth)).toBeGreaterThanOrEqual(2);
    observed.activation = await evaluate("window.counts"); console.info("NativeAction actual Chrome observations", JSON.stringify(observed));
  } finally {
    await send("Browser.close", {}, "").catch(() => {}); child.kill(); rmSync(root, { recursive: true, force: true });
  }
}, 45_000);
