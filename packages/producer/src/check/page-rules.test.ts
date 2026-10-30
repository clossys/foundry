import { describe, expect, it } from "vitest";
import { inspectPageSnapshot } from "./page-rules.js";
import type { PageSnapshot, PageTarget } from "./page-types.js";

const target: PageTarget = { url: "http://localhost:4321/", cellIds: ["entry.primary", "entry.a+b"] };

function baseline(): PageSnapshot {
  return {
    url: target.url,
    inspected: true,
    text: "Welcome to the guide. Need help? We can help you find what you need.",
    headings: ["Welcome"],
    images: [{ src: "/guide.svg", complete: true, naturalWidth: 200 }],
    missingAssets: [],
    responses: [{ url: target.url, status: 200 }, { url: "/guide.svg", status: 304 }],
    consoleErrors: [],
    pageErrors: [],
    failedRequests: [],
  };
}

function rules(snapshot: PageSnapshot): string[] {
  return inspectPageSnapshot(snapshot, target).map(finding => finding.rule);
}

describe("PROC-5 pure page rules", () => {
  it("accepts observed, nonblank content with natural language and loaded images", () => {
    expect(inspectPageSnapshot(baseline(), target)).toEqual([]);
  });

  const mutations: [string, string, (snapshot: PageSnapshot) => void][] = [
    ["NEED marker", "PAGE_NEED_MARKER", snapshot => { snapshot.text += " NEED: finish copy"; }],
    ["standalone NEED", "PAGE_NEED_MARKER", snapshot => { snapshot.text += " (NEED)"; }],
    ["bracketed need", "PAGE_NEED_MARKER", snapshot => { snapshot.text += " [Need copy]"; }],
    ["visually intact NEED", "PAGE_NEED_MARKER", snapshot => { snapshot.text += " NEE\u200bD: copy"; }],
    ["canonical ID", "PAGE_TECHNICAL_ID", snapshot => { snapshot.text += " entry.primary."; }],
    ["escaped canonical ID", "PAGE_TECHNICAL_ID", snapshot => { snapshot.text += " (entry.a+b)"; }],
    ["other technical ID", "PAGE_TECHNICAL_ID", snapshot => { snapshot.text += " sections.hero-card"; }],
    ["unclosed fact marker", "PAGE_FACT_MARKER", snapshot => { snapshot.text += " [fact: pending"; }],
    ["closed fact marker", "PAGE_FACT_MARKER", snapshot => { snapshot.text += " [fact:pending]"; }],
    ["owner marker", "PAGE_TODO_OWNER", snapshot => { snapshot.text += " TODO-OWNER"; }],
    ["empty heading", "PAGE_EMPTY_HEADING", snapshot => { snapshot.headings.push(" \n\t"); }],
    ["invisible heading", "PAGE_EMPTY_HEADING", snapshot => { snapshot.headings.push("\u200b\ufeff"); }],
    ["unloaded image", "PAGE_BROKEN_IMAGE", snapshot => { snapshot.images[0]!.complete = false; }],
    ["zero-width image", "PAGE_BROKEN_IMAGE", snapshot => { snapshot.images[0]!.naturalWidth = 0; }],
    ["missing image source", "PAGE_BROKEN_IMAGE", snapshot => { snapshot.images[0]!.src = ""; }],
    ["missing asset", "PAGE_MISSING_ASSET", snapshot => { snapshot.missingAssets.push("/theme.css"); }],
    ["HTTP 400", "PAGE_HTTP_ERROR", snapshot => { snapshot.responses.push({ url: "/api", status: 400 }); }],
    ["HTTP 500", "PAGE_HTTP_ERROR", snapshot => { snapshot.responses.push({ url: "/theme.css", status: 500 }); }],
    ["console.error", "PAGE_CONSOLE_ERROR", snapshot => { snapshot.consoleErrors.push("A rendering error"); }],
    ["empty console.error", "PAGE_CONSOLE_ERROR", snapshot => { snapshot.consoleErrors.push(""); }],
    ["pageerror", "PAGE_RUNTIME_ERROR", snapshot => { snapshot.pageErrors.push("Unhandled exception"); }],
    ["requestfailed", "PAGE_REQUEST_FAILED", snapshot => { snapshot.failedRequests.push({ url: "/font.woff", error: "connection refused" }); }],
    ["incomplete inspection", "PAGE_SNAPSHOT_INCOMPLETE", snapshot => { snapshot.inspected = false; }],
    ["blank page", "PAGE_BLANK", snapshot => { snapshot.text = " \n\t\u200b"; }],
  ];

  it.each(mutations)("rejects %s then passes after restoration", (_name, expected, mutate) => {
    const snapshot = baseline();
    expect(rules(snapshot)).toEqual([]);
    mutate(snapshot);
    expect(rules(snapshot)).toContain(expected);
    Object.assign(snapshot, baseline());
    expect(rules(snapshot)).toEqual([]);
  });

  it.each(["NEED: copy", "entry.primary", "[fact:pending", "TODO-OWNER"])("checks accessible heading names: %s", heading => {
    const snapshot = baseline();
    snapshot.headings = [heading];
    expect(rules(snapshot).length).toBeGreaterThan(0);
  });

  it.each([
    "Need help?", "We need more information.", "Needed resources", "NEEDED resources", "KNEED",
    "entry.primaryExtra", "entry.primary-extra", "entry.primary_extra", "prefixentry.primary",
    "entry.primary.child", "éentry.primary", "entryXprimary", "TODO-OWNERSHIP", "[factual: example]", "[needé]",
  ])("does not confuse neighboring words with markers or exact IDs: %s", text => {
    const snapshot = baseline();
    snapshot.text = text;
    expect(rules(snapshot)).toEqual([]);
  });

  it("uses visible observations rather than hidden text or provenance attributes", () => {
    const snapshot = Object.assign(baseline(), {
      hiddenText: "NEED: hidden [fact:pending] TODO-OWNER entry.primary",
      attributes: { "data-cell-id": "entry.primary", "data-proc-5": "FAIL" },
    });
    expect(rules(snapshot)).toEqual([]);
  });

  it("does not let stored PASS claims waive defects", () => {
    const snapshot = Object.assign(baseline(), {
      pass: true, status: "PASS", findings: [], attributes: { "data-proc-5": "PASS" },
    });
    snapshot.text += " TODO-OWNER";
    expect(rules(snapshot)).toContain("PAGE_TODO_OWNER");
  });

  it.each(Object.keys(baseline()))("rejects a snapshot missing %s", key => {
    const snapshot = { ...baseline() } as unknown as Record<string, unknown>;
    delete snapshot[key];
    expect(rules(snapshot as unknown as PageSnapshot)).toContain("PAGE_SNAPSHOT_INVALID");
  });

  it.each([
    null, {}, { ...baseline(), text: null }, { ...baseline(), inspected: "true" },
    { ...baseline(), headings: [null] }, { ...baseline(), headings: Array(1) },
    { ...baseline(), images: [{ src: "/image.svg", complete: true }] },
    { ...baseline(), images: [{ src: "/image.svg", complete: true, naturalWidth: NaN }] },
    { ...baseline(), images: [{ src: "/image.svg", complete: true, naturalWidth: Infinity }] },
    { ...baseline(), images: [{ src: "/image.svg", complete: true, naturalWidth: 0.5 }] },
    { ...baseline(), images: [{ src: "/image.svg", complete: true, naturalWidth: -1 }] },
    { ...baseline(), responses: [{ url: "/api", status: "200" }] },
    { ...baseline(), responses: [{ url: "/api", status: 200.5 }] },
    { ...baseline(), responses: [{ url: "/api", status: 0 }] },
    { ...baseline(), failedRequests: [{ url: "/api" }] },
    { ...baseline(), consoleErrors: [null] }, { ...baseline(), pageErrors: [null] },
    { ...baseline(), missingAssets: [""] }, { ...baseline(), url: "http://localhost:4321/other" },
  ])("rejects malformed observations", snapshot => {
    expect(rules(snapshot as PageSnapshot)).toContain("PAGE_SNAPSHOT_INVALID");
  });

  it("rejects malformed targets without throwing", () => {
    for (const invalid of [null, {}, { url: target.url }, { url: target.url, cellIds: [null] }]) {
      expect(inspectPageSnapshot(baseline(), invalid as PageTarget).map(finding => finding.rule)).toEqual(["PAGE_SNAPSHOT_INVALID"]);
    }
  });

  it("returns stable ordered findings tied to the requested URL without mutating inputs", () => {
    const snapshot = baseline();
    snapshot.text += " NEED: entry.primary [fact:x] TODO-OWNER";
    snapshot.consoleErrors.push("boom");
    const before = structuredClone(snapshot);
    const first = inspectPageSnapshot(snapshot, target);
    expect(first).toEqual(inspectPageSnapshot(snapshot, target));
    expect(first.map(finding => finding.rule)).toEqual([
      "PAGE_NEED_MARKER", "PAGE_FACT_MARKER", "PAGE_TODO_OWNER", "PAGE_TECHNICAL_ID", "PAGE_CONSOLE_ERROR",
    ]);
    expect(first.every(finding => finding.url === target.url)).toBe(true);
    expect(snapshot).toEqual(before);
  });
});
