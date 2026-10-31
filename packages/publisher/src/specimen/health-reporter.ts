/**
 * Live health reporter carried inline by every specimen page.
 *
 * It posts one `health` message to `window.parent` after load and posts again whenever a
 * value changes. The numbers are reports only: nothing here blocks, hides or fails a render.
 * The message shape is the contract Producer types and validates
 * (`@clossys/producer` `SpecimenHealthMessage`).
 */

export const SPECIMEN_HEALTH_MESSAGE_TYPE = "clossys:specimen-health";
export const SPECIMEN_HEALTH_REQUEST_TYPE = "clossys:specimen-health-request";
export const SPECIMEN_HEALTH_VERSION = 1;

export interface SpecimenReporterConfig {
  readonly element: string;
  readonly elementVersion: number | null;
  readonly kind: string;
  readonly theme: string;
  readonly width: number | null;
  /** Problems found before the page ran (record, build); reported as errors. */
  readonly preErrors: readonly { readonly source: string; readonly message: string }[];
}

/**
 * Runs in the specimen page. Serialized with `Function.prototype.toString`, so it uses
 * browser globals only and nothing from this module's scope.
 */
function specimenHealthReporter(config: SpecimenReporterConfig, types: { message: string; request: string; version: number }): void {
  const w = window as any;
  const MAX_ITEMS = 20;
  const state = {
    errors: [] as { source: string; message: string; atMs: number }[], errorCount: 0,
    loadMs: null as number | null, lcpMs: null as number | null, cls: 0,
    longTaskCount: 0, longTaskMs: 0, jsBytes: 0, cssBytes: 0, loaded: false,
  };
  let sequence = 0, last = "", timer: ReturnType<typeof setTimeout> | undefined;
  const now = () => Math.round(performance.now());
  const text = (value: unknown): string => {
    try {
      if (value instanceof Error) return value.message || String(value);
      if (typeof value === "string") return value;
      return JSON.stringify(value) ?? String(value);
    } catch { return String(value); }
  };
  function snapshot() {
    return {
      type: types.message, version: types.version, sequence: 0,
      element: config.element, elementVersion: config.elementVersion, kind: config.kind, theme: config.theme, width: config.width,
      errors: { count: state.errorCount, items: state.errors.slice() },
      loadMs: state.loadMs, lcpMs: state.lcpMs, cls: Math.round(state.cls * 10000) / 10000,
      longTasks: { count: state.longTaskCount, totalMs: Math.round(state.longTaskMs) },
      weight: { jsBytes: state.jsBytes, cssBytes: state.cssBytes },
      atMs: now(),
    };
  }
  function post(force?: boolean) {
    timer = undefined;
    const message = snapshot();
    const key = JSON.stringify({ ...message, atMs: 0 });
    if (!force && key === last) return;
    last = key;
    message.sequence = ++sequence;
    w.__clossysSpecimenHealth = message;
    try { window.parent.postMessage(message, "*"); } catch { /* a detached parent is not an error of the element */ }
  }
  function changed() {
    if (!state.loaded || timer !== undefined) return;
    timer = setTimeout(post, 100);
  }
  function report(source: string, message: unknown) {
    state.errorCount++;
    if (state.errors.length < MAX_ITEMS) state.errors.push({ source, message: text(message).slice(0, 500), atMs: now() });
    changed();
  }
  for (const problem of config.preErrors) report(problem.source, problem.message);

  window.addEventListener("error", (event: Event) => {
    const target = event.target as (Element & { src?: string; href?: string }) | null;
    if (target && target !== (window as unknown) && typeof target.tagName === "string") {
      report("resource", `failed to load ${target.src || target.href || target.tagName.toLowerCase()}`);
      return;
    }
    const error = event as ErrorEvent;
    report("error", error.error ?? error.message);
  }, true);
  window.addEventListener("unhandledrejection", (event: PromiseRejectionEvent) => report("unhandledrejection", event.reason));
  const consoleError = console.error;
  console.error = function (...args: unknown[]) {
    report("console", args.map(text).join(" "));
    return consoleError.apply(console, args);
  };
  w.__clossysSpecimen = { error: (error: unknown, source?: string) => report(source || "render", error), health: snapshot };

  const observe = (type: string, onEntry: (entry: any) => void) => {
    try {
      new PerformanceObserver(list => { for (const entry of list.getEntries()) onEntry(entry); changed(); }).observe({ type, buffered: true });
    } catch { /* this browser does not expose the entry type; the field stays at its empty value */ }
  };
  observe("largest-contentful-paint", entry => { state.lcpMs = Math.round(entry.renderTime || entry.loadTime || entry.startTime); });
  observe("layout-shift", entry => { if (!entry.hadRecentInput) state.cls += entry.value; });
  observe("longtask", entry => { state.longTaskCount++; state.longTaskMs += entry.duration; });
  observe("resource", entry => {
    const bytes = entry.transferSize || entry.encodedBodySize || 0;
    const path = String(entry.name).split(/[?#]/)[0]!;
    if (entry.initiatorType === "script" || /\.m?js$/.test(path)) state.jsBytes += bytes;
    else if (entry.initiatorType === "css" || /\.css$/.test(path) || (entry.initiatorType === "link" && /\.css$/.test(path))) state.cssBytes += bytes;
  });

  window.addEventListener("message", (event: MessageEvent) => {
    if (event.source === window.parent && event.data && event.data.type === types.request) post(true);
  });
  const settle = () => {
    const navigation = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    state.loadMs = Math.round(navigation && navigation.loadEventStart > 0 ? navigation.loadEventStart : performance.now());
    state.loaded = true;
    requestAnimationFrame(() => requestAnimationFrame(() => post(true)));
  };
  if (document.readyState === "complete") settle(); else window.addEventListener("load", () => setTimeout(settle, 0), { once: true });
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden" && state.loaded) post(); });
}

/** The reporter as an inline script body for one specimen page. */
export function specimenReporterScript(config: SpecimenReporterConfig): string {
  const types = { message: SPECIMEN_HEALTH_MESSAGE_TYPE, request: SPECIMEN_HEALTH_REQUEST_TYPE, version: SPECIMEN_HEALTH_VERSION };
  const json = (value: unknown) => JSON.stringify(value).replace(/</g, "\\u003c").replace(/[\u2028\u2029]/g, character => character === "\u2028" ? "\\u2028" : "\\u2029");
  return `(${specimenHealthReporter.toString()})(${json(config)},${json(types)});`;
}
