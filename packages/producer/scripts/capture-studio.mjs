#!/usr/bin/env node
// Deterministic Studio page acceptance: start the built producer, capture every route the
// generated Studio map publishes at 375/768/1280 in light and dark, record mechanical findings
// per shot, and exit 1 when any failing finding exists. A browser is never downloaded: the run
// uses an already-installed Chromium/Chrome and reports BLOCKED (exit 2) when none exists.

import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";

const producerDir = fileURLToPath(new URL("../", import.meta.url));
const repoRoot = resolve(producerDir, "../..");
export const DEFAULT_MAP = join(producerDir, "studio/generated/studio-map.json");
export const WIDTHS = Object.freeze([375, 768, 1280]);
export const THEMES = Object.freeze(["light", "dark"]);
export const DEFAULT_PORT = 4620;
export const DIFF_LIMIT = 0.02;
/** Failing finding types, in severity order (first is worst). */
export const FAILING = Object.freeze(["console-error", "failed-request", "unresolved-copy", "empty-specimen", "id-label", "overflow", "readiness-timeout"]);
const UNRESOLVED = "Studio copy is unresolved";

// ---------------------------------------------------------------- route enumeration

/**
 * Every route the generated Studio map publishes: each installed page route plus each leaf
 * (the dynamic `[slug]` instances). Redirects are aliases of these and are not captured.
 */
export function enumerateRoutes(map) {
  if (!map || !Array.isArray(map.routes)) throw new Error("studio-map.json has no routes array");
  const seen = new Set();
  const routes = [];
  const add = (path, label, kind, id) => {
    if (typeof path !== "string" || !path.startsWith("/") || seen.has(path)) return;
    seen.add(path);
    routes.push({ path, label: label ?? path, kind, id: id ?? path });
  };
  for (const route of map.routes) add(route.path, route.label, "page", route.instanceId);
  for (const leaf of map.leaves ?? []) add(leaf.path, leaf.title, "leaf", `${leaf.page}/${leaf.slug}`);
  return routes;
}

// ---------------------------------------------------------------- in-page probe

/**
 * Runs inside the page (serialised with toString). Collects raw facts only; judgement lives in
 * detectFindings so it can be tested without a browser.
 */
export function pageProbe() {
  const doc = document;
  const visible = el => {
    if (!el || !el.getClientRects || el.getClientRects().length === 0) return false;
    const style = getComputedStyle(el);
    return style.visibility !== "hidden" && style.display !== "none";
  };
  const LABEL_SELECTOR = "h1,h2,h3,h4,h5,h6,label,legend,button,a,th,dt,summary,[role=tab],[role=heading],[role=menuitem],[data-slot$=title],[data-slot=breadcrumb-page]";
  const labels = [];
  for (const el of doc.querySelectorAll(LABEL_SELECTOR)) {
    if (!visible(el)) continue;
    const text = (el.innerText ?? el.textContent ?? "").trim().replace(/\s+/g, " ");
    if (text) labels.push({ tag: el.tagName.toLowerCase(), text: text.slice(0, 200) });
  }
  // A title attribute is shown as a tooltip; aria-label is not visible text, so it is not scanned.
  for (const el of doc.querySelectorAll("[title]")) {
    if (!visible(el)) continue;
    const text = el.getAttribute("title")?.trim();
    if (text) labels.push({ tag: "@title", text: text.slice(0, 200) });
  }
  if (doc.title) labels.push({ tag: "title", text: doc.title.trim() });
  const specimens = [];
  for (const el of doc.querySelectorAll("[data-specimen],[data-specimen-state],[data-preview-status]")) {
    specimens.push({ kind: "host", state: el.getAttribute("data-specimen-state") ?? el.getAttribute("data-specimen") ?? "", status: el.getAttribute("data-preview-status") ?? "" });
  }
  const frames = [];
  for (const frame of doc.querySelectorAll("iframe")) {
    let readyState = "unknown", text = "", media = 0;
    try {
      const inner = frame.contentDocument;
      if (inner) {
        readyState = inner.readyState;
        text = (inner.body?.innerText ?? inner.body?.textContent ?? "").trim();
        // Painted boxes: any element in the frame body with an area (a colour swatch has no text).
        for (const el of [...(inner.body?.querySelectorAll("*") ?? [])].slice(0, 400)) {
          if (["SCRIPT", "STYLE", "TEMPLATE", "NOSCRIPT"].includes(el.tagName)) continue;
          const box = el.getBoundingClientRect();
          if (box.width > 0 && box.height > 0) { media++; break; }
        }
      }
    } catch { readyState = "cross-origin"; }
    const rect = frame.getBoundingClientRect();
    frames.push({ src: frame.getAttribute("src") ?? "", readyState, loading: frame.getAttribute("loading") ?? "", height: rect.height, width: rect.width, textLength: text.length, media, hidden: !visible(frame) });
  }
  const root = doc.documentElement;
  return {
    readyState: doc.readyState,
    scrollWidth: root.scrollWidth,
    clientWidth: root.clientWidth,
    bodyText: (doc.body?.innerText ?? doc.body?.textContent ?? "").slice(0, 200000),
    labels,
    specimens,
    frames,
  };
}

