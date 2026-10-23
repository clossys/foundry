#!/usr/bin/env node
/** Agent-run, explicit-target browser observations; never a CI or package script. */
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawn, spawnSync } from "node:child_process";

/** Distinct exit code: the CDP client needs a WebSocket this Node cannot provide. */
export const EXIT_NO_WEBSOCKET = 3;
const WIDTHS = [320, 390, 640, 768];
const CHECKS = ["overflow", "tap-target", "forced-colors-focus", "reduced-motion-animation", "pending-layout-shift"];
export function parseArgs(args) {
  let url;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] !== "--url") throw new Error(`Unknown option: ${args[index]}`);
    if (url || !args[index + 1]) throw new Error("Supply exactly one --url HTTP(S) target");
    url = args[++index];
  }
  if (!url) throw new Error("An explicit --url HTTP(S) target is required");
  let parsed;
  try { parsed = new URL(url); } catch { throw new Error("--url must be an HTTP(S) URL"); }
  if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("--url must use HTTP(S)");
  return { url: parsed.href, widths: [...WIDTHS] };
}

export function buildReport({ url, observations, skippedReason }) {
  const counts = { pass: 0, finding: 0, unverified: 0 };
  for (const observation of observations) {
    if (!Object.hasOwn(counts, observation.status)) throw new Error("Invalid observation status");
    counts[observation.status] += 1;
  }
  const complete = WIDTHS.every(width => CHECKS.every(check => observations.some(item => item.width === width && item.check === check)));
  const status = skippedReason ? "skipped" : counts.finding ? "finding" : !complete || counts.unverified ? "unverified" : "pass";
  return { url, measuredAt: new Date().toISOString(), widths: [...WIDTHS], status, counts, observations,
    ...(skippedReason ? { reason: skippedReason } : {}) };
}

/**
 * True only when the target's own host is a loopback address: `localhost`,
 * 127.0.0.0/8 or `[::1]` (the URL parser has already normalized shorthand
 * IPv4 forms such as `127.1`).
 *
 * Documented limit: this checks the initial target's hostname only. It does
 * not contain where the page goes next: a loopback page can still redirect,
 * navigate, or load subresources from a remote origin, and nothing here
 * blocks or re-checks those requests.
 */
export function isLoopbackTarget(url) {
  const { hostname } = new URL(url);
  return hostname === "localhost" || hostname === "[::1]" || /^127(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}$/.test(hostname);
}

/** Chromium's own sandbox stays on for any non-loopback target; it is disabled only for a local fixture or dev server. */
export function browserLaunchArgs(url, profile) {
  return ["--headless=new", ...(isLoopbackTarget(url) ? ["--no-sandbox"] : []), "--disable-dev-shm-usage",
    "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"];
}

