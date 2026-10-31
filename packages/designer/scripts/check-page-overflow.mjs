#!/usr/bin/env node
/**
 * Render check for installed pages (read-only): no horizontal overflow and no empty
 * decoration, at 375, 768 and 1280 by default, in headless Chrome.
 *
 *   node check-page-overflow.mjs --url <served page base> --pages home,contact
 *        [--widths 375,768,1280] [--themes light,dark] [--shots <dir>]
 *
 * The base is the publishing substrate serving `clossys publish --install` output;
 * each page loads at `<url>?page=<id>` (and `&theme=dark` for dark). Findings:
 *   overflow     document scrollWidth exceeds the viewport (the page scrolls sideways)
 *   scroll       an element scrolls horizontally: content does not fit the measure
 *   clipped      an element hides horizontal overflow it actually has (bleed cut off);
 *                visually hidden (sr-only) elements are clipped by design and skipped
 *   decoration   a visible box of 4000px² or more with no text, media or control in it
 * `--shots` also writes `<page>-<width>-<theme>.png` full-page screenshots.
 * CHROME_BIN overrides the Chrome path. Exit 1 on any finding.
 */
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Runs in the page: raw measurements only; `pageFindings` turns them into findings. */
export const MEASURE = `(() => {
  const vw = document.documentElement.clientWidth
  const label = (el) => (el.getAttribute('data-slot') || el.id || el.tagName.toLowerCase()) + (el.className && typeof el.className === 'string' ? '.' + el.className.split(/\\s+/).slice(0, 3).join('.') : '')
  const out = { viewport: vw, scrollWidth: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight, beyond: [], scroll: [], clipped: [], empty: [] }
  const MEDIA = 'img,svg,video,canvas,picture,iframe,input,textarea,select,button,[role=img]'
  // Visually hidden (sr-only: a 1px box clipped to nothing) is clipped by design and never paints;
  // it and everything inside it are skipped, so the skip link and table captions are not findings.
  const hiddenCache = new Map()
  const visuallyHidden = (el) => {
    if (!el || el === document.body) return false
    if (hiddenCache.has(el)) return hiddenCache.get(el)
    const cs = getComputedStyle(el), r = el.getBoundingClientRect()
    const own = cs.clip === 'rect(0px, 0px, 0px, 0px)' || cs.clipPath === 'inset(50%)' || (cs.position === 'absolute' && r.width <= 1 && r.height <= 1 && cs.overflow === 'hidden')
    const hidden = own || visuallyHidden(el.parentElement)
    hiddenCache.set(el, hidden)
    return hidden
  }
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect()
    if (!r.width || !r.height) continue
    const cs = getComputedStyle(el)
    if (cs.visibility === 'hidden' || cs.display === 'none' || visuallyHidden(el)) continue
    if (r.right > vw + 0.5 || r.left < -0.5) out.beyond.push(label(el) + ' ' + Math.round(r.left) + '..' + Math.round(r.right))
    const extra = el.scrollWidth - el.clientWidth
    if (extra > 1 && el.clientWidth > 0) {
      if (cs.overflowX === 'auto' || cs.overflowX === 'scroll') out.scroll.push(label(el) + ' +' + extra + 'px')
      else if ((cs.overflowX === 'hidden' || cs.overflowX === 'clip') && !/ellipsis/.test(cs.textOverflow)) out.clipped.push(label(el) + ' +' + extra + 'px')
    }
    const painted = (cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && cs.backgroundColor !== 'transparent') || cs.backgroundImage !== 'none' ||
      ['Top', 'Right', 'Bottom', 'Left'].some((s) => parseFloat(cs['border' + s + 'Width']) > 0 && cs['border' + s + 'Style'] !== 'none')
    if (painted && r.width * r.height >= 4000 && !el.textContent.trim() && !el.matches(MEDIA) && !el.querySelector(MEDIA)) out.empty.push(label(el) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height))
  }
  return out
})()`;