/** Is the probed page settled: document complete, no loading specimen, every visible frame loaded. */
export function isSettled(facts) {
  if (facts.readyState !== "complete") return false;
  if (facts.specimens.some(s => s.state === "loading")) return false;
  return facts.frames.every(f => f.hidden || f.readyState === "complete" || f.readyState === "cross-origin");
}

// ---------------------------------------------------------------- finding detectors

const ID_TOKEN = /\b[a-z][a-z0-9]*(?:\.[a-z0-9][a-z0-9-]*)+\b/g;
const NOT_ID_SUFFIX = new Set(["com", "org", "net", "io", "dev", "ai", "app", "co", "json", "js", "mjs", "cjs", "ts", "tsx", "css", "md", "png", "svg", "jpg", "html", "txt"]);
const NOT_ID_WORD = new Set(["e.g", "i.e", "etc", "vs"]);

/** Id-like tokens (e.g. `sections.studio.home`, `context.market.size`) shown in label text. */
export function idTokens(text) {
  const tokens = [];
  for (const match of String(text).matchAll(ID_TOKEN)) {
    const token = match[0];
    const last = token.slice(token.lastIndexOf(".") + 1);
    if (NOT_ID_WORD.has(token) || NOT_ID_SUFFIX.has(last)) continue;
    // Version-like and numeric tokens are not ids.
    if (/^\d/.test(last)) continue;
    tokens.push(token);
  }
  return tokens;
}

/**
 * Turn probe facts plus the shot's console/network events into findings.
 * Each finding: { type, detail }. Types in FAILING fail the run.
 */
export function detectFindings(facts, events = {}) {
  const findings = [];
  for (const message of events.consoleErrors ?? []) findings.push({ type: "console-error", detail: String(message).slice(0, 500) });
  for (const request of events.failedRequests ?? []) findings.push({ type: "failed-request", detail: `${request.status ?? request.errorText ?? "failed"} ${request.url}`.slice(0, 500) });
  if (events.timedOut) findings.push({ type: "readiness-timeout", detail: events.timedOut });
  if (!facts) return findings;
  if (facts.scrollWidth > facts.clientWidth) findings.push({ type: "overflow", detail: `scrollWidth ${facts.scrollWidth} > clientWidth ${facts.clientWidth}` });
  const seen = new Set();
  for (const label of facts.labels ?? []) {
    for (const token of idTokens(label.text)) {
      const key = `${label.tag}:${token}`;
      if (seen.has(key)) continue;
      seen.add(key);
      findings.push({ type: "id-label", detail: `${label.tag} "${label.text.slice(0, 80)}" shows ${token}` });
    }
  }
  for (const specimen of facts.specimens ?? []) {
    if (specimen.status === "unavailable") findings.push({ type: "empty-specimen", detail: "specimen reports unavailable" });
    else if (specimen.state === "empty") findings.push({ type: "empty-specimen", detail: "specimen reports empty" });
  }
  for (const frame of facts.frames ?? []) {
    if (frame.hidden) continue;
    if (frame.height < 2) findings.push({ type: "empty-specimen", detail: `frame ${frame.src} has no height` });
    else if (frame.readyState === "complete" && frame.textLength === 0 && frame.media === 0) findings.push({ type: "empty-specimen", detail: `frame ${frame.src} painted nothing` });
  }
  if ((facts.bodyText ?? "").includes(UNRESOLVED)) {
    const line = facts.bodyText.slice(facts.bodyText.indexOf(UNRESOLVED)).split("\n")[0];
    findings.push({ type: "unresolved-copy", detail: line.slice(0, 200) });
  }
  return findings;
}

