import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it } from "vitest";
import { SiteFooter } from "./SiteFooter.js";
import { CONTRAST_PAIRS } from "../tokens/contrast-pairs.js";

const tones = ["dark", "light"] as const;
const themes = ["light", "dark"] as const;
function footer(tone?: typeof tones[number]) {
  return <SiteFooter {...(tone === undefined ? {} : { tone })} secondary={<SiteFooter.Legal
    entity="Example" links={[{ label: "Privacy", href: "/privacy" }]}
    icons={[{ label: "Profile", href: "/profile", icon: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M4 12h16" /></svg> }]}
    home={{ label: "Home", href: "/", markSrc: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24'%3E%3Cpath fill='%23767676' d='M2 2h20v20H2z'/%3E%3C/svg%3E" }}
  />} />;
}

it("defaults to the explicit dark tone and gives each tone a fixed divider policy", () => {
  expect(renderToStaticMarkup(footer())).toBe(renderToStaticMarkup(footer("dark")));
  for (const tone of tones) {
    const host = document.createElement("div"); host.innerHTML = renderToStaticMarkup(footer(tone));
    const root = host.querySelector("footer")!;
    expect(root).toHaveAttribute("data-footer-tone", tone);
    expect(root).toHaveClass(`site-footer-${tone}`, tone === "dark" ? "bg-surface-inverse" : "bg-surface-base");
    if (tone === "dark") expect(root).not.toHaveClass("border-t");
    else expect(root).toHaveClass("border-t", "border-line-base");
    expect(root.querySelector(".border-t")).toBeNull();
  }
});

it("uses existing gated ink and muted ink contrast pairs for both footer polarities", () => {
  for (const [surface, inks] of [
    ["--color-surface-base", ["--color-ink-primary", "--color-ink-secondary"]],
    ["--color-surface-inverse", ["--color-ink-on-inverse", "--color-ink-on-inverse-muted"]],
  ] as const) for (const ink of inks) {
    expect(CONTRAST_PAIRS.some(pair => pair.foreground === ink && pair.background === surface && pair.minimumRatio >= 4.5)).toBe(true);
  }
});

type Paint = { radius: number; color: number[]; background: number[]; outline: number[]; outlineWidth: number; outlineOffset: number; outlineStyle: string; decoration: string; visible: boolean; focusVisible: boolean; width: number; height: number; stroke: number[] | null; plate: number[] | null; imageLoaded: boolean; imagePixel: number[] | null; imageFilter: string | null };
type Scene = { tonal: number[]; surface: number[]; ink: number[]; copyright: number[]; borderWidth: number; idle: Paint[]; hover: Paint[]; focus: Paint[]; forced: Paint[]; highlight: number[] };
let scenes: Record<string, Scene>;

// This is serialized into a separate Node process: no jsdom CSS or synthetic focus.
async function measureNativeFooter() {
  const { spawn } = require("node:child_process") as typeof import("node:child_process");
  const fs = require("node:fs") as typeof import("node:fs");
  const browser = spawn(process.argv[1]!, ["--headless", "--no-sandbox", "--disable-dev-shm-usage", "--remote-debugging-port=0", `--user-data-dir=${process.argv[3]}`, "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
  let socket: WebSocket | undefined;
  try {
    const endpoint = await new Promise<string>((resolve, reject) => {
      let output = "";
      browser.on("error", reject); browser.on("exit", code => reject(new Error(`Chromium exited (${code}): ${output}`)));
      browser.stderr!.on("data", chunk => { output += String(chunk); const found = output.match(/DevTools listening on (ws:\/\/\S+)/); if (found) resolve(found[1]!); });
    });
    socket = new WebSocket(endpoint); const client = socket;
    await new Promise<void>((resolve, reject) => { client.onopen = () => resolve(); client.onerror = reject; });
    let nextId = 0;
    const pending = new Map<number, { resolve(value: any): void; reject(error: Error): void }>();
    client.onmessage = event => { const response = JSON.parse(String(event.data)); const request = pending.get(response.id); if (request) { pending.delete(response.id); response.error ? request.reject(new Error(response.error.message)) : request.resolve(response.result); } };
    const command = (method: string, params = {}, sessionId?: string): Promise<any> => new Promise((resolve, reject) => { const id = ++nextId; pending.set(id, { resolve, reject }); client.send(JSON.stringify({ id, method, params, sessionId })); });
    const { targetId } = await command("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await command("Target.attachToTarget", { targetId, flatten: true });
    const send = (method: string, params = {}) => command(method, params, sessionId);
    const evaluate = async (expression: string) => {
      const response = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
      if (response.exceptionDetails) throw new Error(JSON.stringify(response.exceptionDetails));
      return response.result.value;
    };
    await send("Page.enable");
    await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
    const { frameTree } = await send("Page.getFrameTree");
    function installMeasurements() {
      const canvas = document.createElement("canvas"); canvas.width = canvas.height = 1;
      const context = canvas.getContext("2d", { willReadFrequently: true })!;
      const rgba = (color: string) => { context.clearRect(0, 0, 1, 1); context.fillStyle = color; context.fillRect(0, 0, 1, 1); return [...context.getImageData(0, 0, 1, 1).data]; };
      const root = document.querySelector("footer")!;
      const anchors = [...root.querySelectorAll<HTMLAnchorElement>("a")];
      const paint = (a: HTMLAnchorElement) => {
        const s = getComputedStyle(a), box = a.getBoundingClientRect(), svg = a.querySelector("svg"), img = a.querySelector("img"), plate = a.querySelector("[data-footer-home-plate]");
        return { radius: parseFloat(s.borderRadius), color: rgba(s.color), background: rgba(s.backgroundColor), outline: rgba(s.outlineColor), outlineWidth: parseFloat(s.outlineWidth), outlineOffset: parseFloat(s.outlineOffset), outlineStyle: s.outlineStyle, decoration: s.textDecorationLine,
          visible: s.visibility === "visible" && s.display !== "none" && Number(s.opacity) > 0 && (!svg || [svg, ...svg.querySelectorAll("*")].every(node => { const art = getComputedStyle(node); return art.visibility === "visible" && art.display !== "none" && Number(art.opacity) > 0; })) && (!img || (getComputedStyle(img).visibility === "visible" && Number(getComputedStyle(img).opacity) > 0)),
          focusVisible: a.matches(":focus-visible"), width: box.width, height: box.height,
          stroke: svg ? rgba(getComputedStyle(svg.querySelector("path")!).stroke) : null, plate: plate ? rgba(getComputedStyle(plate).backgroundColor) : null, imageLoaded: !img || (img.complete && img.naturalWidth > 0), imageFilter: img ? getComputedStyle(img).filter : null, imagePixel: img ? (() => { context.clearRect(0,0,1,1); context.drawImage(img, 12,12,1,1,0,0,1,1); return [...context.getImageData(0,0,1,1).data]; })() : null,
        };
      };
      Object.assign(window, { footerMeasure: { rgba, paint, anchors, root } });
    }
    const results: Record<string, unknown> = {};
    for (const doc of JSON.parse(fs.readFileSync(process.argv[2]!, "utf8"))) {
      await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }, { name: "forced-colors", value: "none" }] });
      await send("Page.setDocumentContent", { frameId: frameTree.frame.id, html: doc.html });
      await evaluate(`Promise.all([...document.images].map(img=>img.decode().catch(()=>{})))`);
      await evaluate(`(${installMeasurements.toString()})()`);
      const scene = await evaluate(`(()=>{const m=window.footerMeasure,s=getComputedStyle(m.root);return {surface:m.rgba(s.backgroundColor),ink:m.rgba(s.color),copyright:m.rgba(getComputedStyle(document.querySelector('[data-footer-region="copyright"]')).color),borderWidth:parseFloat(s.borderTopWidth),idle:m.anchors.map(m.paint),hover:[],focus:[],forced:[]}})()`);
      scene.tonal = await evaluate(`window.footerMeasure.rgba(getComputedStyle(document.documentElement).getPropertyValue('${doc.name.split("-")[0] !== doc.name.split("-")[1] ? "--color-control-tonal-inverse" : "--color-control-tonal"}'))`);
      for (let i = 0; i < 3; i++) {
        const point = await evaluate(`(()=>{const r=window.footerMeasure.anchors[${i}].getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
        await send("Input.dispatchMouseEvent", { type: "mouseMoved", ...point });
        scene.hover.push(await evaluate(`window.footerMeasure.paint(window.footerMeasure.anchors[${i}])`));
      }
      await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 0, y: 0 });
      await evaluate(`document.activeElement.blur()`);
      for (let i = 0; i < 3; i++) {
        await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
        await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
        scene.focus.push(await evaluate(`window.footerMeasure.paint(window.footerMeasure.anchors[${i}])`));
      }
      await send("Emulation.setEmulatedMedia", { features: [{ name: "forced-colors", value: "active" }] });
      await evaluate(`document.activeElement.blur()`);
      // Reset sequential navigation by refocusing the first link with keyboard modality.
      for (let i = 0; i < 3; i++) {
        await evaluate(`window.footerMeasure.anchors[${i}].focus()`);
        scene.forced.push(await evaluate(`window.footerMeasure.paint(window.footerMeasure.anchors[${i}])`));
      }
      scene.highlight = await evaluate(`(()=>{const p=document.createElement('span');p.style.color='Highlight';document.body.append(p);return window.footerMeasure.rgba(getComputedStyle(p).color)})()`);
      results[doc.name] = scene;
    }
    process.stdout.write(JSON.stringify(results));
  } finally { socket?.close(); browser.kill(); }
}

beforeAll(() => {
  const browser = ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"].find(name => spawnSync(name, ["--version"], { stdio: "ignore" }).status === 0);
  if (!browser) throw new Error("Footer tone proof requires real Chromium on PATH.");
  const css = readFileSync(join(import.meta.dirname, "../../styles/tokens.css"), "utf8") + "\n" + readFileSync(join(import.meta.dirname, "../../styles/compiled.css"), "utf8");
  const directory = mkdtempSync(join(tmpdir(), "footer-tone-"));
  try {
    const documents = join(directory, "documents.json");
    writeFileSync(documents, JSON.stringify(themes.flatMap(theme => tones.map(tone => ({ name: `${theme}-${tone}`, html: `<!doctype html><html data-theme="${theme}"><meta charset="utf-8"><style>${css}</style><body>${renderToStaticMarkup(footer(tone))}</body></html>` })))));
    scenes = JSON.parse(execFileSync(process.execPath, ["--experimental-websocket", "-e", `(${measureNativeFooter.toString()})().catch(error=>{console.error(error);process.exitCode=1})`, browser, documents, join(directory, "profile")], { encoding: "utf8", timeout: 45000, maxBuffer: 4 * 1024 * 1024 }));
  } finally { rmSync(directory, { recursive: true, force: true }); }
}, 60000);

function composite(foreground: number[], background: number[]) { const alpha = foreground[3]! / 255; return foreground.slice(0, 3).map((channel, i) => channel * alpha + background[i]! * (1 - alpha)); }
function luminance(color: number[]) { return color.slice(0, 3).reduce((sum, channel, i) => { const c = channel / 255; return sum + (c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4) * [.2126, .7152, .0722][i]!; }, 0); }
function contrast(ink: number[], ground: number[]) { const a = luminance(composite(ink, ground)), b = luminance(ground); return (Math.max(a, b) + .05) / (Math.min(a, b) + .05); }

for (const theme of themes) for (const tone of tones) describe(`native footer ${tone} in ${theme} theme`, () => {
  const scene = () => scenes[`${theme}-${tone}`]!;
  it("paints the chosen polarity with readable text, copyright and the unchanged home plate", () => {
    const s = scene();
    expect(luminance(s.surface))[tone === "dark" ? "toBeLessThan" : "toBeGreaterThan"](.5);
    expect(s.surface[3]).toBe(255);
    expect(contrast(s.ink, s.surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(s.copyright, s.surface)).toBeGreaterThanOrEqual(4.5);
    expect(s.borderWidth)[tone === "dark" ? "toBe" : "toBeGreaterThan"](0);
    expect(s.idle[2]!.plate![3]).toBe(255);
    expect(s.idle[2]!.imageLoaded).toBe(true);
    expect(s.idle[2]!.imagePixel).toEqual([118, 118, 118, 255]);
    expect(contrast(s.idle[2]!.imagePixel!, s.idle[2]!.plate!)).toBeGreaterThanOrEqual(3);
    expect(s.idle[2]!.imageFilter).toBe("none");
  });
  it("keeps idle social artwork in current ink and every icon target at least 44px square", () => {
    const s = scene();
    expect(s.idle[1]!.stroke).toEqual(s.ink);
    for (const target of s.idle.slice(1)) {
      expect(target.visible).toBe(true); expect(target.width).toBeGreaterThanOrEqual(44); expect(target.height).toBeGreaterThanOrEqual(44);
      expect(target.background[3]).toBe(0); expect(target.color).toEqual(s.ink);
    }
  });
  it("fills icons on hover and keyboard focus while preserving ordinary text hyperlinks", () => {
    const s = scene();
    expect(s.idle[0]!.radius).toBe(0);
    expect(s.hover[0]!.decoration).toContain("underline"); expect(s.hover[0]!.background[3]).toBe(0);
    for (let i = 1; i < 3; i++) for (const target of [s.hover[i]!, s.focus[i]!]) {
      expect(target.background[3]).toBeGreaterThan(0); expect(target.background).toEqual(s.tonal); expect(target.decoration).not.toContain("underline");
      expect(composite(target.background, s.surface)).not.toEqual(s.surface.slice(0, 3));
      expect(contrast(target.color, [...composite(target.background, s.surface), 255])).toBeGreaterThanOrEqual(4.5);
    }
  });
  it("draws an actual keyboard focus-visible ring with tone ink and an outward offset", () => {
    const s = scene();
    for (const target of [...s.focus.slice(1), s.focus[0]!]) {
      expect(target.focusVisible).toBe(true); expect(target.outlineStyle).toBe("solid");
      expect(target.outlineWidth).toBeGreaterThanOrEqual(2); expect(target.outlineOffset).toBeGreaterThanOrEqual(2);
      expect(target.outline).toEqual(s.ink); expect(contrast(target.outline, s.surface)).toBeGreaterThanOrEqual(3);
    }
  });
  it("keeps a system Highlight outline under real forced-colors emulation", () => {
    const s = scene();
    for (const target of [...s.forced.slice(1), s.forced[0]!]) {
      expect(target.focusVisible).toBe(true); expect(target.outlineStyle).toBe("solid"); expect(target.outlineWidth).toBeGreaterThanOrEqual(2);
      expect(target.outline).toEqual(s.highlight); expect(target.outline[3]).toBeGreaterThan(0);
    }
  });
});
