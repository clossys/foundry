/// <reference lib="dom" />

import { createRequire } from "node:module";
import { inspectPageSnapshot } from "./page-rules.js";
import type { PageFinding, PageLintOptions, PageLintReport, PageResult, PageSnapshot, PageTarget } from "./page-types.js";

// Keep the optional browser runtime independent of this package's type graph.
interface BrowserRequest {
  url(): string;
  failure(): { errorText: string } | null;
  isNavigationRequest(): boolean;
  frame(): unknown;
}
interface BrowserRoute {
  request(): BrowserRequest;
  abort(reason: string): Promise<void>;
  continue(): Promise<void>;
}
interface BrowserPage {
  on(event: "console", listener: (message: { type(): string; text(): string }) => void): void;
  on(event: "pageerror", listener: (error: Error) => void): void;
  on(event: "requestfailed", listener: (request: BrowserRequest) => void): void;
  on(event: "response", listener: (response: { url(): string; status(): number }) => void): void;
  route(pattern: string, handler: (route: BrowserRoute) => Promise<void>): Promise<void>;
  mainFrame(): unknown;
  url(): string;
  goto(url: string, options: { timeout: number; waitUntil: "load" }): Promise<unknown>;
  waitForLoadState(state: "networkidle", options: { timeout: number }): Promise<void>;
  waitForTimeout(milliseconds: number): Promise<void>;
  evaluate<T>(callback: () => T | Promise<T>): Promise<T>;
  evaluate<T, A>(callback: (argument: A) => T | Promise<T>, argument: A): Promise<T>;
}
interface BrowserContext {
  newPage(): Promise<BrowserPage>;
  close(): Promise<void>;
}
interface Browser {
  newContext(options: { viewport: { width: number; height: number }; serviceWorkers: "block" }): Promise<BrowserContext>;
  close(): Promise<void>;
}
interface BrowserRuntime {
  chromium: { launch(options: { headless: true; executablePath?: string; timeout: number }): Promise<Browser> };
}

function loopbackUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.trim() !== value || !value) return false;
  try {
    const url = new URL(value);
    if (!/^https?:$/.test(url.protocol) || url.username || url.password) return false;
    return url.hostname === "localhost" || url.hostname === "[::1]" || /^127\.(?:\d{1,3}\.){2}\d{1,3}$/.test(url.hostname);
  } catch {
    return false;
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function incomplete(url: string, message: string): PageFinding {
  return { rule: "inspection-error", url, message };
}

/** Inspect local pages in a real browser; unavailable or partial inspection is an error. */
export async function lintPages(targets: PageTarget[], options: PageLintOptions): Promise<PageLintReport> {
  const startedAt = new Date().toISOString();
  const pages: PageResult[] = [];
  const globalFindings: PageFinding[] = [];
  let failedInspection = false;
  let browser: Browser | undefined;
  const timeoutMs = options?.timeoutMs ?? 30_000;
  try {
    if (!options || typeof options.sourceHead !== "string" || !/^[a-f\d]{40}$/i.test(options.sourceHead) || typeof options.sourceDirty !== "boolean") {
      throw new Error("A valid source head and source dirty state are required.");
    }
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) {
      throw new Error("The page timeout must be an integer from 1 to 120000 milliseconds.");
    }
    if (!Array.isArray(targets) || targets.length === 0) throw new Error("At least one page target is required.");
    if (options.executablePath !== undefined && (typeof options.executablePath !== "string" || !options.executablePath.trim())) {
      throw new Error("The browser executable path must be a nonempty string.");
    }
    const runtime = createRequire(import.meta.url)("playwright") as BrowserRuntime;
    if (typeof runtime?.chromium?.launch !== "function") throw new Error("The Playwright Chromium driver is unavailable.");
    browser = await runtime.chromium.launch({
      headless: true,
      executablePath: options.executablePath ?? process.env.CHROMIUM_PATH,
      timeout: timeoutMs,
    });
    for (const target of targets) {
      const url = typeof target?.url === "string" ? target.url : "";
      const result: PageResult = { url, inspected: false, findings: [] };
      pages.push(result);
      let context: BrowserContext | undefined;
      try {
        if (!loopbackUrl(url) || !Array.isArray(target?.cellIds) || target.cellIds.some((id) => typeof id !== "string" || !id.trim())) {
          throw new Error("Each target requires a loopback HTTP(S) URL without credentials and an explicit array of cell IDs.");
        }
        const deadline = Date.now() + timeoutMs;
        const remaining = (): number => {
          const milliseconds = deadline - Date.now();
          if (milliseconds <= 0) throw new Error("Page inspection exceeded its time budget.");
          return milliseconds;
        };
        // Bound evaluate/context operations as well as Playwright's navigation waits.
        const bounded = async <T>(operation: () => Promise<T>): Promise<T> => {
          let timer: ReturnType<typeof setTimeout> | undefined;
          try {
            return await Promise.race([
              operation(),
              new Promise<never>((_, reject) => {
                timer = setTimeout(() => reject(new Error("Page inspection exceeded its time budget.")), remaining());
              }),
            ]);
          } finally {
            if (timer) clearTimeout(timer);
          }
        };
        context = await bounded(() => browser!.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: "block" }));
        const page = await bounded(() => context!.newPage());
        const snapshot: PageSnapshot = {
          url, inspected: false, text: "", headings: [], images: [], missingAssets: [],
          responses: [], consoleErrors: [], pageErrors: [], failedRequests: [],
        };
        let blockedNavigation = false;
        let observationOverflow = false;
        const record = <T>(entries: T[], value: T): void => {
          if (entries.length >= 10_000) observationOverflow = true;
          else entries.push(value);
        };
        page.on("console", (message) => {
          if (message.type() === "error") record(snapshot.consoleErrors, message.text());
        });
        page.on("pageerror", (error) => record(snapshot.pageErrors, errorText(error)));
        page.on("requestfailed", (request) => record(snapshot.failedRequests, { url: request.url(), error: request.failure()?.errorText ?? "Request failed" }));
        page.on("response", (response) => {
          if (response.status() >= 400) record(snapshot.responses, { url: response.url(), status: response.status() });
        });
        await bounded(() => page.route("**/*", async (route) => {
          const request = route.request();
          if (request.isNavigationRequest() && request.frame() === page.mainFrame() && !loopbackUrl(request.url())) {
            blockedNavigation = true;
            await route.abort("blockedbyclient");
          } else {
            await route.continue();
          }
        }));
        await page.goto(url, { timeout: remaining(), waitUntil: "load" });
        await page.waitForLoadState("networkidle", { timeout: remaining() });
        // This evaluation retains only local references while visiting native
        // document/panel scroll positions; it does not alter page attributes.
        const content = await bounded(() => page.evaluate(async (budgetMs) => {
          const expires = Date.now() + budgetMs;
          const checkBudget = (): void => {
            if (Date.now() >= expires) throw new Error("Page inspection exceeded its time budget.");
          };
          const delay = async (milliseconds: number): Promise<void> => {
            checkBudget();
            await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
            checkBudget();
          };
          const rendered = (element: Element): boolean => {
            for (let current: Element | null = element; current; current = current.parentElement) {
              const style = getComputedStyle(current);
              if (current.hasAttribute("hidden") || current.getAttribute("aria-hidden") === "true" || style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse" || style.contentVisibility === "hidden" || Number(style.opacity) === 0) return false;
            }
            return true;
          };
          const hasArea = (element: Element): boolean => Array.from(element.getClientRects()).some((rect) => rect.width > 0 && rect.height > 0);
          const inViewport = (element: Element): boolean => {
            if (!rendered(element) || !hasArea(element)) return false;
            const rectangle = element.getBoundingClientRect();
            let left = Math.max(0, rectangle.left);
            let top = Math.max(0, rectangle.top);
            let right = Math.min(window.innerWidth, rectangle.right);
            let bottom = Math.min(window.innerHeight, rectangle.bottom);
            for (let parent = element.parentElement; parent; parent = parent.parentElement) {
              const style = getComputedStyle(parent);
              const clip = parent.getBoundingClientRect();
              if (style.overflowX !== "visible") {
                left = Math.max(left, clip.left);
                right = Math.min(right, clip.right);
              }
              if (style.overflowY !== "visible") {
                top = Math.max(top, clip.top);
                bottom = Math.min(bottom, clip.bottom);
              }
            }
            return right > left && bottom > top;
          };
          const normalized = (value: string): string => value.replace(/\s+/g, " ").trim();
          const visibleText = (root: Element): string => {
            const pieces: string[] = [];
            const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
            for (let node = walker.nextNode(); node; node = walker.nextNode()) {
              const parent = node.parentElement;
              if (!parent || parent.closest("script,style,template,noscript") || !rendered(parent)) continue;
              const range = document.createRange();
              range.selectNodeContents(node);
              if (Array.from(range.getClientRects()).some((rect) => rect.width > 0 && rect.height > 0)) pieces.push(node.textContent ?? "");
            }
            return normalized(pieces.join(" "));
          };
          const accessibleLabel = (element: Element): string => {
            const references = element.getAttribute("aria-labelledby")?.trim().split(/\s+/) ?? [];
            const referenced = references.map((id) => document.getElementById(id)?.textContent ?? "").join(" ");
            return normalized(referenced || element.getAttribute("aria-label") || element.getAttribute("alt") || "");
          };
          const texts = new Set<string>();
          const headings = new Set<string>();
          const seenImages = new Map<HTMLImageElement, Map<string, { src: string; complete: boolean; naturalWidth: number }>>();
          let textSize = 0;
          const elements = (): Element[] => {
            const all = Array.from(document.querySelectorAll("body *"));
            if (all.length > 100_000) throw new Error("The page exceeds the DOM inspection budget.");
            return all;
          };
          const observe = (): void => {
            checkBudget();
            const all = elements();
            // Structural rendered text remains auditable below the fold and
            // inside panels. Only native image loading needs viewport visits.
            const labels = all.filter((element) => rendered(element) && hasArea(element)).map(accessibleLabel).filter(Boolean);
            const text = normalized([document.body ? visibleText(document.body) : "", ...labels].join(" "));
            if (!texts.has(text)) {
              textSize += text.length;
              if (textSize > 1_000_000) throw new Error("The page exceeds the text inspection budget.");
              texts.add(text);
            }
            for (const element of all) {
              if ((/^(H[1-6])$/.test(element.tagName) || element.getAttribute("role") === "heading") && rendered(element)) {
                // An empty heading can have zero height; its box is not proof
                // that the semantic heading is hidden.
                headings.add(accessibleLabel(element) || normalized([visibleText(element), ...Array.from(element.querySelectorAll("img[alt]")).filter(rendered).map(accessibleLabel)].join(" ")));
              }
            }
            for (const image of Array.from(document.images).filter(inViewport)) {
              const src = image.currentSrc || image.src;
              const observations = seenImages.get(image) ?? new Map<string, { src: string; complete: boolean; naturalWidth: number }>();
              observations.set(src, { src, complete: image.complete, naturalWidth: image.naturalWidth });
              seenImages.set(image, observations);
            }
          };
          const root = document.scrollingElement;
          if (!root || !document.body) throw new Error("The page has no inspectable document body.");
          const visited = new Map<Element, { width: number; height: number }>();
          let steps = 0;
          const scrollable = (element: Element): boolean => {
            const style = getComputedStyle(element);
            return ((/^(auto|scroll|overlay)$/.test(style.overflowY) && element.scrollHeight > element.clientHeight + 2)
              || (/^(auto|scroll|overlay)$/.test(style.overflowX) && element.scrollWidth > element.clientWidth + 2));
          };
          const walk = async (container: Element, depth: number): Promise<void> => {
            if (visited.has(container)) return;
            if (depth > 32) throw new Error("The page exceeds the nested scrolling budget.");
            visited.set(container, { width: 0, height: 0 });
            const initialLeft = container.scrollLeft;
            const initialTop = container.scrollTop;
            const move = (left: number, top: number): void => {
              if (container === root) window.scrollTo({ left, top, behavior: "instant" });
              else container.scrollTo({ left, top, behavior: "instant" });
            };
            let previousLeft = -1;
            let previousTop = -1;
            let advancing = false;
            let stableBottom = 0;
            let finished = false;
            move(0, 0);
            await delay(100);
            try {
              while (!finished) {
                if (++steps > 200) throw new Error("The page exceeds the combined scrolling budget.");
                observe();
                for (const child of elements()) {
                  if (child !== root && container.contains(child) && !visited.has(child) && scrollable(child) && inViewport(child)) await walk(child, depth + 1);
                }
                if (!container.isConnected) throw new Error("A scroll container disappeared before inspection completed.");
                const width = container.scrollWidth;
                const height = container.scrollHeight;
                const viewportWidth = container === root ? window.innerWidth : container.clientWidth;
                const viewportHeight = container === root ? window.innerHeight : container.clientHeight;
                if (width > 150_000 || height > 150_000 || viewportWidth <= 0 || viewportHeight <= 0) throw new Error("Page dimensions exceed the inspection budget.");
                const left = container.scrollLeft;
                const top = container.scrollTop;
                const bottom = top + viewportHeight >= height - 2;
                const right = left + viewportWidth >= width - 2;
                if (advancing && left <= previousLeft && top <= previousTop) throw new Error("A page scroll container could not be fully traversed.");
                stableBottom = bottom ? stableBottom + 1 : 0;
                if (stableBottom >= 3 && right) {
                  visited.set(container, { width, height });
                  finished = true;
                  continue;
                }
                previousLeft = left;
                previousTop = top;
                advancing = !bottom || stableBottom >= 3;
                if (bottom && stableBottom >= 3) {
                  stableBottom = 0;
                  move(Math.min(width, left + Math.max(1, Math.floor(viewportWidth * 0.8))), 0);
                } else if (!bottom) {
                  move(left, Math.min(height, top + Math.max(1, Math.floor(viewportHeight * 0.8))));
                }
                await delay(100);
              }
            } finally {
              if (container.isConnected) move(initialLeft, initialTop);
            }
          };
          await walk(root, 0);
          await delay(200);
          observe();
          // Retain every encountered image even when a panel later scrolls it
          // away, and wait for native load/error completion rather than forcing
          // eager loading or interpreting a pending lazy image as broken.
          for (;;) {
            let pending = false;
            for (const [image, observations] of seenImages) {
              for (const observation of observations.values()) {
                if (observation.complete) continue;
                if ((image.currentSrc || image.src) !== observation.src) throw new Error("An image changed before its native load state could be inspected.");
                observation.complete = image.complete;
                observation.naturalWidth = image.naturalWidth;
                if (!image.complete) pending = true;
              }
            }
            if (!pending) break;
            await delay(50);
          }
          for (const [container, dimensions] of visited) {
            if (container.isConnected && (container.scrollWidth > dimensions.width + 2 || container.scrollHeight > dimensions.height + 2)) throw new Error("A scroll container grew after inspection completed.");
          }
          for (const element of elements()) {
            if (element !== root && !visited.has(element) && rendered(element) && scrollable(element)) throw new Error("A rendered scroll container could not be fully inspected.");
          }
          const images = Array.from(seenImages.values()).flatMap((observations) => Array.from(observations.values()));
          if (images.some((image) => !image.complete)) throw new Error("A visible image did not reach a native settled state.");
          return {
            text: Array.from(texts).join(" "),
            headings: Array.from(headings), images, missingAssets: [] as string[],
            ready: Boolean(document.body) && document.readyState === "complete",
          };
        }, remaining()));
        await page.waitForLoadState("networkidle", { timeout: remaining() });
        if (!content.ready || blockedNavigation || !loopbackUrl(page.url()) || observationOverflow) {
          throw new Error("Page inspection was incomplete or exceeded its observation budget.");
        }
        Object.assign(snapshot, content, { inspected: true });
        result.findings = inspectPageSnapshot(snapshot, target);
        result.inspected = true;
      } catch (error) {
        failedInspection = true;
        result.findings.push(incomplete(url, errorText(error)));
      } finally {
        if (context) {
          try { await context.close(); }
          catch (error) {
            failedInspection = true;
            result.inspected = false;
            result.findings.push(incomplete(url, `Browser context could not close: ${errorText(error)}`));
          }
        }
      }
    }
  } catch (error) {
    failedInspection = true;
    globalFindings.push(incomplete("", errorText(error)));
    if (Array.isArray(targets)) {
      for (const target of targets.slice(pages.length)) {
        const url = typeof target?.url === "string" ? target.url : "";
        pages.push({ url, inspected: false, findings: [incomplete(url, "The browser inspection could not start.")] });
      }
    }
  } finally {
    if (browser) {
      try { await browser.close(); }
      catch (error) {
        failedInspection = true;
        globalFindings.push(incomplete("", `Browser could not close: ${errorText(error)}`));
      }
    }
  }
  const findings = [...globalFindings, ...pages.flatMap((page) => page.findings)];
  const exitCode = failedInspection ? 2 : findings.length > 0 ? 1 : 0;
  return {
    schemaVersion: 1, gate: "PROC-5", sourceHead: options?.sourceHead ?? "", sourceDirty: options?.sourceDirty ?? false,
    startedAt, finishedAt: new Date().toISOString(), status: exitCode === 2 ? "ERROR" : exitCode === 1 ? "FAIL" : "PASS",
    exitCode, pages, findings,
  };
}