export function severityOf(findings) {
  let score = 0;
  for (const finding of findings) {
    const rank = FAILING.indexOf(finding.type);
    if (rank >= 0) score += 10 ** (FAILING.length - rank);
  }
  return score;
}

// ---------------------------------------------------------------- PNG decode and diff

/** Decode an 8-bit, non-interlaced RGB/RGBA PNG (what Chrome emits) to RGBA pixels. */
export function decodePng(buffer) {
  if (buffer.readUInt32BE(0) !== 0x89504e47) throw new Error("not a PNG");
  let offset = 8, width = 0, height = 0, colorType = 0, depth = 0, interlace = 0;
  const idat = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") { width = data.readUInt32BE(0); height = data.readUInt32BE(4); depth = data[8]; colorType = data[9]; interlace = data[12]; }
    else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    offset += 12 + length;
  }
  if (depth !== 8 || interlace !== 0 || ![2, 6].includes(colorType)) throw new Error("unsupported PNG layout");
  const channels = colorType === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = Buffer.alloc(width * height * 4);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? line[x - channels] : 0, b = prev[x], c = x >= channels ? prev[x - channels] : 0;
      let p = 0;
      if (filter === 1) p = a; else if (filter === 2) p = b; else if (filter === 3) p = (a + b) >> 1;
      else if (filter === 4) { const q = a + b - c, pa = Math.abs(q - a), pb = Math.abs(q - b), pc = Math.abs(q - c); p = pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      line[x] = (line[x] + p) & 0xff;
    }
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      out[o] = line[x * channels]; out[o + 1] = line[x * channels + 1]; out[o + 2] = line[x * channels + 2]; out[o + 3] = channels === 4 ? line[x * channels + 3] : 255;
    }
    prev = line;
  }
  return { width, height, data: out };
}

/** Share of pixels that differ (any channel by more than 8), over the larger image's area. */
export function diffRatio(a, b) {
  const area = Math.max(a.width * a.height, b.width * b.height);
  if (!area) return 0;
  const w = Math.min(a.width, b.width), h = Math.min(a.height, b.height);
  let same = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * a.width + x) * 4, j = (y * b.width + x) * 4;
      if (Math.abs(a.data[i] - b.data[j]) <= 8 && Math.abs(a.data[i + 1] - b.data[j + 1]) <= 8 && Math.abs(a.data[i + 2] - b.data[j + 2]) <= 8 && Math.abs(a.data[i + 3] - b.data[j + 3]) <= 8) same++;
    }
  }
  return (area - same) / area;
}

// ---------------------------------------------------------------- browser (Chrome DevTools Protocol)

/** An already-installed browser: explicit env path, Playwright's cached Chromium, then system Chrome. */
export function findBrowser(env = process.env) {
  const candidates = [];
  if (env.STUDIO_BROWSER_PATH) candidates.push(env.STUDIO_BROWSER_PATH);
  if (env.CHROMIUM_PATH) candidates.push(env.CHROMIUM_PATH);
  const cache = env.PLAYWRIGHT_BROWSERS_PATH ?? join(homedir(), process.platform === "darwin" ? "Library/Caches/ms-playwright" : ".cache/ms-playwright");
  if (existsSync(cache)) {
    for (const dir of readdirSync(cache).filter(name => /^chromium-\d+$/.test(name)).sort().reverse()) {
      candidates.push(join(cache, dir, "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"));
      candidates.push(join(cache, dir, "chrome-mac/Chromium.app/Contents/MacOS/Chromium"));
      candidates.push(join(cache, dir, "chrome-linux/chrome"));
      candidates.push(join(cache, dir, "chrome-linux64/chrome"));
    }
  }
  candidates.push("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/chromium", "/usr/bin/google-chrome");
  return candidates.find(path => existsSync(path));
}

