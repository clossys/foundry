import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Geometry is collected only by the owned browser, never accepted as input. */
export interface LayoutMeasurement {
  width: number;
  viewport: number;
  scrollWidth: number;
  ready: boolean;
  fills: { path: string; left: number; right: number; top: number; bottom: number; width: number; height: number; visible: boolean }[];
  overflow: string[];
  reorder: string[];
  visualOrder: string[];
  ambiguous: string[];
  containers: { tag: string; display: string; order: string; flexDirection: string; gridAutoFlow: string; direction: string; writingMode: string }[];
}

function measure(): Omit<LayoutMeasurement, "width"> {
  const viewport = document.documentElement.clientWidth;
  const fills = [...document.querySelectorAll<HTMLElement>("[data-lk12-fill]")].map(node => {
    const { left, right, top, bottom, width, height } = node.getBoundingClientRect();
    return { path: node.dataset.lk12Fill!, left, right, top, bottom, width, height, visible: node.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) };
  });
  const overflow: string[] = [], reorder: string[] = [];
  const containers: LayoutMeasurement["containers"] = [];
  for (const node of document.body.querySelectorAll<HTMLElement>("*")) {
    const box = node.getBoundingClientRect(), css = getComputedStyle(node);
    if (!box.width || !box.height || css.display === "none") continue;
    const name = node.getAttribute("data-lk12-fill") ?? node.getAttribute("data-layout-slot") ?? node.tagName.toLowerCase();
    if (box.left < -0.5 || box.right > viewport + 0.5 || node.scrollWidth > node.clientWidth + 1) overflow.push(name);
    if (node.querySelector("[data-lk12-fill]")) containers.push({ tag: name, display: css.display, order: css.order, flexDirection: css.flexDirection, gridAutoFlow: css.gridAutoFlow, direction: css.direction, writingMode: css.writingMode });
    if (css.order !== "0" || css.flexDirection.endsWith("reverse") || css.gridAutoFlow.includes("dense") || css.direction !== "ltr" || css.writingMode !== "horizontal-tb") reorder.push(name);
    // Text can overflow a clipped box without increasing document scrollWidth.
    for (const child of node.childNodes) if (child.nodeType === Node.TEXT_NODE && child.textContent?.trim()) {
      const range = document.createRange(); range.selectNode(child);
      if ([...range.getClientRects()].some(rect => rect.left < -0.5 || rect.right > viewport + 0.5)) overflow.push(`${name}:text`);
    }
  }
  // Compare siblings within their actual formatting context, then recurse. This
  // preserves column reading groups and handles unequal-height centered panels.
  const ambiguous: string[] = [];
  const readingOrder = (node: Element): string[] => {
    if (node.hasAttribute("data-lk12-fill")) return [node.getAttribute("data-lk12-fill")!];
    const children = [...node.children].filter(child => child.matches("[data-lk12-fill]") || child.querySelector("[data-lk12-fill]"));
    const css = getComputedStyle(node);
    const anchor = (child: Element) => {
      const descendants = child.querySelectorAll("[data-lk12-fill]");
      return (descendants.length === 1 ? descendants[0]! : child).getBoundingClientRect();
    };
    for (let first = 0; first < children.length; first++) for (let second = first + 1; second < children.length; second++) {
      const a = anchor(children[first]!), b = anchor(children[second]!);
      if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.5 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.5)
        ambiguous.push(node.getAttribute("data-layout-slot") ?? node.tagName.toLowerCase());
    }
    children.sort((a, b) => {
      const first = anchor(a), second = anchor(b);
      if (css.display.includes("flex") && css.flexDirection.startsWith("row")) return first.left - second.left;
      return Math.abs(first.top - second.top) <= 1 ? first.left - second.left : first.top - second.top;
    });
    return children.flatMap(readingOrder);
  };
  return { viewport: window.innerWidth, scrollWidth: document.documentElement.scrollWidth,
    ready: document.body.dataset.lk12Ready === "true", fills, overflow: [...new Set(overflow)], reorder: [...new Set(reorder)], visualOrder: readingOrder(document.body), ambiguous, containers };
}

