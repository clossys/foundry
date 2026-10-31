/**
 * Headless capture of one specimen URL through an installed Chrome/Chromium over the
 * DevTools protocol: console errors, uncaught exceptions, the health message the page
 * posted, and optionally a PNG of the viewport. A fresh profile per call; nothing persists.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SPECIMEN_HEALTH_MESSAGE_TYPE } from "./health-reporter.js";

export const CHROME_CANDIDATES = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome",
] as const;

/** `CHROME_PATH`, else the first installed browser from `CHROME_CANDIDATES`. */
export function findChrome(): string | undefined {
  const configured = process.env.CHROME_PATH;
  if (configured) return existsSync(configured) ? configured : undefined;
  return CHROME_CANDIDATES.find(candidate => existsSync(candidate));
}

export interface SpecimenCaptureOptions {
  readonly executable?: string;
  readonly width?: number;
  readonly height?: number;
  /** Capture a PNG of the viewport. */
  readonly screenshot?: boolean;
  /** Extra time after the first health message, for late updates (ms). */
  readonly settleMs?: number;
  readonly timeoutMs?: number;
  /** An expression evaluated in the top frame after capture; its JSON value is returned as `probe`. */
  readonly probe?: string;
}

export interface SpecimenCapture {
  readonly url: string;
  /** Console `error` calls, uncaught exceptions and browser error log entries, as text. */
  readonly consoleErrors: readonly string[];
  /** Every health message the page delivered to its parent, in order. */
  readonly messages: readonly Record<string, unknown>[];
  /** The latest health message, if any arrived. */
  readonly health?: Record<string, unknown>;
  readonly screenshot?: Buffer;
  readonly probe?: unknown;
}

/** Collects health messages delivered to the top frame (the parent of a framed specimen, or the specimen itself). */
const LISTENER = `window.__clossysHealthMessages=[];addEventListener("message",e=>{if(e.data&&e.data.type===${JSON.stringify(SPECIMEN_HEALTH_MESSAGE_TYPE)})window.__clossysHealthMessages.push(e.data)});`;

export async function captureSpecimen(url: string, options: SpecimenCaptureOptions = {}): Promise<SpecimenCapture> {
  if (typeof WebSocket !== "function") throw new Error("specimen capture needs a Node with native WebSocket");
  const executable = options.executable ?? findChrome();
  if (!executable) throw new Error("specimen capture needs Chrome or Chromium (set CHROME_PATH)");
  const timeout = options.timeoutMs ?? 20_000;
  const width = options.width ?? 1280, height = options.height ?? 800;
  const profile = await mkdtemp(join(tmpdir(), "publisher-specimen-capture-"));
  const child = spawn(executable, ["--headless=new", "--disable-gpu", "--disable-dev-shm-usage", "--no-first-run", "--no-default-browser-check", "--hide-scrollbars", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
  let socket: WebSocket | undefined;
  const pending = new Map<number, { resolve(value: any): void; reject(error: Error): void }>();
  const listeners: ((message: any) => void)[] = [];
  try {
    const endpoint = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("browser startup timed out")), timeout);
      let output = "";
      const fail = () => { clearTimeout(timer); reject(new Error("browser unavailable")); };
      child.once("error", fail); child.once("exit", fail);
      child.stderr!.on("data", chunk => {
        output += String(chunk);
        const found = /DevTools listening on (ws:\/\/\S+)/.exec(output);
        if (found) { clearTimeout(timer); child.off("exit", fail); resolve(found[1]!); }
      });
    });
    const client = socket = new WebSocket(endpoint);
    await new Promise<void>((resolve, reject) => {
      client.addEventListener("open", () => resolve(), { once: true });
      client.addEventListener("error", () => reject(new Error("browser connection failed")), { once: true });
    });
    client.addEventListener("message", event => {
      const message = JSON.parse(String(event.data));
      if (message.id !== undefined) {
        const request = pending.get(message.id);
        if (!request) return;
        pending.delete(message.id);
        if (message.error) request.reject(new Error(`${message.error.message ?? "browser command failed"}`)); else request.resolve(message.result);
      } else for (const listener of listeners) listener(message);
    });
    let sequence = 0;
    const command = (method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<any> => new Promise((resolve, reject) => {
      const id = ++sequence;
      pending.set(id, { resolve, reject });
      client.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
    const { targetId } = await command("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await command("Target.attachToTarget", { targetId, flatten: true });
    const send = (method: string, params: Record<string, unknown> = {}) => command(method, params, sessionId);

    const consoleErrors: string[] = [];
    let loaded!: () => void;
    const loadFired = new Promise<void>(resolve => { loaded = resolve; });
    listeners.push(message => {
      if (message.sessionId !== sessionId) return;
      const params = message.params ?? {};
      if (message.method === "Runtime.consoleAPICalled" && (params.type === "error" || params.type === "assert")) {
        consoleErrors.push((params.args ?? []).map((arg: any) => arg.value ?? arg.description ?? "").join(" "));
      } else if (message.method === "Runtime.exceptionThrown") {
        consoleErrors.push(params.exceptionDetails?.exception?.description ?? params.exceptionDetails?.text ?? "exception");
      } else if (message.method === "Log.entryAdded" && params.entry?.level === "error") {
        consoleErrors.push(`${params.entry.source}: ${params.entry.text}${params.entry.url ? ` (${params.entry.url})` : ""}`);
      } else if (message.method === "Page.loadEventFired") loaded();
    });
    await Promise.all([send("Page.enable"), send("Runtime.enable"), send("Log.enable")]);
    await send("Page.addScriptToEvaluateOnNewDocument", { source: LISTENER });
    await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
    const navigation = await send("Page.navigate", { url });
    if (navigation.errorText) throw new Error(`navigation failed: ${navigation.errorText}`);
    const deadline = Date.now() + timeout;
    await Promise.race([loadFired, new Promise((_, reject) => setTimeout(() => reject(new Error("page load timed out")), timeout))]);
    const evaluate = async (expression: string) => (await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })).result?.value;
    let messages: Record<string, unknown>[] = [];
    while (Date.now() < deadline) {
      messages = await evaluate("window.__clossysHealthMessages || []") ?? [];
      if (messages.length) break;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    if (options.settleMs) {
      await new Promise(resolve => setTimeout(resolve, options.settleMs));
      messages = await evaluate("window.__clossysHealthMessages || []") ?? messages;
    }
    let screenshot: Buffer | undefined;
    if (options.screenshot) {
      const shot = await send("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width, height, scale: 1 } });
      screenshot = Buffer.from(shot.data, "base64");
    }
    const probe = options.probe ? await evaluate(options.probe) : undefined;
    return { url, consoleErrors, messages, ...(messages.length ? { health: messages[messages.length - 1] } : {}), ...(screenshot ? { screenshot } : {}), ...(options.probe ? { probe } : {}) };
  } finally {
    for (const request of pending.values()) request.reject(new Error("browser closed"));
    pending.clear();
    socket?.close();
    const exited = new Promise<void>(resolve => { if (child.exitCode !== null || child.signalCode !== null) resolve(); else child.once("exit", () => resolve()); });
    child.kill();
    await Promise.race([exited, new Promise<void>(resolve => setTimeout(() => { child.kill("SIGKILL"); resolve(); }, 2000).unref())]);
    await rm(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  }
}