async function launchBrowser(executable, profileDir) {
  const child = spawn(executable, ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profileDir}`, "--no-first-run", "--no-default-browser-check", "--disable-gpu", "--hide-scrollbars", "--mute-audio", "--disable-background-networking", "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
  const wsUrl = await new Promise((resolveUrl, reject) => {
    let buffer = "";
    child.stderr.on("data", chunk => {
      buffer += chunk;
      const match = /DevTools listening on (ws:\/\/\S+)/.exec(buffer);
      if (match) resolveUrl(match[1]);
    });
    child.once("exit", code => reject(new Error(`browser exited before DevTools was ready (code ${code})`)));
    child.once("error", reject);
  });
  const socket = new WebSocket(wsUrl);
  await new Promise((ok, fail) => { socket.onopen = ok; socket.onerror = () => fail(new Error("DevTools socket failed")); });
  let id = 0;
  const pending = new Map();
  const listeners = new Map();
  socket.onmessage = message => {
    const data = JSON.parse(message.data);
    if (data.id !== undefined) {
      const entry = pending.get(data.id);
      pending.delete(data.id);
      if (data.error) entry?.reject(new Error(`${entry.method}: ${data.error.message}`)); else entry?.resolve(data.result);
      return;
    }
    listeners.get(data.sessionId ?? "")?.(data.method, data.params);
  };
  const send = (method, params = {}, sessionId) => new Promise((ok, fail) => {
    const messageId = ++id;
    pending.set(messageId, { resolve: ok, reject: fail, method });
    socket.send(JSON.stringify({ id: messageId, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  const close = async () => {
    try { await send("Browser.close"); } catch { /* already closing */ }
    socket.close();
    if (child.exitCode === null) await new Promise(done => { child.once("exit", done); setTimeout(() => { child.kill("SIGKILL"); }, 5000).unref(); });
  };
  return { send, on: (sessionId, fn) => listeners.set(sessionId, fn), off: sessionId => listeners.delete(sessionId), close };
}

// ---------------------------------------------------------------- producer server

async function startProducer({ port, root, log }) {
  const cli = join(producerDir, "dist/cli/index.js");
  if (!existsSync(cli)) throw Object.assign(new Error("producer is not built: dist/cli/index.js is missing"), { env: true });
  if (!existsSync(join(producerDir, "dist/studio/manifest.json"))) throw Object.assign(new Error("Studio is not built: dist/studio/manifest.json is missing"), { env: true });
  const child = spawn(process.execPath, [cli, "produce", "--port", String(port), "--no-open", "--root", root], { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env } });
  const output = [];
  child.stdout.on("data", chunk => { output.push(String(chunk)); log?.(String(chunk)); });
  child.stderr.on("data", chunk => { output.push(String(chunk)); log?.(String(chunk)); });
  const origin = `http://127.0.0.1:${port}`;
  const exited = new Promise(done => child.once("exit", code => done(code)));
  const deadline = Date.now() + 180_000;
  // Readiness is the server's own health signal; each probe waits for the response it asked for.
  for (;;) {
    const state = await Promise.race([exited.then(code => ({ exited: code })), fetch(`${origin}/api/health`).then(r => r.json()).catch(() => undefined)]);
    if (state?.exited !== undefined) throw new Error(`producer exited (${state.exited}) before ready: ${output.join("").slice(-800)}`);
    if (state?.studio === "ready") break;
    if (Date.now() > deadline) { child.kill("SIGTERM"); throw new Error("producer did not report ready within 180s"); }
    await new Promise(next => setTimeout(next, 250));
  }
  return {
    origin,
    async stop() {
      if (child.exitCode !== null) return;
      child.kill("SIGTERM");
      const timer = setTimeout(() => child.kill("SIGKILL"), 15_000);
      await exited;
      clearTimeout(timer);
    },
  };
}

// ---------------------------------------------------------------- capture one shot

const IDLE_MS = 500;