/** Findings for one measured page view. */
export function pageFindings(view, measure) {
  const findings = [];
  if (measure.scrollWidth > measure.viewport) findings.push(`overflow: ${view} scrollWidth ${measure.scrollWidth} > ${measure.viewport}${measure.beyond.length ? ` (${measure.beyond.slice(0, 5).join("; ")})` : ""}`);
  for (const row of measure.scroll) findings.push(`scroll: ${view} ${row}`);
  for (const row of measure.clipped) findings.push(`clipped: ${view} ${row}`);
  for (const row of measure.empty) findings.push(`decoration: ${view} empty box ${row}`);
  return findings;
}

const list = (args, flag, fallback) => { const at = args.indexOf(flag); return at < 0 ? fallback : args[at + 1].split(",").filter(Boolean); };
const sleep = ms => new Promise(done => setTimeout(done, ms));

async function main(args) {
  const url = list(args, "--url", [])[0];
  const pages = list(args, "--pages", []);
  if (!url || !pages.length) { console.error("usage: check-page-overflow.mjs --url <base> --pages <id,...> [--widths 375,768,1280] [--themes light,dark] [--shots <dir>]"); return 2; }
  const widths = list(args, "--widths", ["375", "768", "1280"]).map(Number);
  const themes = list(args, "--themes", ["light"]);
  const shots = list(args, "--shots", [])[0];
  if (shots) mkdirSync(shots, { recursive: true });
  const port = 9300 + Math.floor(Math.random() * 500);
  const profile = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "page-overflow-"));
  const chrome = spawn(process.env.CHROME_BIN ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "--no-first-run", "--hide-scrollbars", "about:blank"], { stdio: "ignore" });
  try {
    let target;
    for (let i = 0; i < 50 && !target; i++) {
      await sleep(200);
      try { target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find(row => row.type === "page"); } catch {}
    }
    if (!target) throw new Error("headless Chrome did not start");
    const socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise(done => socket.addEventListener("open", done));
    let id = 0;
    const pending = new Map();
    socket.addEventListener("message", message => { const data = JSON.parse(message.data); pending.get(data.id)?.(data); pending.delete(data.id); });
    const send = (method, params = {}) => new Promise(done => { const n = ++id; pending.set(n, done); socket.send(JSON.stringify({ id: n, method, params })); });
    await send("Page.enable");
    const findings = [];
    const report = {};
    for (const page of pages) for (const theme of themes) for (const width of widths) {
      const view = `${page}@${width}/${theme}`;
      await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: theme }] });
      await send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 768 });
      const query = `page=${encodeURIComponent(page)}${theme === "dark" ? "&theme=dark" : ""}`;
      await send("Page.navigate", { url: `${url}${url.includes("?") ? "&" : "?"}${query}` });
      await sleep(3000);
      await send("Runtime.evaluate", { expression: "document.fonts.ready", awaitPromise: true });
      const measured = (await send("Runtime.evaluate", { expression: MEASURE, returnByValue: true })).result?.result?.value;
      if (!measured) { findings.push(`render: ${view} did not measure`); continue; }
      report[view] = { scrollWidth: measured.scrollWidth, viewport: measured.viewport };
      findings.push(...pageFindings(view, measured));
      if (shots) {
        const shot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, clip: { x: 0, y: 0, width, height: measured.height, scale: 1 } });
        writeFileSync(join(shots, `${page}-${width}-${theme}.png`), Buffer.from(shot.result.data, "base64"));
      }
    }
    socket.close();
    console.log(JSON.stringify(report));
    if (findings.length) { console.error(`check-page-overflow: FAIL (${findings.length})\n- ${findings.join("\n- ")}`); return 1; }
    console.log(`check-page-overflow: ok; ${Object.keys(report).length} views, scrollWidth = viewport, no scroll, clip or empty decoration`);
    return 0;
  } finally {
    // Chrome keeps writing its profile until it exits; remove the profile only after that.
    const exited = chrome.exitCode !== null ? Promise.resolve() : new Promise(done => chrome.once("exit", done));
    chrome.kill();
    await Promise.race([exited, sleep(5000)]);
    rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) process.exit(await main(process.argv.slice(2)));