function chromePath() {
  // Only the explicit browser selector is read; no ambient credentials or caches.
  return [process.env.CHROME_PATH, "/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"].find(path => path && existsSync(path));
}
const delay = ms => new Promise(done => setTimeout(done, ms));
async function connect(endpoint) {
  const socket = new WebSocket(endpoint);
  await new Promise((resolve, reject) => { socket.addEventListener("open", resolve, { once: true }); socket.addEventListener("error", reject, { once: true }); });
  let sequence = 0;
  const pending = new Map();
  socket.addEventListener("message", ({ data }) => {
    const message = JSON.parse(String(data));
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id); clearTimeout(request.timer);
    if (message.error) request.reject(new Error(message.error.message)); else request.resolve(message.result);
  });
  socket.addEventListener("close", () => {
    for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new Error("Browser connection closed")); }
    pending.clear();
  });
  return {
    send(method, params = {}, sessionId) {
      const id = ++sequence;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timed out: ${method}`)); }, 15000);
        pending.set(id, { resolve, reject, timer });
        socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
      });
    },
    close: () => socket.close(),
  };
}

async function sweep(browser, options) {
  const profile = mkdtempSync(join(tmpdir(), "foundry-state-sweep-"));
  let child;
  let cdp;
  try {
    child = spawn(browser, browserLaunchArgs(options.url, profile), { stdio: ["ignore", "ignore", "pipe"] });
    const endpoint = await new Promise((resolve, reject) => {
      let output = "";
      const tail = () => output.trim().split("\n").slice(-5).join(" | ").slice(0, 600);
      const timeout = setTimeout(() => reject(new Error(`Chromium did not expose a debugging endpoint within 30s: ${tail()}`)), 30000);
      child.once("error", error => { clearTimeout(timeout); reject(error); });
      child.once("exit", code => { clearTimeout(timeout); reject(new Error(`Chromium exited before connection (${code}): ${tail()}`)); });
      child.stderr.on("data", chunk => {
        output += String(chunk);
        const match = /DevTools listening on (ws:\/\/[^\s]+)/.exec(output);
        if (match) { clearTimeout(timeout); resolve(match[1]); }
      });
    });
    cdp = await connect(endpoint);
    const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
    const send = (method, params) => cdp.send(method, params, sessionId);
    await send("Page.enable"); await send("Runtime.enable");
    const evaluate = async expression => {
      const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
      return result.result.value;
    };
    const observations = [];
    for (const width of options.widths) {
      await send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: false });
      await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "dark" }, { name: "forced-colors", value: "active" }, { name: "prefers-reduced-motion", value: "reduce" }] });
      const navigation = await send("Page.navigate", { url: options.url });
      if (navigation.errorText) throw new Error(`Navigation failed: ${navigation.errorText}`);
      let loaded = false;
      for (let attempt = 0; attempt < 100; attempt += 1) {
        if (await evaluate("document.readyState === 'complete'")) { loaded = true; break; }
        await delay(100);
      }
      if (!loaded) throw new Error("Target did not finish loading");
      // Inspect native keyboard navigation before our scroll-based hit scan
      // can change its initial sequential-navigation starting point.
      await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
      await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
      let focus = null;
      // Input dispatch can return before the native Tab focus transition. Observe
      // that transition; never substitute programmatic focus for keyboard proof.
      for (let attempt = 0; attempt < 20; attempt += 1) {
        focus = await evaluate(`(() => {
          const el = document.activeElement;
          if (!document.hasFocus() || !el || el === document.body) return null;
          const style = getComputedStyle(el);
          return { tag: el.tagName, id: el.id, outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth, outlineColor: style.outlineColor };
        })()`);
        if (focus) break;
        await delay(25);
      }
      const layout = await evaluate(`(() => {
        const root = document.documentElement;
        const targets = [...document.querySelectorAll('a[href],button,input,textarea,select,[tabindex]')].filter(el => {
          const style = getComputedStyle(el);
          return el.tabIndex >= 0 && !el.disabled && style.display !== 'none' && style.visibility !== 'hidden' && el.getClientRects().length;
        });
        const small = [], unverified = [], measured = [];
        for (const el of targets) {
          el.scrollIntoView({ block: 'center', inline: 'nearest' });
          const rect = el.getBoundingClientRect(), style = getComputedStyle(el), before = getComputedStyle(el, '::before');
          const identity = { tag: el.tagName, id: el.id };
          let transformed = !Number.isFinite(el.offsetWidth) || !Number.isFinite(el.offsetHeight)
            || Math.abs(rect.width - el.offsetWidth) > 1 || Math.abs(rect.height - el.offsetHeight) > 1;
          for (let node = el; node; node = node.parentElement) {
            if (getComputedStyle(node).transform !== 'none') { transformed = true; break; }
          }
          if (transformed) { unverified.push({ ...identity, reason: 'Transformed target geometry needs verification' }); continue; }
          const candidates = [{ x: rect.x, y: rect.y, width: rect.width, height: rect.height, source: 'element' }];
          const hasPseudo = before.content !== 'none' && before.content !== 'normal' && before.pointerEvents !== 'none';
          let unresolvedPseudo = false;
          if (hasPseudo) {
            const px = value => /^-?(?:[0-9]+(?:[.][0-9]+)?|[.][0-9]+)px$/.test(value) ? parseFloat(value) : NaN;
            const number = property => px(before[property]);
            const width = number('width'), height = number('height');
            const extraWidth = before.boxSizing === 'border-box' ? 0
              : number('paddingLeft') + number('paddingRight') + number('borderLeftWidth') + number('borderRightWidth');
            const extraHeight = before.boxSizing === 'border-box' ? 0
              : number('paddingTop') + number('paddingBottom') + number('borderTopWidth') + number('borderBottomWidth');
            const boxWidth = width + extraWidth, boxHeight = height + extraHeight;
            const left = Number.isFinite(number('left')) ? number('left') : el.clientWidth - number('right') - boxWidth;
            const top = Number.isFinite(number('top')) ? number('top') : el.clientHeight - number('bottom') - boxHeight;
            const geometry = [boxWidth, boxHeight, left, top, px(style.borderLeftWidth), px(style.borderTopWidth)];
            if (before.position === 'absolute' && style.position !== 'static' && before.transform === 'none'
              && geometry.every(Number.isFinite)) {
              candidates.push({ x: rect.x + px(style.borderLeftWidth) + left,
                y: rect.y + px(style.borderTopWidth) + top, width: boxWidth, height: boxHeight, source: 'before' });
            } else unresolvedPseudo = true;
          }
          const hitArea = candidates.filter(box => box.width >= 44 && box.height >= 44).find(box => {
            // Verify a real minimum target inside ONE measured footprint, never
            // a rectangle assembled from unrelated width/height maxima.
            const x = box.x + (box.width - 44) / 2, y = box.y + (box.height - 44) / 2;
            const points = [[x+1,y+1],[x+43,y+1],[x+1,y+43],[x+43,y+43],[x+22,y+22],
              [x+22,y+1],[x+22,y+43],[x+1,y+22],[x+43,y+22]];
            // Only the TOPMOST hit counts: an element deeper in the stack sits
            // under a cover and would never receive the click.
            return points.every(([x,y]) => { const top = document.elementsFromPoint(x,y)[0]; return !!top && el.contains(top); });
          });
          if (hitArea) measured.push({ ...identity, footprint: hitArea, verifiedMinimum: { inlineSize: 44, blockSize: 44 } });
          else if (unresolvedPseudo) unverified.push({ ...identity, reason: 'Pseudo-element geometry needs verification' });
          else small.push({ ...identity, footprints: candidates, reason: 'No verified 44px hit area' });
        }
        const loops = document.getAnimations().filter(animation => animation.playState === 'running' && animation.effect?.getTiming().iterations === Infinity).length;
        return { scrollWidth: root.scrollWidth, clientWidth: root.clientWidth, targetCount: targets.length, small, unverified, measured, loops };
      })()`);
      observations.push({ width, check: "overflow", status: layout.scrollWidth > layout.clientWidth ? "finding" : "pass", details: { scrollWidth: layout.scrollWidth, clientWidth: layout.clientWidth } });
      observations.push({ width, check: "tap-target", status: layout.small.length ? "finding" : !layout.targetCount || layout.unverified.length ? "unverified" : "pass", details: { targetCount: layout.targetCount, small: layout.small, unverified: layout.unverified, measured: layout.measured } });
      observations.push({ width, check: "reduced-motion-animation", status: layout.loops ? "finding" : "pass", details: { runningInfiniteAnimations: layout.loops } });
      observations.push({ width, check: "forced-colors-focus", status: !focus ? "unverified" : focus.outlineStyle !== "none" && parseFloat(focus.outlineWidth) > 0 ? "pass" : "finding", details: focus ?? { reason: "No keyboard focus target observed" } });
      const pending = await evaluate(`(async () => {
        const target = document.querySelector('[data-state-sweep-pending]');
        if (!target || typeof PerformanceObserver !== 'function' || !PerformanceObserver.supportedEntryTypes.includes('layout-shift')) return null;
        let shift = 0;
        const observer = new PerformanceObserver(list => { for (const item of list.getEntries()) shift += item.value; });
        observer.observe({ type: 'layout-shift' });
        target.click();
        await new Promise(resolve => setTimeout(resolve, 800));
        for (const item of observer.takeRecords()) shift += item.value;
        observer.disconnect(); return { cumulativeShift: shift };
      })()`);
      observations.push({ width, check: "pending-layout-shift", status: !pending ? "unverified" : pending.cumulativeShift > 0 ? "finding" : "pass", details: pending ?? { reason: "No opted-in data-state-sweep-pending probe or layout-shift observer" } });
    }
    return buildReport({ url: options.url, observations });
  } finally {
    cdp?.close();
    if (child && child.exitCode === null) {
      child.kill("SIGTERM");
      await Promise.race([new Promise(done => child.once("exit", done)), delay(2000)]);
      if (child.exitCode === null) { child.kill("SIGKILL"); await new Promise(done => child.once("exit", done)); }
    }
    // Best-effort: browser helper processes can still be writing into the profile, and a leaked temp profile must never lose the report.
    try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch {}
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const browser = chromePath();
  if (!browser) {
    const reason = "SKIPPED: no Chromium executable available; needs runtime verification";
    console.error(reason);
    console.log(JSON.stringify(buildReport({ url: options.url, observations: [], skippedReason: reason }), null, 2));
    return 0;
  }
  if (typeof globalThis.WebSocket !== "function") {
    // Node 20.10+ ships the client only behind a flag (global from Node 22), and
    // a flag cannot be set after startup: re-run this script once with it.
    if (!process.env.STATE_SWEEP_WEBSOCKET_RETRY) {
      const rerun = spawnSync(process.execPath, ["--experimental-websocket", ...process.argv.slice(1)],
        { stdio: "inherit", env: { ...process.env, STATE_SWEEP_WEBSOCKET_RETRY: "1" } });
      if (rerun.status !== null && rerun.status !== 9) return rerun.status; // 9 = this Node rejects the flag
    }
    console.error(`UNAVAILABLE: Node ${process.versions.node} has no WebSocket client (needs Node 20.10+ or 22+); the sweep cannot drive the browser`);
    return EXIT_NO_WEBSOCKET;
  }
  const report = await sweep(browser, options);
  console.log(JSON.stringify(report, null, 2));
  return report.status === "pass" ? 0 : 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().then(code => { process.exitCode = code; }, error => { console.error(error.message); process.exitCode = 1; });
}
