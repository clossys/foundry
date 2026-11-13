import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdtempSync, readFileSync, existsSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { createServer } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import { selectChromium } from "../../../__fixtures__/chromium-discovery.js";
import { fileHash, hash } from "./inventory.js";

type Message = { id?: number; result?: Record<string, unknown>; error?: { message: string }; method?: string; params?: Record<string, unknown>; sessionId?: string };
class CDP {
  private next = 0;
  private pending = new Map<number, { resolve: (value: Record<string, unknown>) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  listeners: ((message: Message) => void)[] = [];
  constructor(private socket: WebSocket) {
    socket.addEventListener("message", event => {
      const message = JSON.parse(String(event.data)) as Message;
      if (message.id) {
        const pending = this.pending.get(message.id); if (!pending) return;
        clearTimeout(pending.timer); this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(message.error.message)); else pending.resolve(message.result ?? {});
      } else for (const listener of this.listeners) listener(message);
    });
  }
  send(method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<Record<string, unknown>> {
    const id = ++this.next;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 10_000);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }
  close(): void {
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error("owned CDP session closed")); }
    this.pending.clear(); this.socket.close();
  }
}
export interface BrowserHarness {
  environment: { executable: string; executableSha256: string; version: string; profile: string; origin: string; args: string[]; bundleSha256: string; cssSha256: string };
  requests: { url: string; allowed: boolean }[];
  evaluate(expression: string): Promise<unknown>;
  key(key: "Tab" | "ArrowDown" | "ArrowUp" | "ArrowLeft" | "ArrowRight" | "Enter" | "Escape" | "Space", shift?: boolean): Promise<void>;
  pointer(x: number, y: number): Promise<void>;
  matrix(mode: "light" | "dark", direction: "ltr" | "rtl", forcedColors: boolean): Promise<void>;
  observe(selectors: readonly string[]): Promise<Record<string, unknown>>;
  audit(): Promise<Record<string, unknown>>;
  close(): Promise<void>;
}
/** Owned process/profile/server only. It never connects to a user's browser. */
export interface AuditorArtifact { path: string; sha256: string }
export function readAuditor(artifact: AuditorArtifact): string {
  const source = readFileSync(artifact.path, "utf8");
  if (!/^[a-f0-9]{64}$/.test(artifact.sha256) || hash(source) !== artifact.sha256) throw new Error("auditor artifact identity differs");
  if (!source.trim()) throw new Error("auditor artifact is empty");
  return source;
}
export async function launchChromium(tempParent: string, bundlePath: string, css: string, auditor?: AuditorArtifact): Promise<BrowserHarness> {
  const auditorSource = auditor ? readAuditor(auditor) : undefined;
  const executable = selectChromium(process.env.FOUNDRY_TEST_CHROME, (path, args) => spawnSync(path, args, { encoding: "utf8", timeout: 10_000 }));
  const versionRun = spawnSync(executable, ["--version"], { encoding: "utf8", timeout: 10_000 });
  if (versionRun.status !== 0) throw new Error("Chrome version observation failed");
  const bundle = readFileSync(bundlePath, "utf8");
  let profile: string | undefined; let origin = "";
  const requests: BrowserHarness["requests"] = [];
  const server = createServer((request, response) => {
    if (request.url === "/") { response.setHeader("content-type", "text/html"); response.end('<!doctype html><html><head><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script type="module" src="/bundle.js"></script></body></html>'); }
    else if (request.url === "/bundle.js") { response.setHeader("content-type", "text/javascript"); response.end(bundle); }
    else if (request.url === "/fixture.css") { response.setHeader("content-type", "text/css"); response.end(css); }
    else { response.statusCode = 404; response.end(); }
  });
  let child: ChildProcess | undefined; let cdp: CDP | undefined; let stderr = ""; let closed = false;
  const close = async (): Promise<void> => {
    if (closed) return; closed = true; cdp?.close();
    let processStillRunning = false;
    if (child?.pid && child.exitCode === null) {
      child.kill("SIGTERM");
      for (let n = 0; n < 30 && child.exitCode === null && child.signalCode === null; n++) await delay(50);
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      for (let n = 0; n < 40 && child.exitCode === null && child.signalCode === null; n++) await delay(50);
      processStillRunning = child.exitCode === null && child.signalCode === null;
    }
    server.closeAllConnections();
    await new Promise<void>(yes => server.close(() => yes()));
    if (processStillRunning) throw new Error(`owned Chrome did not exit; retained profile ${profile}`);
    if (profile) rmSync(profile, { recursive: true, force: true });
  };
  try {
    profile = mkdtempSync(resolve(tempParent, "selected-chrome-"));
    await new Promise<void>((yes, no) => { server.once("error", no); server.listen(0, "127.0.0.1", yes); });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("loopback server port unavailable");
    origin = `http://127.0.0.1:${address.port}`;
    const args = ["--headless=new", "--remote-debugging-port=0", "--remote-debugging-address=127.0.0.1", `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check", "about:blank"];
    child = spawn(executable, args, { stdio: ["ignore", "ignore", "pipe"] });
    child.stderr?.on("data", chunk => { stderr += String(chunk); });
    let spawnError: Error | undefined; child.once("error", error => { spawnError = error; });
    const activePort = resolve(profile, "DevToolsActivePort");
    for (let n = 0; n < 200 && !existsSync(activePort); n++) {
      if (spawnError || child.exitCode !== null) throw new Error(`owned Chrome launch refused: ${spawnError?.message ?? stderr}`);
      await delay(50);
    }
    if (!existsSync(activePort)) throw new Error(`owned Chrome endpoint unavailable: ${stderr}`);
    const [port, browserPath] = readFileSync(activePort, "utf8").trim().split("\n");
    if (!/^\d+$/.test(port ?? "") || !browserPath?.startsWith("/devtools/browser/")) throw new Error("invalid owned Chrome endpoint");
    const socket = new WebSocket(`ws://127.0.0.1:${port}${browserPath}`);
    await new Promise<void>((yes, no) => { socket.addEventListener("open", () => yes(), { once: true }); socket.addEventListener("error", () => no(new Error("owned CDP connection failed")), { once: true }); });
    cdp = new CDP(socket);
    const target = await cdp.send("Target.createTarget", { url: "about:blank" });
    const attached = await cdp.send("Target.attachToTarget", { targetId: target.targetId, flatten: true });
    const session = String(attached.sessionId); const client = cdp;
    const send = (method: string, params: Record<string, unknown> = {}) => client.send(method, params, session);
    await send("Page.enable"); await send("Runtime.enable");
    await send("Fetch.enable", { patterns: [{ urlPattern: "*" }] });
    const interceptionErrors: string[] = [];
    client.listeners.push(message => {
      if (message.sessionId !== session || message.method !== "Fetch.requestPaused") return;
      const params = message.params!; const request = params.request as { url: string };
      const url = new URL(request.url); const allowed = url.origin === origin;
      requests.push({ url: request.url, allowed });
      void send(allowed ? "Fetch.continueRequest" : "Fetch.failRequest", { requestId: params.requestId, ...(!allowed ? { errorReason: "BlockedByClient" } : {}) }).catch(error => interceptionErrors.push(String(error)));
    });
    const evaluate = async (expression: string): Promise<unknown> => {
      if (interceptionErrors.length) throw new Error(interceptionErrors.join("\n"));
      const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
      if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
      return (result.result as { value?: unknown }).value;
    };
    await send("Page.navigate", { url: origin });
    let ready = false;
    for (let n = 0; n < 100; n++) { if (await evaluate("document.readyState === 'complete'")) { ready = true; break; } await delay(25); }
    if (!ready) throw new Error("owned browser document readiness exhausted");
    if (auditorSource) await evaluate(auditorSource);
    const audit = async (): Promise<Record<string, unknown>> => {
      if (!auditor) throw new Error("independently identified auditor artifact required");
      // No tag filters, rule suppression, excludes or frame/selector narrowing.
      const report = await evaluate("axe.run(document)") as Record<string, unknown>;
      if (!report || !Array.isArray(report.violations) || !Array.isArray(report.passes) || !Array.isArray(report.incomplete) || !Array.isArray(report.inapplicable)) throw new Error("auditor returned an incomplete report");
      return { status: "observed-audit", artifact: auditor, report, reportSha256: hash(JSON.stringify(report)) };
    };
    return {
      environment: { executable, executableSha256: fileHash(executable), version: versionRun.stdout.trim(), profile, origin, args, bundleSha256: hash(bundle), cssSha256: hash(css) }, requests, evaluate, audit,
      async key(key, shift = false) {
        const codes = { Tab: 9, ArrowDown: 40, ArrowUp: 38, ArrowLeft: 37, ArrowRight: 39, Enter: 13, Escape: 27, Space: 32 };
        const params = { key: key === "Space" ? " " : key, code: key, windowsVirtualKeyCode: codes[key], nativeVirtualKeyCode: codes[key], modifiers: shift ? 8 : 0 };
        await send("Input.dispatchKeyEvent", { type: "keyDown", ...params });
        await send("Input.dispatchKeyEvent", { type: "keyUp", ...params });
      },
      async pointer(x, y) {
        await send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
        await send("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", clickCount: 1, x, y });
        await send("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", clickCount: 1, x, y });
      },
      async matrix(mode, direction, forcedColors) {
        await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: mode }, { name: "forced-colors", value: forcedColors ? "active" : "none" }] });
        await evaluate(`document.documentElement.dir=${JSON.stringify(direction)}; document.documentElement.classList.toggle('dark',${mode === "dark"})`);
      },
      async observe(selectors) {
        const dom = await evaluate(`(() => ({ focus: document.activeElement?.outerHTML, events: window.callerEvents ?? null, forcedColors: matchMedia('(forced-colors: active)').matches, nodes: ${JSON.stringify(selectors)}.flatMap(selector => [...document.querySelectorAll(selector)].map(node => { const style = getComputedStyle(node); const rect = node.getBoundingClientRect(); return { selector, html: node.outerHTML, color: style.color, background: style.backgroundColor, outline: style.outline, border: style.border, font: style.font, direction: style.direction, bounds: { x:rect.x,y:rect.y,width:rect.width,height:rect.height } }; })) }))()`);
        const accessibility = await send("Accessibility.getFullAXTree");
        return { dom, accessibility, requests: [...requests], audit: auditor ? await audit() : { status: "unavailable", reason: "no independently accepted auditor artifact" } };
      }, close,
    };
  } catch (error) { await close(); throw error; }
}
