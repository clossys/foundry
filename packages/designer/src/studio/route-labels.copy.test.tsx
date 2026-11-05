// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { createRouteStudioLabels, routeStudioLabels } from "./route-labels.js";
import type { StudioCopyBinding } from "./copy-binding.js";

const draftPath = "packages/writer/src/catalog/records/admin-voice.r1.en.json";
const repositoryRoot = [process.cwd(), resolve(process.cwd(), "../..")]
  .find(candidate => existsSync(resolve(candidate, draftPath)));
if (!repositoryRoot) throw new Error("studio.copy.fixture-root");

const drafts = JSON.parse(readFileSync(resolve(repositoryRoot, draftPath), "utf8")) as {
  records: { id: string; status: string; text: string }[];
  reviews: { recordId: string; source: { path: string; key?: string } }[];
};
const routeIds = new Set(drafts.reviews.filter(row => row.source.path === "packages/designer/src/studio/route-labels.ts").map(row => row.recordId));
const expectedIdsByPath = new Map(drafts.reviews.flatMap(row => {
  if (row.source.path === "packages/designer/src/studio/route-labels.ts" && row.source.key?.startsWith("routeStudioLabels.")) {
    return [[row.source.key.slice("routeStudioLabels.".length), row.recordId] as const];
  }
  if (row.source.path === "packages/designer/src/studio/system-canvas/inspector/Inspector.tsx" && row.source.key?.startsWith("DEFAULT_USAGE_LABELS.")) {
    return [[`usage.${row.source.key.slice("DEFAULT_USAGE_LABELS.".length)}`, row.recordId] as const];
  }
  return [];
}));
const knownIds = new Set(drafts.records.map(row => row.id));
const marker = /^\[\[st\.[0123456789abcdefghjkmnpqrstvwxyz]{10}\]\]$/;

afterEach(cleanup);

function fixture(locale = "en") {
  const calls: { id: string; locale?: string; values?: Readonly<Record<string, string | number | boolean>> }[] = [];
  const binding: StudioCopyBinding = {
    locale,
    resolver(ref) {
      expect(knownIds.has(ref.id), ref.id).toBe(true);
      calls.push(ref);
      return { ref, text: `[[${ref.id}]]`, servedLocale: locale, chain: [locale] };
    },
  };
  return { binding, calls };
}

const argumentsByPath: Readonly<Record<string, readonly unknown[]>> = {
  "canvas.zoom": [125],
  "canvas.openBoard": ["display name"],
  "canvas.goToBoard": ["display name"],
  "scorecard.counts": [1, 2],
  "scorecard.supported": [[]],
  "matrix.expand": ["display name"],
  "matrix.collapse": ["display name"],
  memberCount: [1],
  checkSummary: [1, 2],
  "usage.count": [3],
};

function visibleValues(value: unknown, path = ""): { path: string; text: string }[] {
  if (typeof value === "string") return value ? [{ path, text: value }] : [];
  if (typeof value === "function") {
    const args = argumentsByPath[path];
    expect(args, path).toBeDefined();
    return visibleValues(value(...args!), path);
  }
  if (!value || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, child]) => visibleValues(child, path ? `${path}.${key}` : key));
}

describe("host-resolved route studio labels", () => {
  it.each(["en", "ar"])("hand-rolls every route label and aria label without unwrapped words in %s", locale => {
    const { binding, calls } = fixture(locale);
    const before = structuredClone(drafts.records);
    const values = visibleValues(createRouteStudioLabels(binding));
    expect(values).toHaveLength(expectedIdsByPath.size);
    for (const { path, text } of values) {
      const expectedId = expectedIdsByPath.get(path);
      expect(expectedId, path).toBeDefined();
      expect(text, path).toBe(`[[${expectedId}]]`);
    }
    const { container } = render(<div>{values.map(({ path, text }) => <span key={path} aria-label={text}>{text}</span>)}</div>);
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    const text: string[] = [];
    while ((node = walker.nextNode())) if (node.textContent?.trim()) text.push(node.textContent.trim());
    expect(text.length).toBeGreaterThan(100);
    for (const value of text) expect(value).toMatch(marker);
    for (const element of container.querySelectorAll("[aria-label]")) expect(element.getAttribute("aria-label")).toMatch(marker);
    for (const id of routeIds) expect(calls.some(call => call.id === id), id).toBe(true);
    expect(routeIds.size).toBe(117);
    expect(calls.every(call => call.locale === locale)).toBe(true);
    expect(drafts.records).toEqual(before);
    expect(drafts.records.every(record => record.status === "draft")).toBe(true);
  });

  it("passes formatter arguments intact to the Writer resolver", () => {
    const { binding, calls } = fixture();
    const labels = createRouteStudioLabels(binding);
    expect(labels.canvas.zoom(125)).toBe("[[st.zhgkbpn8eq]]");
    expect(labels.scorecard.counts(1, 2)).toBe("[[st.0xns3ts510]]");
    expect(labels.matrix.expand("display name")).toBe("[[st.a7tkca4nej]]");
    expect(calls).toContainEqual(expect.objectContaining({ id: "st.zhgkbpn8eq", values: { value: 125 } }));
    expect(calls).toContainEqual(expect.objectContaining({ id: "st.0xns3ts510", values: { errors: 1, notices: 2 } }));
    expect(calls).toContainEqual(expect.objectContaining({ id: "st.a7tkca4nej", values: { name: "display name" } }));
  });

  it("keeps the compatibility export resolver-backed and refuses unrecorded check codes", () => {
    expect(routeStudioLabels).toBe(createRouteStudioLabels);
    const { binding } = fixture();
    const labels = routeStudioLabels(binding);
    expect(labels.scorecard.supported([])).toBe("");
    expect(() => labels.scorecard.supported(["K3"])).toThrow();
  });

  it("has no English fallback or Writer runtime import when resolution is unavailable", () => {
    const { binding } = fixture();
    expect(() => createRouteStudioLabels({ ...binding, resolver: () => undefined })).toThrow();
    const source = readFileSync(resolve(repositoryRoot, "packages/designer/src/studio/route-labels.ts"), "utf8");
    expect(source).not.toMatch(/from\s+["'][^"']*writer|import\s*\([^)]*writer/);
    expect(source).not.toContain("Ask a coding agent");
    expect(source).not.toContain("Consumer library");
    expect(source).not.toContain("Runtime evidence unavailable");
  });
});