async function captureShot(browser, contextId, origin, job, outDir) {
  const { targetId } = await browser.send("Target.createTarget", { url: "about:blank", browserContextId: contextId });
  const { sessionId } = await browser.send("Target.attachToTarget", { targetId, flatten: true });
  const send = (method, params) => browser.send(method, params, sessionId);
  const consoleErrors = [];
  const failed = [];
  const inflight = new Map();
  let lastActivity = Date.now();
  let loaded = false;
  browser.on(sessionId, (method, params) => {
    if (method === "Runtime.consoleAPICalled" && params.type === "error") consoleErrors.push(params.args.map(arg => arg.value ?? arg.description ?? "").join(" "));
    else if (method === "Runtime.exceptionThrown") consoleErrors.push(params.exceptionDetails?.exception?.description ?? params.exceptionDetails?.text ?? "exception");
    else if (method === "Log.entryAdded" && params.entry.level === "error" && params.entry.source !== "console-api") consoleErrors.push(`${params.entry.source}: ${params.entry.text} ${params.entry.url ?? ""}`.trim());
    // A long-lived event stream never finishes, so it is not part of network idle.
    else if (method === "Network.requestWillBeSent" && params.type === "EventSource") return;
    else if (method === "Network.requestWillBeSent") { inflight.set(params.requestId, params.request.url); lastActivity = Date.now(); }
    else if (method === "Network.responseReceived") {
      if (params.response.status >= 400) failed.push({ url: params.response.url, status: params.response.status });
    } else if (method === "Network.loadingFinished") { inflight.delete(params.requestId); lastActivity = Date.now(); }
    else if (method === "Network.loadingFailed") {
      const url = inflight.get(params.requestId);
      inflight.delete(params.requestId); lastActivity = Date.now();
      // A request the page itself cancelled (navigation, aborted prefetch) is not a failed load.
      if (!params.canceled) failed.push({ url: url ?? params.requestId, errorText: params.errorText });
    } else if (method === "Page.loadEventFired") loaded = true;
  });
  try {
    await Promise.all([send("Page.enable"), send("Runtime.enable"), send("Log.enable"), send("Network.enable")]);
    await send("Emulation.setDeviceMetricsOverride", { width: job.width, height: 900, deviceScaleFactor: 1, mobile: job.width < 768 });
    await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: job.theme }, { name: "prefers-reduced-motion", value: "reduce" }] });
    loaded = false;
    await send("Page.navigate", { url: origin + job.path });
    const deadline = Date.now() + job.timeoutMs;
    let facts, timedOut;
    const probe = `(${pageProbe.toString()})()`;
    const eager = "for (const f of document.querySelectorAll('iframe[loading=lazy]')) f.setAttribute('loading','eager'); true";
    // Settled = load event, network idle for IDLE_MS, and the probe reporting every specimen/frame loaded.
    for (;;) {
      if (loaded) {
        await send("Runtime.evaluate", { expression: eager });
        const result = await send("Runtime.evaluate", { expression: probe, returnByValue: true, awaitPromise: false });
        facts = result.result?.value;
        const idle = inflight.size === 0 && Date.now() - lastActivity >= IDLE_MS;
        if (facts && idle && isSettled(facts)) {
          await send("Runtime.evaluate", { expression: "document.fonts.ready.then(() => true)", awaitPromise: true });
          break;
        }
      }
      if (Date.now() > deadline) { timedOut = `not settled after ${job.timeoutMs}ms (inflight ${inflight.size}, load ${loaded})`; break; }
      await new Promise(next => setTimeout(next, 100));
    }
    const metrics = await send("Page.getLayoutMetrics");
    const height = Math.min(Math.ceil(metrics.cssContentSize?.height ?? metrics.contentSize.height), 12_000);
    const shot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, clip: { x: 0, y: 0, width: job.width, height: Math.max(height, 1), scale: 1 } });
    const png = Buffer.from(shot.data, "base64");
    await writeFile(join(outDir, job.file), png);
    const findings = detectFindings(facts, { consoleErrors, failedRequests: failed, timedOut });
    return { png, findings, counts: { consoleErrors: consoleErrors.length, failedRequests: failed.length }, overflow: facts ? facts.scrollWidth > facts.clientWidth : null };
  } finally {
    browser.off(sessionId);
    await browser.send("Target.closeTarget", { targetId }).catch(() => {});
  }
}

// ---------------------------------------------------------------- contact sheet

const escapeHtml = value => String(value).replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);

