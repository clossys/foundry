import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  checkApprovalBypass,
  extractApprovalBypass,
  scanApprovalBypass,
  type ApprovalBypassGateResult,
  type ApprovalBypassScanResult,
} from "./approval-bypass.js";

// Hermetic: every test builds its own mkdtemp fixture tree with a generic
// registry at `copy/registry.json`. Nothing here scans this repository.

const REGISTRY = JSON.stringify(
  {
    locale: "en",
    entries: [{ id: "site.home.title", text: "Welcome", status: "approved", approvedBy: "owner" }],
  },
  null,
  2,
);

const dirs: string[] = [];

function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "writer-approval-bypass-"));
  dirs.push(root);
  const all: Record<string, string> = { "copy/registry.json": REGISTRY, ...files };
  for (const [rel, content] of Object.entries(all)) {
    const full = join(root, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  return root;
}

function scan(files: Record<string, string>): { scan: ApprovalBypassScanResult; gate: ApprovalBypassGateResult } {
  const root = fixture(files);
  const result = scanApprovalBypass(root, { registryPath: "copy/registry.json" });
  return { scan: result, gate: checkApprovalBypass(result) };
}

afterEach(() => {
  while (dirs.length > 0) {
    const dir = dirs.pop()!;
    try {
      chmodSync(dir, 0o755);
    } catch {
      // already gone
    }
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("approval-set-in-code", () => {
  it('flags status "approved" set by spread in a coupled file', () => {
    const { scan: s, gate } = scan({
      "src/page.ts": [
        'import { createCopyResolver } from "@clossys/writer";',
        "export function approve(e: { id: string }) {",
        '  const e2 = { ...e, status: "approved" };',
        "  return e2;",
        "}",
      ].join("\n"),
    });
    expect(s.coupledFiles).toEqual(["src/page.ts"]);
    expect(gate.verdict).toBe("violated");
    expect(gate.findings).toHaveLength(1);
    expect(gate.findings[0]).toMatchObject({ rule: "approval-set-in-code", severity: "error", file: "src/page.ts", line: 3 });
  });

  it("flags a member assignment to approvedBy", () => {
    const { gate } = scan({
      "src/a.ts": ['import type { CopyEntry } from "@clossys/writer";', "export function f(x: CopyEntry) {", '  x.approvedBy = "owner";', "}"].join("\n"),
    });
    expect(gate.verdict).toBe("violated");
    expect(gate.findings.map((f) => [f.rule, f.line])).toEqual([["approval-set-in-code", 3]]);
  });

  it("flags bracket member assignments and quoted keys", () => {
    const { gate } = scan({
      "src/a.ts": [
        'import { createCopyResolver } from "@clossys/writer";',
        'export const a = { "approvedBy": "delegate-a" };',
        "export function f(x: Record<string, unknown>) {",
        '  x["status"] = "approved";',
        '  x["pendingOwnerReview"] = false;',
        "}",
      ].join("\n"),
    });
    expect(gate.findings.map((f) => f.line)).toEqual([2, 4, 5]);
    expect(gate.findings.every((f) => f.rule === "approval-set-in-code")).toBe(true);
  });

  it("flags a pendingOwnerReview property, including shorthand", () => {
    const { gate } = scan({
      "src/a.ts": [
        'import { createCopyResolver } from "@clossys/writer/voice";',
        "const pendingOwnerReview = false;",
        "export const a = { id: \"site.home.title\", pendingOwnerReview: true };",
        "export const b = { id: \"site.home.title\", pendingOwnerReview };",
      ].join("\n"),
    });
    expect(gate.verdict).toBe("violated");
    expect(gate.findings.map((f) => f.line)).toEqual([3, 4]);
  });

  it('does not flag a status === "approved" comparison', () => {
    const { gate } = scan({
      "src/a.ts": [
        'import type { CopyEntry } from "@clossys/writer";',
        "export function isLive(e: CopyEntry): boolean {",
        '  if (e.status === "approved") return true;',
        '  return e["status"] == "approved";',
        "}",
      ].join("\n"),
    });
    expect(gate.verdict).toBe("satisfied");
  });

  it("does not flag reads: destructuring, types and interfaces", () => {
    const { gate } = scan({
      "src/a.ts": [
        'import type { CopyEntry } from "@clossys/writer";',
        "interface Local { approvedBy: string; status: \"approved\" | \"draft\" }",
        "type Other = { approvedBy: string };",
        "export function f(e: CopyEntry, g: { approvedBy: string }) {",
        "  const { approvedBy, pendingOwnerReview } = e;",
        "  return [approvedBy, pendingOwnerReview, g];",
        "}",
        "export const h = ({ approvedBy }: Local) => approvedBy;",
      ].join("\n"),
    });
    expect(gate.findings).toEqual([]);
    expect(gate.verdict).toBe("satisfied");
  });

  it("does not flag the names as call arguments, ternary branches or array elements", () => {
    const { gate } = scan({
      "src/a.ts": [
        'import type { CopyEntry } from "@clossys/writer";',
        "export function f(e: CopyEntry, approvedBy: string, status: string) {",
        "  const pick = e ? approvedBy : status;",
        "  return [pick, g(e, approvedBy, status), [approvedBy]];",
        "}",
        "declare function g(...a: unknown[]): unknown;",
      ].join("\n"),
    });
    expect(gate.findings).toEqual([]);
  });

  it('ignores status: "approved" in JSX text of a .tsx file', () => {
    const { gate } = scan({
      "src/Badge.tsx": [
        'import { createCopyResolver } from "@clossys/writer";',
        "export function Badge() {",
        '  return <span>status: "approved"</span>;',
        "}",
      ].join("\n"),
    });
    expect(gate.verdict).toBe("satisfied");
  });
});

describe("copy-read-without-resolver", () => {
  it("flags a raw map built from the imported registry", () => {
    const { gate } = scan({
      "src/copy.ts": [
        'import registry from "../copy/registry.json";',
        "export const copy = Object.fromEntries(registry.entries.map((e) => [e.id, e.text]));",
      ].join("\n"),
    });
    expect(gate.verdict).toBe("violated");
    expect(gate.findings).toHaveLength(1);
    expect(gate.findings[0]).toMatchObject({ rule: "copy-read-without-resolver", file: "src/copy.ts", line: 2 });
  });

  it("passes a file that only passes the registry to createCopyResolver", () => {
    const { scan: s, gate } = scan({
      "src/copy.ts": [
        'import { createCopyResolver, resolveCopyRef } from "@clossys/writer";',
        'import registry from "../copy/registry.json";',
        "export const resolver = createCopyResolver(registry);",
        'export const one = resolveCopyRef( registry , { id: "site.home.title" });',
      ].join("\n"),
    });
    expect(s.coupledFiles).toEqual(["src/copy.ts"]);
    expect(gate.findings).toEqual([]);
    expect(gate.unchecked).toEqual([]);
    expect(gate.verdict).toBe("satisfied");
  });

  it("flags every other use of the binding, one finding per occurrence", () => {
    const { gate } = scan({
      "src/copy.ts": [
        'import { createCopyResolver } from "@clossys/writer";',
        'import * as registry from "../copy/registry.json";',
        "export const a = { ...registry };",
        "export const b = registry;",
        "export const c = createCopyResolver(registry, {});",
        "export const d = createCopyResolver(registry.entries);",
        "export const e = { registry: 1 };",
        "export const f = typeof registry;",
      ].join("\n"),
    });
    expect(gate.findings.map((f) => f.line)).toEqual([3, 4, 6]);
  });

  it("flags named bindings from the registry at the import line", () => {
    const { gate } = scan({
      "src/copy.ts": ['import { entries, locale as lang } from "../copy/registry.json";', "export const n = 1;"].join("\n"),
    });
    expect(gate.findings).toHaveLength(2);
    expect(gate.findings.every((f) => f.rule === "copy-read-without-resolver" && f.line === 1)).toBe(true);
  });

  it("flags .entries on a require bound to an identifier", () => {
    const { gate } = scan({
      "src/copy.js": ['const registry = require("../copy/registry.json");', "module.exports = registry.entries;"].join("\n"),
    });
    expect(gate.verdict).toBe("violated");
    expect(gate.findings.map((f) => [f.rule, f.line])).toEqual([["copy-read-without-resolver", 2]]);
  });

  it("matches a non-relative specifier by registry basename", () => {
    const { gate } = scan({
      "src/copy.ts": ['import registry from "#copy/registry.json";', "export const all = registry.entries;"].join("\n"),
    });
    expect(gate.verdict).toBe("violated");
  });

  it("traces import-equals bindings and marks re-exports unchecked", () => {
    const { gate } = scan({
      "src/a.ts": ['import registry = require("../copy/registry.json");', "export const all = registry.entries;"].join("\n"),
      "src/b.ts": 'export { default as copy } from "../copy/registry.json";\n',
    });
    expect(gate.findings.map((f) => [f.file, f.line])).toEqual([["src/a.ts", 2]]);
    expect(gate.unchecked.map((u) => [u.file, u.kind])).toEqual([["src/b.ts", "registry-reexport"]]);
    expect(gate.verdict).toBe("violated");
  });

  it("does not flag an unused registry import", () => {
    const { gate } = scan({ "src/copy.ts": 'import registry from "../copy/registry.json";\nexport const n = 1;\n' });
    expect(gate.verdict).toBe("satisfied");
  });

  it("allows parseCopyRegistry when its result reaches createCopyResolver", () => {
    const { gate } = scan({
      "src/copy.ts": [
        'import { createCopyResolver, parseCopyRegistry } from "@clossys/writer";',
        'import registry from "../copy/registry.json";',
        "export const nested = createCopyResolver(parseCopyRegistry(registry));",
        "const reg = parseCopyRegistry(registry)",
        "export const bound = createCopyResolver(reg);",
      ].join("\n"),
    });
    expect(gate.findings).toEqual([]);
    expect(gate.verdict).toBe("satisfied");
  });

  it("flags parseCopyRegistry results read without the resolver", () => {
    const { gate } = scan({
      "src/copy.ts": [
        'import { parseCopyRegistry } from "@clossys/writer";',
        'import registry from "../copy/registry.json";',
        "const reg = parseCopyRegistry(registry);",
        "export const a = reg.entries;",
        "export const b = parseCopyRegistry(registry).entries;",
      ].join("\n"),
    });
    expect(gate.verdict).toBe("violated");
    expect(gate.findings.map((f) => [f.rule, f.line])).toEqual([
      ["copy-read-without-resolver", 4],
      ["copy-read-without-resolver", 5],
    ]);
  });

  it("flags a callee name that merely contains an allowed resolver name", () => {
    const { gate } = scan({
      "src/copy.ts": [
        'import { createCopyResolver } from "@clossys/writer";',
        'import registry from "../copy/registry.json";',
        "export const a = myparseCopyRegistry(registry).entries;",
        "export const b = x.createCopyResolver(registry);",
      ].join("\n"),
    });
    expect(gate.verdict).toBe("violated");
    expect(gate.findings.every((f) => f.rule === "copy-read-without-resolver")).toBe(true);
    expect(gate.findings.map((f) => f.line)).toEqual([3, 4]);
  });

  it("flags parseCopyRegistry when a long gap or comment hides the callee name", () => {
    const { gate } = scan({
      "src/copy.ts": [
        'import { parseCopyRegistry } from "@clossys/writer";',
        'import registry from "../copy/registry.json";',
        "export const a = parseCopyRegistry                        (registry).entries.map((e) => e.text);",
        "export const b = parseCopyRegistry /* the copy registry file */ (registry).entries.map((e) => e.text);",
      ].join("\n"),
    });
    expect(gate.verdict).toBe("violated");
    expect(gate.findings.map((f) => f.line)).toEqual([3, 4]);
  });

  it("flags parseCopyRegistry passed to Object.keys and a Unicode-prefixed resolver callee", () => {
    const { gate } = scan({
      "src/copy.ts": [
        'import { createCopyResolver, parseCopyRegistry } from "@clossys/writer";',
        'import registry from "../copy/registry.json";',
        "export const a = Object.keys(parseCopyRegistry /* comment */ (registry));",
        "export const b = λcreateCopyResolver(parseCopyRegistry(registry)).entries.map((e) => e.text);",
      ].join("\n"),
    });
    expect(gate.verdict).toBe("violated");
    expect(gate.findings.length).toBeGreaterThanOrEqual(2);
  });

  it("flags a local function that shadows an allowed resolver name", () => {
    const { gate } = scan({
      "src/copy.ts": [
        'import registry from "../copy/registry.json";',
        "function createCopyResolver(data: { entries: { text: string }[] }) {",
        "  return data.entries.map((e) => e.text);",
        "}",
        "export const copy = createCopyResolver(registry);",
      ].join("\n"),
    });
    expect(gate.verdict).toBe("violated");
    expect(gate.findings).toEqual([expect.objectContaining({ rule: "copy-read-without-resolver", line: 5 })]);
  });

  it("flags callee names that merely suffix an allowed resolver import", () => {
    const deseret = "\u{10400}";
    const cyrillicC = "\u{0441}";
    const { gate: deseretGate } = scan({
      "src/copy.ts": [
        'import { createCopyResolver, parseCopyRegistry } from "@clossys/writer";',
        'import registry from "../copy/registry.json";',
        "function via(data: { entries: unknown[] }) {",
        `  return ${deseret}createCopyResolver(parseCopyRegistry(registry)).entries;`,
        "}",
        "export const a = via({ entries: [] });",
      ].join("\n"),
    });
    expect(deseretGate.verdict).toBe("violated");
    const { gate: bmpGate } = scan({
      "src/copy.ts": [
        'import { createCopyResolver, parseCopyRegistry } from "@clossys/writer";',
        'import registry from "../copy/registry.json";',
        "function via(data: { entries: unknown[] }) {",
        `  return λcreateCopyResolver(parseCopyRegistry(registry)).entries;`,
        "}",
        "export const a = via({ entries: [] });",
      ].join("\n"),
    });
    expect(bmpGate.verdict).toBe("violated");
    const { gate: cyrillicGate } = scan({
      "src/copy.ts": [
        'import { createCopyResolver, parseCopyRegistry } from "@clossys/writer";',
        'import registry from "../copy/registry.json";',
        "function via(data: { entries: unknown[] }) {",
        `  return ${cyrillicC}createCopyResolver(parseCopyRegistry(registry)).entries;`,
        "}",
        "export const a = via({ entries: [] });",
      ].join("\n"),
    });
    expect(cyrillicGate.verdict).toBe("violated");
    const { gate: importGate } = scan({
      "src/copy.ts": [
        'import { createCopyResolver, parseCopyRegistry } from "@clossys/writer";',
        'import registry from "../copy/registry.json";',
        "export const resolver = createCopyResolver(parseCopyRegistry(registry));",
      ].join("\n"),
    });
    expect(importGate.verdict).toBe("satisfied");
  });

  it("flags every same-file binding form that shadows an allowed import name", () => {
    const body = (shadow: string, use: string) =>
      [
        'import { createCopyResolver, parseCopyRegistry } from "@clossys/writer";',
        'import registry from "../copy/registry.json";',
        shadow,
        use,
      ].join("\n");
    for (const shadow of [
      "function* createCopyResolver(data: { entries: unknown[] }) { return data.entries; }",
      "function*createCopyResolver(data: { entries: unknown[] }) { return data.entries; }",
      "async function* createCopyResolver(data: { entries: unknown[] }) { return data.entries; }",
      "async function createCopyResolver(data: { entries: unknown[] }) { return data.entries; }",
      "const createCopyResolver: (data: { entries: unknown[] }) => unknown = (data) => data.entries;",
      "let createCopyResolver: (data: { entries: unknown[] }) => unknown = (data) => data.entries;",
      "var createCopyResolver: (data: { entries: unknown[] }) => unknown = (data) => data.entries;",
      "class createCopyResolver { constructor(public data: { entries: unknown[] }) {} entries() { return this.data.entries; } }",
      "const { createCopyResolver } = { createCopyResolver: (data: { entries: unknown[] }) => data.entries };",
      "const { other: createCopyResolver } = { other: (data: { entries: unknown[] }) => data.entries };",
      "function load(createCopyResolver) { return createCopyResolver; }",
      "function load(createCopyResolver = () => ({ entries: [] })) { return createCopyResolver; }",
      "function load(...createCopyResolver) { return createCopyResolver; }",
      "export function run() { try { throw 1; } catch (createCopyResolver) { return createCopyResolver; } }",
    ]) {
      const { gate } = scan({
        "src/copy.ts": body(shadow, "export const out = createCopyResolver(parseCopyRegistry(registry)).entries;"),
      });
      expect(gate.verdict).toBe("violated");
    }
    const { gate: renamedGate } = scan({
      "src/copy.ts": body(
        "const { createCopyResolver: other } = { createCopyResolver: () => ({ entries: [] }) };",
        "export const out = createCopyResolver(parseCopyRegistry(registry));",
      ),
    });
    expect(renamedGate.verdict).toBe("satisfied");
  });

  it("flags loop heads and uninitialized bindings that shadow an import name", () => {
    const importLine = 'import { createCopyResolver } from "@clossys/writer";';
    const registryLine = 'import registry from "../copy/registry.json";';
    const use = "createCopyResolver(registry);";
    for (const body of [
      "for (const createCopyResolver of [(data) => data.entries]) { createCopyResolver(registry); }",
      "for (const createCopyResolver in { k: 1 }) { createCopyResolver(registry); }",
      "for await (const createCopyResolver of [(data) => data.entries]) { createCopyResolver(registry); }",
      "export function run() { let createCopyResolver; createCopyResolver = (data) => data.entries; createCopyResolver(registry); }",
    ]) {
      const { gate } = scan({ "src/copy.ts": [importLine, registryLine, body].join("\n") });
      expect(gate.verdict).toBe("violated");
    }
  });

  it("flags additional value-binding forms that shadow an import name", () => {
    const head = [
      'import { createCopyResolver } from "@clossys/writer";',
      'import registry from "../copy/registry.json";',
    ].join("\n");
    const use = "export const out = createCopyResolver(registry);";
    for (const shadow of [
      "function load(createCopyResolver: (data: { entries: unknown[] }) => unknown) { return createCopyResolver(registry); }",
      "function load<T>(createCopyResolver) { return createCopyResolver(registry); }",
      "const load = (createCopyResolver) => createCopyResolver(registry);",
      "const o = { load(createCopyResolver) { return createCopyResolver(registry); } };",
      "class C { load(createCopyResolver) { return createCopyResolver(registry); } }",
      "const [createCopyResolver] = [(data) => data.entries];",
      "export function run() { try { throw 1; } catch (createCopyResolver: any) { createCopyResolver(registry); } }",
      "export function run() { try { throw 1; } catch ({ createCopyResolver }) { createCopyResolver(registry); } }",
    ]) {
      const { gate } = scan({ "src/copy.ts": [head, shadow, use].join("\n") });
      expect(gate.verdict).toBe("violated");
    }
  });

  it("does not treat type-position mentions as value bindings", () => {
    const { gate } = scan({
      "src/copy.ts": [
        'import { createCopyResolver } from "@clossys/writer";',
        'import registry from "../copy/registry.json";',
        "function load(x: createCopyResolver) { return x; }",
        "export const resolver = createCopyResolver(registry);",
        "export const t = typeof createCopyResolver;",
      ].join("\n"),
    });
    expect(gate.verdict).toBe("satisfied");
  });

  it("flags arrow and callback parameters that shadow a renamed import", () => {
    const head = [
      'import { createCopyResolver as make } from "@clossys/writer";',
      'import registry from "../copy/registry.json";',
    ].join("\n");
    const use = "export const out = make(registry);";
    for (const shadow of [
      "const load = (make: (data: unknown) => unknown) => make(registry);",
      "const load = (make): unknown => make(registry);",
      "const load = async (make: (data: unknown) => unknown) => make(registry);",
      "export default (make: (data: unknown) => unknown) => make(registry);",
      "const items: unknown[] = [];\nitems.forEach((make) => { make(registry); });",
      "const load = ([make]: Array<(data: unknown) => unknown>) => make(registry);",
      "const load = (make) => make(registry);",
      'emitter.on("load", (make) => make(registry));',
      "run(opts, (make: Handler) => make(registry));",
      "wrap(0, (make) => make(registry));",
      "const f = g || ((make) => make(registry));",
      "const f = g && ((make) => make(registry));",
      "({ key: make }: { key: Handler }) => make(registry);",
      "({ make = fallback }) => make(registry);",
      "({ key: make = fallback }) => make(registry);",
      "({ ...make }) => make(registry);",
      "(make: Foo) => make(registry);",
      "(make = fallback) => make(registry);",
      "<T,>(make: T) => make(registry);",
      "({ make }) => make(registry);",
      "({ key: make }) => make(registry);",
    ]) {
      const { gate } = scan({ "src/copy.ts": [head, shadow, use].join("\n") });
      expect(gate.verdict).toBe("violated");
    }
  });

  it("flags every arrow-parameter shape that shadows a renamed import", () => {
    const head = [
      'import { createCopyResolver as make } from "@clossys/writer";',
      'import registry from "../copy/registry.json";',
    ].join("\n");
    const use = "export const out = make(registry);";
    for (const shadow of [
      "const load = (make: Foo) => make(registry);",
      "const load = (make = fallback) => make(registry);",
      "const load = <T,>(make: T) => make(registry);",
      "const load = (x: number) => (make: Foo) => make(registry);",
    ]) {
      const { gate } = scan({ "src/copy.ts": [head, shadow, use].join("\n") });
      expect(gate.verdict).toBe("violated");
    }
  });

  it("flags object-pattern parameters in arrows and callbacks", () => {
    const head = [
      'import { createCopyResolver as make } from "@clossys/writer";',
      'import registry from "../copy/registry.json";',
    ].join("\n");
    const use = "export const out = make(registry);";
    for (const shadow of [
      "const load = ({ make }) => make(registry);",
      "const xs: unknown[] = [];\nxs.forEach(({ make }) => make(registry));",
      "const load = ({ key: make }) => make(registry);",
    ]) {
      const { gate } = scan({ "src/copy.ts": [head, shadow, use].join("\n") });
      expect(gate.verdict).toBe("violated");
    }
  });

  it("does not treat block-leading if, while, or switch tests as parameter shadows", () => {
    const head = [
      'import { createCopyResolver as make } from "@clossys/writer";',
      'import registry from "../copy/registry.json";',
    ].join("\n");
    for (const body of [
      "export function run() { if (make) return make(registry); }",
      "export function run(flag: boolean) { if (flag) { if (make) return make(registry); } }",
      "export function run() { while (make) return make(registry); }",
      "export function run() { while (true) { while (make) return make(registry); } }",
      "export function run() { switch (make) { case 1: return make(registry); } }",
    ]) {
      const { gate } = scan({ "src/copy.ts": [head, body].join("\n") });
      expect(gate.verdict).toBe("satisfied");
    }
  });

  it("does not treat ambient or type-only parameters as value bindings", () => {
    const head = [
      'import { createCopyResolver as make } from "@clossys/writer";',
      'import registry from "../copy/registry.json";',
    ].join("\n");
    const use = "export const out = make(registry);";
    for (const decl of [
      "declare function load(make: unknown): void;",
      "declare class C { constructor(make: unknown); }",
      "interface Loader { load(make: unknown): void }",
      "type Loader = { load(make: unknown): void }",
      "interface C { new (make: unknown): C }",
      "declare class C { load(make: unknown): void }",
      "interface Loader extends Base { load(make: unknown): void }",
      "type Loader = Base & { load(make: unknown): void }",
      "declare class C { constructor(readonly make: unknown); }",
      "declare namespace N { function load(make: unknown): void }",
      "type F = ((make: (x: number) => number) => void)",
      "function g(cb: string | ((make: number) => void)) { return cb; }",
      "const use: string | ((make: number) => void) = make",
      "function g(cb: Foo & ((make: number) => void)) { return cb; }",
      "function g(cb: Call<string, (make: number) => void>) { return cb; }",
      "function g(cb: [string, (make: number) => void]) { return cb; }",
    ]) {
      const { gate } = scan({ "src/copy.ts": [head, decl, use].join("\n") });
      expect(gate.verdict).toBe("satisfied");
    }
    const { gate: ctorGate } = scan({
      "src/copy.ts": [
        head,
        "class C { constructor(public make) { make(registry); } }",
        use,
      ].join("\n"),
    });
    expect(ctorGate.verdict).toBe("violated");
  });

  it("treats finished parseCopyRegistry bindings as clean regardless of type annotation length", () => {
    const head = [
      'import { createCopyResolver, parseCopyRegistry } from "@clossys/writer";',
      'import registry from "../copy/registry.json";',
    ].join("\n");
    const n387 = "T".repeat(387);
    const n2500 = "U".repeat(2500);
    const n1200a = "A".repeat(1200);
    const n1200b = "B".repeat(1200);
    for (const typeAnn of [
      n387,
      n2500,
      `${n1200a} | ${n1200b}`,
      `${n1200a} & ${n1200b}`,
    ]) {
      const { gate } = scan({
        "src/copy.ts": [
          head,
          `const reg: ${typeAnn} = parseCopyRegistry(registry); createCopyResolver(reg);`,
        ].join("\n"),
      });
      expect(gate.findings).toEqual([]);
      expect(gate.verdict).toBe("satisfied");
    }
  });

  it("flags parseCopyRegistry bindings continued by strict and inequality comparisons on a new line", () => {
    const head = [
      'import { createCopyResolver, parseCopyRegistry } from "@clossys/writer";',
      'import registry from "../copy/registry.json";',
    ].join("\n");
    for (const cmp of ["=== 0", "!= 0", "!== 0", "< 0", "> 0", "<= 0", ">= 0"]) {
      const { gate } = scan({
        "src/copy.ts": [
          head,
          "const reg = parseCopyRegistry(registry)",
          cmp,
          "export const out = createCopyResolver(reg);",
        ].join("\n"),
      });
      expect(gate.verdict).toBe("violated");
    }
  });

  it("does not treat type-alias function types with long names as value bindings", () => {
    const head = [
      'import { createCopyResolver as make } from "@clossys/writer";',
      'import registry from "../copy/registry.json";',
    ].join("\n");
    const use = "export const out = make(registry);";
    for (const n of [386, 387, 500]) {
      const name = "T".repeat(n);
      const { gate } = scan({
        "src/copy.ts": [head, `type Alias = ${name}<(make: unknown) => void>;`, use].join("\n"),
      });
      expect(gate.findings).toEqual([]);
      expect(gate.verdict).toBe("satisfied");
    }
  });

  it("does not treat type-alias object members with long generic constraints as value bindings", () => {
    const head = [
      'import { createCopyResolver as make } from "@clossys/writer";',
      'import registry from "../copy/registry.json";',
    ].join("\n");
    const use = "export const out = make(registry);";
    const long = "X".repeat(200);
    for (const constraint of [`Foo<Bar>`, `${long}<Bar>`]) {
      const { gate } = scan({
        "src/copy.ts": [head, `type Alias<T extends ${constraint}> = { load(make: unknown): void };`, use].join("\n"),
      });
      expect(gate.findings).toEqual([]);
      expect(gate.verdict).toBe("satisfied");
    }
  });

  it("allows resolver calls when only whitespace separates the binding from the closing paren", () => {
    const head = [
      'import { createCopyResolver, parseCopyRegistry } from "@clossys/writer";',
      'import registry from "../copy/registry.json";',
    ].join("\n");
    for (const gap of [19, 20]) {
      const { gate } = scan({
        "src/copy.ts": [
          head,
          `const reg = parseCopyRegistry(registry); createCopyResolver(reg${" ".repeat(gap)});`,
        ].join("\n"),
      });
      expect(gate.findings).toEqual([]);
      expect(gate.verdict).toBe("satisfied");
    }
  });

  it("does not treat declare function with long whitespace gaps as value bindings", () => {
    const head = [
      'import { createCopyResolver as make } from "@clossys/writer";',
      'import registry from "../copy/registry.json";',
    ].join("\n");
    const use = "export const out = make(registry);";
    for (const gap of [5, 20]) {
      const { gate } = scan({
        "src/copy.ts": [head, `declare${" ".repeat(gap)}function load(make: unknown): void;`, use].join("\n"),
      });
      expect(gate.findings).toEqual([]);
      expect(gate.verdict).toBe("satisfied");
    }
  });

  it("flags nested array destructuring that shadows a renamed import", () => {
    const head = [
      'import { createCopyResolver as make } from "@clossys/writer";',
      'import registry from "../copy/registry.json";',
    ].join("\n");
    const use = "export const out = make(registry);";
    for (const shadow of [
      "const [[make]] = rows; make(registry);",
      "const [ [ make ] ] = rows; make(registry);",
    ]) {
      const { gate } = scan({ "src/copy.ts": [head, shadow, use].join("\n") });
      expect(gate.verdict).toBe("violated");
    }
  });

  it("flags array rest destructuring that shadows a renamed import", () => {
    const { gate } = scan({
      "src/copy.ts": [
        'import { createCopyResolver as make } from "@clossys/writer";',
        'import registry from "../copy/registry.json";',
        "const [...make] = rows; make(registry);",
        "export const out = make(registry);",
      ].join("\n"),
    });
    expect(gate.verdict).toBe("violated");
  });

  it("flags computed object destructuring with a nested binding", () => {
    const { gate } = scan({
      "src/copy.ts": [
        'import { createCopyResolver as make } from "@clossys/writer";',
        'import registry from "../copy/registry.json";',
        "const { [key]: { make } } = row; make(registry);",
        "export const out = make(registry);",
      ].join("\n"),
    });
    expect(gate.verdict).toBe("violated");
  });

  it("flags namespace functions with a body when the return type is a qualified name", () => {
    const head = [
      'import { createCopyResolver as make } from "@clossys/writer";',
      'import registry from "../copy/registry.json";',
    ].join("\n");
    const use = "export const out = make(registry);";
    for (const ret of ["Foo.Bar", "Foo.Bar[]", "typeof Foo.Bar"]) {
      const { gate } = scan({
        "src/copy.ts": [
          head,
          `namespace N { function load(make: unknown): ${ret} { return make(registry); } }`,
          use,
        ].join("\n"),
      });
      expect(gate.verdict).toBe("violated");
    }
  });

  it("flags object and class methods that are not the first member", () => {
    const head = [
      'import { createCopyResolver as make } from "@clossys/writer";',
      'import registry from "../copy/registry.json";',
    ].join("\n");
    const use = "export const out = make(registry);";
    for (const shadow of [
      "class C { constructor() {} load(make: Handler): void { make(registry); } }",
      "const obj = { x: 1, load(make: Handler): void { make(registry); } };",
    ]) {
      const { gate } = scan({ "src/copy.ts": [head, shadow, use].join("\n") });
      expect(gate.verdict).toBe("violated");
    }
  });

  it("does not treat ambient declare-class members as value bindings regardless of class-name length", () => {
    const head = [
      'import { createCopyResolver as make } from "@clossys/writer";',
      'import registry from "../copy/registry.json";',
    ].join("\n");
    const use = "export const out = make(registry);";
    const member = "load(make: Handler): void";
    for (const nameLen of [105, 106, 120, 200]) {
      const name = "C".repeat(nameLen);
      for (const gap of [" ", ""]) {
        const { gate } = scan({
          "src/copy.ts": [head, `declare class ${name}${gap}{ ${member} }`, use].join("\n"),
        });
        expect(gate.findings).toEqual([]);
        expect(gate.verdict).toBe("satisfied");
      }
    }
  });

  it("does not treat declare-class members as value bindings after long declare gaps", () => {
    const head = [
      'import { createCopyResolver as make } from "@clossys/writer";',
      'import registry from "../copy/registry.json";',
    ].join("\n");
    const use = "export const out = make(registry);";
    const body = "declare class C { load(make: Handler): void }";
    for (const gap of [20, 100, 110, 200]) {
      const { gate } = scan({
        "src/copy.ts": [head, `declare${" ".repeat(gap)}class C { load(make: Handler): void }`, use].join("\n"),
      });
      expect(gate.findings).toEqual([]);
      expect(gate.verdict).toBe("satisfied");
    }
  });

  it("does not treat non-first ambient declare-class methods as value bindings", () => {
    const head = [
      'import { createCopyResolver as make } from "@clossys/writer";',
      'import registry from "../copy/registry.json";',
    ].join("\n");
    const use = "export const out = make(registry);";
    for (const decl of [
      "declare class C { constructor() {} load(make: Handler): void }",
      "declare class C { constructor() {}\nload(make: Handler): void }",
    ]) {
      const { gate } = scan({ "src/copy.ts": [head, decl, use].join("\n") });
      expect(gate.findings).toEqual([]);
      expect(gate.verdict).toBe("satisfied");
    }
  });

  it("flags class methods that follow a field as value bindings", () => {
    const head = [
      'import { createCopyResolver as make } from "@clossys/writer";',
      'import registry from "../copy/registry.json";',
    ].join("\n");
    const use = "export const out = make(registry);";
    for (const shadow of [
      "class C { x = 1; load(make: Handler): void { make(registry); } }",
      "class C {\n  x = 1;\n  load(make: Handler): void { make(registry); }\n}",
    ]) {
      const { gate } = scan({ "src/copy.ts": [head, shadow, use].join("\n") });
      expect(gate.verdict).toBe("violated");
    }
  });

  it("does not treat declare-class headers with type parameters, extends, implements, or abstract as value bindings", () => {
    const head = [
      'import { createCopyResolver as make } from "@clossys/writer";',
      'import registry from "../copy/registry.json";',
    ].join("\n");
    const use = "export const out = make(registry);";
    const member = "load(make: Handler): void";
    const longName = "C".repeat(80);
    const longConstraint = "L".repeat(80);
    for (const decl of [
      `declare class C<T> { ${member} }`,
      `declare class ${longName}<T extends ${longConstraint}> { ${member} }`,
      "export declare class C { load(make: Handler): void }",
      "declare class C extends Foo { load(make: Handler): void }",
      "declare class C extends Foo<Bar> { load(make: Handler): void }",
      "declare class C implements Foo { load(make: Handler): void }",
      "declare abstract class C { load(make: Handler): void }",
    ]) {
      const { gate } = scan({ "src/copy.ts": [head, decl, use].join("\n") });
      expect(gate.findings).toEqual([]);
      expect(gate.verdict).toBe("satisfied");
    }
  });

  it("does not treat interface members after a semicolon as value bindings", () => {
    const head = [
      'import { createCopyResolver as make } from "@clossys/writer";',
      'import registry from "../copy/registry.json";',
    ].join("\n");
    const use = "export const out = make(registry);";
    for (const decl of [
      "interface X { a: number; load(make: Handler): void }",
      "interface X { load(other: Handler): void; save(make: Handler): void }",
    ]) {
      const { gate } = scan({ "src/copy.ts": [head, decl, use].join("\n") });
      expect(gate.findings).toEqual([]);
      expect(gate.verdict).toBe("satisfied");
    }
  });

  it("flags class and object methods whose type-parameter list contains a nested generic", () => {
    const head = [
      'import { createCopyResolver as make } from "@clossys/writer";',
      'import registry from "../copy/registry.json";',
    ].join("\n");
    const use = "export const out = make(registry);";
    for (const shadow of [
      "class C { load<T extends Foo<Bar>>(make: Handler): void { make(registry); } }",
      "const obj = { x: 1, load<T extends Foo<Bar>>(make: Handler): void { make(registry); } };",
    ]) {
      const { gate } = scan({ "src/copy.ts": [head, shadow, use].join("\n") });
      expect(gate.verdict).toBe("violated");
    }
  });

  it("flags class and object methods after a field without a semicolon (fix round 24)", () => {
    const head = [
      'import { createCopyResolver as make } from "@clossys/writer";',
      'import registry from "../copy/registry.json";',
    ].join("\n");
    const use = "export const out = make(registry);";
    for (const shadow of [
      "class C { x = 1\nload(make: Handler): void { make(registry); } }",
      "class C { x = 1\nload<T extends Foo<Bar>>(make: Handler): void { make(registry); } }",
      "const obj = { x: 1,\nload<T extends Foo<Bar>>(make: Handler): void { make(registry); } }",
    ]) {
      const { gate } = scan({ "src/copy.ts": [head, shadow, use].join("\n") });
      expect(gate.verdict).toBe("violated");
    }
  });

  it("flags class methods with whitespace before generic type parameters (fix round 24)", () => {
    const head = [
      'import { createCopyResolver as make } from "@clossys/writer";',
      'import registry from "../copy/registry.json";',
    ].join("\n");
    const use = "export const out = make(registry);";
    for (const shadow of [
      "class C { load <T extends Foo<Bar>>(make: Handler): void { make(registry); } }",
      "class C { load\t<T extends Foo<Bar>>(make: Handler): void { make(registry); } }",
      "class C { load\n<T extends Foo<Bar>>(make: Handler): void { make(registry); } }",
    ]) {
      const { gate } = scan({ "src/copy.ts": [head, shadow, use].join("\n") });
      expect(gate.verdict).toBe("violated");
    }
  });

  it("flags class and object methods with header modifiers and accessors (fix round 24)", () => {
    const head = [
      'import { createCopyResolver as make } from "@clossys/writer";',
      'import registry from "../copy/registry.json";',
    ].join("\n");
    const use = "export const out = make(registry);";
    for (const shadow of [
      "class C { static load(make: Handler): void { make(registry); } }",
      "class C { async load(make: Handler): void { make(registry); } }",
      "class C { public load(make: Handler): void { make(registry); } }",
      "class C { private load(make: Handler): void { make(registry); } }",
      "class C { protected load(make: Handler): void { make(registry); } }",
      "class C { override load(make: Handler): void { make(registry); } }",
      "class C { *load(make: Handler): void { make(registry); } }",
      "class C { set load(make: Handler) { make(registry); } }",
      "class C { static async load(make: Handler): void { make(registry); } }",
      "class C { x = 1; async load(make: Handler): void { make(registry); } }",
      "class C { constructor() {} async load(make: Handler): void { make(registry); } }",
      "const obj = { x: 1, async load(make: Handler): void { make(registry); } }",
      "const obj = { x: 1, *load(make: Handler): void { make(registry); } }",
      "const obj = { async load<T extends Foo<Bar>>(make: Handler): void { make(registry); } }",
    ]) {
      const { gate } = scan({ "src/copy.ts": [head, shadow, use].join("\n") });
      expect(gate.verdict).toBe("violated");
    }
  });

  it("walks get accessor headers without treating resolver calls as bypass when the import is not shadowed", () => {
    const head = [
      'import { createCopyResolver as make } from "@clossys/writer";',
      'import registry from "../copy/registry.json";',
    ].join("\n");
    const use = "export const out = make(registry);";
    const { gate } = scan({
      "src/copy.ts": [head, "class C { get load() { return make(registry); } }", use].join("\n"),
    });
    expect(gate.findings).toEqual([]);
    expect(gate.verdict).toBe("satisfied");
  });

  it("does not treat an interface field and method separated by a newline as value bindings", () => {
    const head = [
      'import { createCopyResolver as make } from "@clossys/writer";',
      'import registry from "../copy/registry.json";',
    ].join("\n");
    const use = "export const out = make(registry);";
    const { gate } = scan({
      "src/copy.ts": [head, "interface X { a: number\nload(make: Handler): void }", use].join("\n"),
    });
    expect(gate.findings).toEqual([]);
    expect(gate.verdict).toBe("satisfied");
  });

  it("does not flag typeof queries on the registry binding at long whitespace gaps", () => {
    const head = [
      'import { createCopyResolver } from "@clossys/writer";',
      'import registry from "../copy/registry.json";',
    ].join("\n");
    for (const gap of [14, 15, 40]) {
      const { gate } = scan({
        "src/copy.ts": [
          head,
          `export const t = typeof${" ".repeat(gap)}registry;`,
          "export const resolver = createCopyResolver(registry);",
        ].join("\n"),
      });
      expect(gate.findings).toEqual([]);
      expect(gate.verdict).toBe("satisfied");
    }
  });

  it("flags an array-literal arrow parameter without parentheses", () => {
    const { gate } = scan({
      "src/copy.ts": [
        'import { createCopyResolver as make } from "@clossys/writer";',
        'import registry from "../copy/registry.json";',
        "const f = [make => make(registry)];",
        "export const out = make(registry);",
      ].join("\n"),
    });
    expect(gate.verdict).toBe("violated");
  });

  it("flags the newline member at any class-name length (fix round 25)", () => {
    const head = [
      'import { createCopyResolver as make } from "@clossys/writer";',
      'import registry from "../copy/registry.json";',
    ].join("\n");
    const use = "export const out = make(registry);";
    const member = "x = 1\nload(make: Handler): void { make(registry); }";
    for (const nameLen of [313, 314, 315, 400]) {
      const name = "C".repeat(nameLen);
      const { gate } = scan({
        "src/copy.ts": [head, `class ${name} { ${member} }`, use].join("\n"),
      });
      expect(gate.verdict).toBe("violated");
    }
  });

  it("flags the newline member at any heritage-name length (fix round 25)", () => {
    const head = [
      'import { createCopyResolver as make } from "@clossys/writer";',
      'import registry from "../copy/registry.json";',
    ].join("\n");
    const use = "export const out = make(registry);";
    const member = "x = 1\nload(make: Handler): void { make(registry); }";
    for (const nameLen of [303, 304, 400]) {
      const heritage = "F".repeat(nameLen);
      const { gate } = scan({
        "src/copy.ts": [head, `class C extends ${heritage} { ${member} }`, use].join("\n"),
      });
      expect(gate.verdict).toBe("violated");
    }
  });

  it("flags the newline member at any whitespace gap before the object literal (fix round 25)", () => {
    const head = [
      'import { createCopyResolver as make } from "@clossys/writer";',
      'import registry from "../copy/registry.json";',
    ].join("\n");
    const use = "export const out = make(registry);";
    const member = "{ x: 1\nload(make: Handler): void { make(registry); } }";
    for (const gap of [319, 320, 400]) {
      const { gate } = scan({
        "src/copy.ts": [head, `const obj =${" ".repeat(gap)}${member}`, use].join("\n"),
      });
      expect(gate.verdict).toBe("violated");
    }
  });

  it("flags the newline member in a returned and an argument object literal (fix round 25)", () => {
    const head = [
      'import { createCopyResolver as make } from "@clossys/writer";',
      'import registry from "../copy/registry.json";',
    ].join("\n");
    const use = "export const out = make(registry);";
    for (const shadow of [
      "function f() { return { x: 1\nload(make: Handler): void { make(registry); } }; }",
      "foo({ x: 1\nload(make: Handler): void { make(registry); } });",
    ]) {
      const { gate } = scan({ "src/copy.ts": [head, shadow, use].join("\n") });
      expect(gate.verdict).toBe("violated");
    }
  });

  it("flags modifier-named methods whose parameter list is read (fix round 25)", () => {
    const head = [
      'import { createCopyResolver as make } from "@clossys/writer";',
      'import registry from "../copy/registry.json";',
    ].join("\n");
    const use = "export const out = make(registry);";
    const words = ["async", "get", "set", "static", "public", "private", "protected", "override", "readonly"];
    for (const word of words) {
      const classMethod = `class C { ${word}(make: Handler): void { make(registry); } }`;
      const objectMethod = `const obj = { ${word}(make: Handler): void { make(registry); } };`;
      for (const shadow of [classMethod, objectMethod]) {
        const { gate } = scan({ "src/copy.ts": [head, shadow, use].join("\n") });
        expect(gate.verdict).toBe("violated");
      }
    }
  });

  it("reads the parameter list of a method named abstract on an abstract class (fix round 25)", () => {
    const head = [
      'import { createCopyResolver as make } from "@clossys/writer";',
      'import registry from "../copy/registry.json";',
    ].join("\n");
    const use = "export const out = make(registry);";
    const { gate } = scan({
      "src/copy.ts": [head, "abstract class C { abstract load(make: Handler): void { make(registry); } }", use].join("\n"),
    });
    expect(gate.verdict).toBe("violated");
    expect(gate.findings.every((f) => f.rule === "copy-read-without-resolver")).toBe(true);
  });

  it("keeps modifier lead-ins on the real method name (fix round 25)", () => {
    const head = [
      'import { createCopyResolver as make } from "@clossys/writer";',
      'import registry from "../copy/registry.json";',
    ].join("\n");
    const use = "export const out = make(registry);";
    for (const shadow of [
      "class C { static load(make: Handler): void { make(registry); } }",
      "class C { static async load(make: Handler): void { make(registry); } }",
      "const obj = { async load(make: Handler): void { make(registry); } };",
    ]) {
      const { gate } = scan({ "src/copy.ts": [head, shadow, use].join("\n") });
      expect(gate.verdict).toBe("violated");
    }
  });

  it("flags namespace bodies at any type-operator header (fix round 26)", () => {
    const head = [
      'import { createCopyResolver as make } from "@clossys/writer";',
      'import registry from "../copy/registry.json";',
    ].join("\n");
    const use = "export const out = make(registry);";
    const member = "x = 1\nload(make: Handler): void { make(registry); }";
    for (const header of [
      "namespace Foo.Bar",
      "namespace Foo.Bar[]",
      "namespace typeof Foo.Bar",
      "namespace readonly (string | number)[]",
      "namespace keyof Foo",
      "namespace typeof Foo",
      "namespace unique symbol",
      "namespace N",
    ]) {
      const { gate } = scan({ "src/copy.ts": [head, `${header} { ${member} }`, use].join("\n") });
      expect(gate.verdict).toBe("violated");
      expect(gate.findings.every((f) => f.rule === "copy-read-without-resolver")).toBe(true);
    }
  });

  it("flags class bodies whose header contains a parenthesis (fix round 26)", () => {
    const head = [
      'import { createCopyResolver as make } from "@clossys/writer";',
      'import registry from "../copy/registry.json";',
    ].join("\n");
    const use = "export const out = make(registry);";
    const member = "x = 1\nload(make: Handler): void { make(registry); }";
    for (const header of [
      "class C extends mixin(Base)",
      "class C extends (Foo)",
      "class C extends ns.mixin(Base)",
      "class C<T extends (Foo)>",
      "class C extends Foo<Bar>",
      "class C implements A<B>",
    ]) {
      const { gate } = scan({ "src/copy.ts": [head, `${header} { ${member} }`, use].join("\n") });
      expect(gate.verdict).toBe("violated");
      expect(gate.findings.every((f) => f.rule === "copy-read-without-resolver")).toBe(true);
    }
  });

  it("couples a registry import with a long named clause and reports the bypass (fix round 26)", () => {
    for (const len of [1900, 2000, 2001, 2100, 3200]) {
      const names = Array.from({ length: Math.ceil(len / 10) }, (_, i) => `n${i}abcdefg`).join(", ").slice(0, len);
      const src = [
        `import registry, { ${names} } from "../copy/registry.json";`,
        "export const out = registry.entries;",
      ].join("\n");
      const { scan: s, gate } = scan({ "src/copy.ts": src });
      expect(s.coupledFiles).toEqual(["src/copy.ts"]);
      expect(gate.verdict).toBe("violated");
      expect(gate.findings.some((f) => f.rule === "copy-read-without-resolver")).toBe(true);
    }
  });
});

describe("scope and masking", () => {
  it("ignores the pattern inside comments and strings", () => {
    const { scan: s, gate } = scan({
      "src/copy.ts": [
        'import { createCopyResolver } from "@clossys/writer";',
        'import registry from "../copy/registry.json";',
        '// status: "approved"',
        'const s = "x.approvedBy = 1";',
        "/* registry.entries */",
        "const t = `pendingOwnerReview: true`;",
        "export const resolver = createCopyResolver(registry);",
        "export { s, t };",
      ].join("\n"),
    });
    expect(s.coupledFiles).toEqual(["src/copy.ts"]);
    expect(gate.findings).toEqual([]);
    expect(gate.verdict).toBe("satisfied");
  });

  it("ignores uncoupled files", () => {
    const { scan: s, gate } = scan({
      "src/model.ts": ['export const order = { id: 1, status: "approved", approvedBy: "delegate-a" };', 'order.status = "approved";'].join("\n"),
    });
    expect(s.filesScanned).toBe(1);
    expect(s.coupledFiles).toEqual([]);
    expect(gate.verdict).toBe("satisfied");
  });

  it("skips test files and the registry itself, and records skipped files", () => {
    const root = fixture({
      "src/copy.test.ts": 'import { createCopyResolver } from "@clossys/writer";\nconst e = { status: "approved" };\n',
      "src/ok.ts": "export const n = 1;\n",
    });
    // A .ts registry in the scanned set is data, not consumer code.
    writeFileSync(join(root, "copy/registry.ts"), 'export const entries = [{ status: "approved" }];\n');
    const result = scanApprovalBypass(root, { registryPath: join(root, "copy/registry.ts") });
    expect(result.skippedByDesign).toEqual([{ file: "src/copy.test.ts", reason: "test-or-check-file" }]);
    expect(result.filesScanned).toBe(1);
    expect(checkApprovalBypass(result).verdict).toBe("satisfied");
  });
});

describe("the ternary", () => {
  it("dynamic import is unchecked", () => {
    const { gate } = scan({
      "src/copy.ts": [
        'import { createCopyResolver } from "@clossys/writer";',
        "export async function load() {",
        '  const r = await import("../copy/registry.json");',
        "  return createCopyResolver(r);",
        "}",
      ].join("\n"),
    });
    expect(gate.verdict).toBe("indeterminate");
    expect(gate.unchecked).toEqual([expect.objectContaining({ kind: "registry-dynamic-import", line: 3 })]);
    expect(gate.reasons.length).toBeGreaterThan(0);
  });

  it("non-literal loads, unbound requires and registry-naming strings are unchecked", () => {
    const { gate } = scan({
      "src/copy.js": [
        'const { createCopyResolver } = require("@clossys/writer");',
        'const entries = require("../copy/registry.json").entries;',
        "const other = require(process.env.X);",
        'const path = "copy/registry.json";',
        "module.exports = { createCopyResolver, entries, other, path };",
      ].join("\n"),
    });
    expect(gate.verdict).toBe("indeterminate");
    expect(gate.unchecked.map((u) => u.kind)).toEqual(["registry-require-unbound", "require-non-literal", "registry-path-string"]);
  });

  it("violation outranks unchecked", () => {
    const { gate } = scan({
      "src/copy.ts": [
        'import { createCopyResolver } from "@clossys/writer";',
        'export const e = { id: "site.home.title", status: "approved" };',
        'export const later = () => import("../copy/registry.json");',
      ].join("\n"),
    });
    expect(gate.unchecked).toHaveLength(1);
    expect(gate.verdict).toBe("violated");
    expect(gate.reasons.length).toBeGreaterThan(0);
  });

  it("zero files scanned is indeterminate; a parse failure is recorded", () => {
    const { scan: s, gate } = scan({ "src/broken.ts": 'const s = "unterminated\nconst t = `never closed;\n' });
    expect(s.filesScanned).toBe(0);
    expect(s.parseFailures).toHaveLength(1);
    expect(gate.verdict).toBe("indeterminate");
  });

  it("throws on a missing registry file", () => {
    const root = fixture({ "src/a.ts": "export const n = 1;\n" });
    expect(() => scanApprovalBypass(root, { registryPath: "copy/missing.json" })).toThrow(/does not exist/);
  });

  it("throws on an unreadable directory", () => {
    if (process.getuid?.() === 0) return; // root reads through mode bits
    const root = fixture({ "src/locked/a.ts": "export const n = 1;\n" });
    chmodSync(join(root, "src/locked"), 0o000);
    try {
      expect(() => scanApprovalBypass(root, { registryPath: "copy/registry.json" })).toThrow(/cannot read directory/);
    } finally {
      chmodSync(join(root, "src/locked"), 0o755);
    }
  });
});

describe("extractApprovalBypass", () => {
  it("reports coupling and results for a single in-memory source", () => {
    const root = fixture({});
    const out = extractApprovalBypass('import registry from "./registry.json";\nexport default registry;\n', "copy/index.ts", {
      registryPath: join(root, "copy/registry.json"),
      absoluteFilePath: join(root, "copy/index.ts"),
    });
    expect(out.coupled).toBe(true);
    expect(out.findings).toEqual([expect.objectContaining({ rule: "copy-read-without-resolver", line: 2, file: "copy/index.ts" })]);
  });
});
