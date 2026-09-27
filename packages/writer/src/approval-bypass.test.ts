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