export function contactSheet(manifest) {
  const byRoute = new Map();
  for (const shot of manifest.shots) {
    if (!byRoute.has(shot.route)) byRoute.set(shot.route, []);
    byRoute.get(shot.route).push(shot);
  }
  const rows = [...byRoute.entries()].map(([route, shots]) => ({ route, shots, severity: shots.reduce((sum, shot) => sum + shot.severity, 0) }))
    .sort((a, b) => b.severity - a.severity || a.route.localeCompare(b.route));
  const body = rows.map(row => `<section class="${row.severity ? "bad" : "ok"}"><h2>${escapeHtml(row.route)} <small>${row.shots.reduce((n, s) => n + s.findings.length, 0)} findings</small></h2><div class="grid">${row.shots.map(shot => `<figure><a href="${escapeHtml(shot.file)}"><img loading="lazy" src="${escapeHtml(shot.file)}" alt="${escapeHtml(`${shot.route} ${shot.width} ${shot.theme}`)}"></a><figcaption>${shot.width} ${shot.theme}${shot.diff !== undefined ? ` diff ${(shot.diff * 100).toFixed(2)}%${shot.diffFlag ? " FLAG" : ""}` : ""}<ul>${shot.findings.map(f => `<li class="${escapeHtml(f.type)}"><b>${escapeHtml(f.type)}</b> ${escapeHtml(f.detail)}</li>`).join("")}</ul></figcaption></figure>`).join("")}</div></section>`).join("\n");
  const totals = Object.entries(manifest.findingsByType).map(([type, count]) => `${escapeHtml(type)}: ${count}`).join(" · ") || "no findings";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Studio capture</title><style>
:root{color-scheme:light dark;--bg:#fff;--fg:#111;--muted:#666;--bad:#b42318;--line:#ddd}
@media (prefers-color-scheme:dark){:root{--bg:#111;--fg:#eee;--muted:#999;--bad:#f97066;--line:#333}}
body{margin:0;padding:16px;background:var(--bg);color:var(--fg);font:13px/1.4 system-ui,sans-serif}
h1{font-size:18px}h2{font-size:14px;margin:24px 0 8px}h2 small{color:var(--muted);font-weight:400}
section.bad h2{color:var(--bad)}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:12px}
figure{margin:0;border:1px solid var(--line);border-radius:6px;padding:6px;min-width:0}img{width:100%;height:220px;object-fit:cover;object-position:top;display:block}
figcaption{margin-top:4px;color:var(--muted)}ul{margin:4px 0 0;padding-left:16px;max-height:120px;overflow:auto;color:var(--fg)}li{overflow-wrap:anywhere}
</style></head><body><h1>Studio capture: ${manifest.routeCount} routes, ${manifest.shotCount} shots</h1><p>${totals}. Exit ${manifest.exitCode}.</p>${body}</body></html>\n`;
}

// ---------------------------------------------------------------- run

export function parseArgs(argv) {
  const args = { port: DEFAULT_PORT, map: DEFAULT_MAP, root: repoRoot, concurrency: 4, timeoutMs: 60_000, routes: undefined, scope: "all" };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = () => { const next = argv[++i]; if (next === undefined) throw new Error(`${flag} needs a value`); return next; };
    if (flag === "--out") args.out = resolve(value());
    else if (flag === "--baseline") args.baseline = resolve(value());
    else if (flag === "--port") args.port = Number(value());
    else if (flag === "--map") args.map = resolve(value());
    else if (flag === "--root") args.root = resolve(value());
    else if (flag === "--concurrency") args.concurrency = Math.max(1, Number(value()));
    else if (flag === "--timeout") args.timeoutMs = Number(value());
    else if (flag === "--only") args.routes = value().split(",");
    else if (flag === "--scope") args.scope = value();
    else throw new Error(`unknown flag ${flag}`);
  }
  // A check run with no --out writes to a fresh temporary directory (printed in the result).
  if (!args.out) args.out = join(tmpdir(), `capture-studio-${Date.now()}`);
  if (!["all", "pages", "leaves"].includes(args.scope)) throw new Error("--scope must be all, pages or leaves");
  if (!Number.isInteger(args.port) || args.port < 1 || args.port > 65535) throw new Error("--port must be 1-65535");
  return args;
}

const fileName = (path, width, theme) => `${(path === "/" ? "home" : path.slice(1).replace(/[^a-zA-Z0-9.-]+/g, "_"))}__${width}-${theme}.png`;

export async function run(args) {
  const map = JSON.parse(await readFile(args.map, "utf8"));
  let routes = enumerateRoutes(map);
  const enumerated = routes.length;
  // --scope pages captures the content map's page routes; leaves are each page's [slug] instances.
  if (args.scope !== "all") routes = routes.filter(route => route.kind === (args.scope === "pages" ? "page" : "leaf"));
  if (args.routes) routes = routes.filter(route => args.routes.includes(route.path));
  const executable = findBrowser();
  if (!executable) return { exitCode: 2, status: "BLOCKED", message: "no installed Chromium/Chrome found; not downloading one" };
  await mkdir(join(args.out, "shots"), { recursive: true });
  const jobs = [];
  for (const route of routes) for (const theme of THEMES) for (const width of WIDTHS) jobs.push({ ...route, route: route.path, width, theme, file: `shots/${fileName(route.path, width, theme)}`, timeoutMs: args.timeoutMs });
  const serverLog = [];
  const producer = await startProducer({ port: args.port, root: args.root, log: line => serverLog.push(line) });
  const profile = await mkdtemp(join(tmpdir(), "capture-studio-"));
  let browser;
  const shots = [];
  try {
    browser = await launchBrowser(executable, profile);
    const contexts = {};
    for (const theme of THEMES) contexts[theme] = (await browser.send("Target.createBrowserContext", { disposeOnDetach: false })).browserContextId;
    let next = 0;
    const worker = async () => {
      while (next < jobs.length) {
        const job = jobs[next++];
        let result;
        const started = Date.now();
        try { result = await captureShot(browser, contexts[job.theme], producer.origin, job, args.out); }
        catch (error) { result = { findings: [{ type: "readiness-timeout", detail: `capture failed: ${error.message}` }], counts: { consoleErrors: 0, failedRequests: 0 } }; }
        const shot = { route: job.route, kind: job.kind, label: job.label, width: job.width, theme: job.theme, file: job.file, consoleErrors: result.counts.consoleErrors, failedRequests: result.counts.failedRequests, overflow: result.overflow ?? null, durationMs: Date.now() - started, findings: result.findings };
        if (args.baseline && result.png) {
          try {
            const before = decodePng(await readFile(join(args.baseline, job.file)));
            shot.diff = diffRatio(before, decodePng(result.png));
            shot.diffFlag = shot.diff > DIFF_LIMIT;
          } catch (error) { shot.diffError = error.code === "ENOENT" ? "no baseline shot" : error.message; }
        }
        shot.severity = severityOf(shot.findings);
        shots.push(shot);
        if (shots.length % 50 === 0) process.stderr.write(`capture-studio: ${shots.length}/${jobs.length}\n`);
      }
    };
    await Promise.all(Array.from({ length: Math.min(args.concurrency, jobs.length) }, worker));
  } finally {
    await browser?.close();
    await producer.stop();
    await writeFile(join(args.out, "producer.log"), serverLog.join(""));
  }
  shots.sort((a, b) => b.severity - a.severity || a.route.localeCompare(b.route) || a.width - b.width || a.theme.localeCompare(b.theme));
  const findingsByType = {};
  for (const shot of shots) for (const finding of shot.findings) findingsByType[finding.type] = (findingsByType[finding.type] ?? 0) + 1;
  const failing = shots.filter(shot => shot.findings.some(finding => FAILING.includes(finding.type)));
  const manifest = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    map: args.map,
    browser: executable,
    widths: WIDTHS, themes: THEMES,
    scope: args.scope,
    enumeratedRoutes: enumerated,
    routeCount: routes.length,
    pageRoutes: routes.filter(route => route.kind === "page").length,
    leafRoutes: routes.filter(route => route.kind === "leaf").length,
    shotCount: shots.length,
    failingShots: failing.length,
    findingsByType,
    diff: args.baseline ? { baseline: args.baseline, limit: DIFF_LIMIT, flagged: shots.filter(shot => shot.diffFlag).length } : undefined,
    exitCode: failing.length ? 1 : 0,
    shots,
  };
  await writeFile(join(args.out, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(join(args.out, "contact-sheet.html"), contactSheet(manifest));
  return { exitCode: manifest.exitCode, status: failing.length ? "FAIL" : "PASS", routeCount: manifest.routeCount, shotCount: manifest.shotCount, failingShots: failing.length, findingsByType, diff: manifest.diff, out: args.out };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  Promise.resolve().then(() => run(parseArgs(process.argv.slice(2)))).then(result => {
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.exitCode;
  }).catch(error => {
    console.error(JSON.stringify({ status: error.env ? "BLOCKED" : "ERROR", message: error.message }, null, 2));
    process.exitCode = 2;
  });
}