/** A fresh profile and owned process; no persistent browser state or network resources. */
export async function withLayoutBrowser<T>(executable: string, run: (page: {
  measure(width: number, css: string, bundle: string, payload: string): Promise<LayoutMeasurement>;
}) => Promise<T>): Promise<T> {
  if (typeof WebSocket !== "function") throw new Error("Browser transport requires native WebSocket");
  const profile = await mkdtemp(join(tmpdir(), "publisher-layout-render-"));
  const child = spawn(executable, ["--headless=new", "--disable-gpu", "--disable-dev-shm-usage", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
  let socket: WebSocket | undefined;
  const pending = new Map<number, { resolve(value: any): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
  try {
    const endpoint = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Browser startup timed out")), 15000);
      let output = "";
      const fail = () => { clearTimeout(timer); reject(new Error("Browser unavailable")); };
      child.once("error", fail); child.once("exit", fail);
      child.stderr!.on("data", chunk => {
        output += String(chunk);
        const found = /DevTools listening on (ws:\/\/\S+)/.exec(output);
        if (found) { clearTimeout(timer); resolve(found[1]!); }
      });
    });
    socket = new WebSocket(endpoint);
    const client = socket;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Browser connection timed out")), 15000);
      client.addEventListener("open", () => { clearTimeout(timer); resolve(); }, { once: true });
      client.addEventListener("error", () => { clearTimeout(timer); reject(new Error("Browser connection failed")); }, { once: true });
    });
    client.addEventListener("message", event => {
      const response = JSON.parse(String(event.data));
      const request = pending.get(response.id);
      if (!request) return;
      pending.delete(response.id); clearTimeout(request.timer);
      if (response.error) request.reject(new Error("Browser command failed")); else request.resolve(response.result);
    });
    client.addEventListener("close", () => {
      for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new Error("Browser closed")); }
      pending.clear();
    });
    let sequence = 0;
    const command = (method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<any> => {
      const id = ++sequence;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(id); reject(new Error("Browser command timed out")); }, 15000);
        pending.set(id, { resolve, reject, timer });
        client.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
      });
    };
    const { targetId } = await command("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await command("Target.attachToTarget", { targetId, flatten: true });
    const send = (method: string, params: Record<string, unknown> = {}) => command(method, params, sessionId);
    await send("Page.enable"); await send("Network.enable");
    await send("Network.setBlockedURLs", { urls: ["*"] });
    const { frameTree } = await send("Page.getFrameTree");
    const evaluate = async (expression: string) => {
      const response = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
      if (response.exceptionDetails) throw new Error("Rendered layout execution failed");
      return response.result.value;
    };
    return await run({ measure: async (width, css, bundle, payload) => {
      await send("Emulation.setDeviceMetricsOverride", { width, height: 1200, deviceScaleFactor: 1, mobile: false });
      // Inline scripts and remote resources are disabled; CDP alone executes the pinned bundle.
      const safeCss = css.replace(/<\/style/gi, "<\\/style");
      await send("Page.setDocumentContent", { frameId: frameTree.frame.id,
        html: `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'none'"><style>${safeCss}</style></head><body><div id="lk12-root"></div></body></html>` });
      await evaluate(bundle);
      await evaluate(`globalThis.__publisherLayoutRender(${payload})`);
      await evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
      return { width, ...await evaluate(`(${measure.toString()})()`) };
    } });
  } finally {
    for (const request of pending.values()) clearTimeout(request.timer);
    socket?.close();
    const exited = new Promise<void>(resolve => { if (child.exitCode !== null || child.signalCode !== null) resolve(); else child.once("exit", () => resolve()); });
    child.kill();
    await Promise.race([exited, new Promise<void>(resolve => setTimeout(() => { child.kill("SIGKILL"); resolve(); }, 2000).unref())]);
    await rm(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  }
}
