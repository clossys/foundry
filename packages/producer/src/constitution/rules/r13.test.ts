import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildContext } from "../context.js";
import { cleanSpec, contextOf, NO_HISTORY } from "../__fixtures__/workspace.js";
import { MODULE_REPO } from "./r11.js";
import { assembleRows, copySourceRows, R13 } from "./r13.js";

const COPY_OUT = [
  "FAIL jsx (1)",
  "jsx      packages/producer/studio/components/A.tsx:12: renders the literal \"Save\" (use a Writer key)",
  "ok   prop",
  "FAIL keys (1)",
  "keys     packages/producer/studio/lib/b.ts:4: studio.missing-key is not a Writer key",
  "FAIL names (1)",
  "names    clossys/agents/producer/ia.json: node build has no Writer label",
  "check-copy-source: 3 findings",
].join("\n");

describe("R13.1 and R13.3 copy source", () => {
  it("failing-first: literal strings are R13.1 rows, unresolved keys and names R13.3 rows", () => {
    const { r131, r133 } = copySourceRows({ status: 1, stdout: COPY_OUT, stderr: "" });
    expect(r131.map(row => [row.check, row.path])).toEqual([["R13.1", "packages/producer/studio/components/A.tsx:12"]]);
    expect(r133.map(row => [row.check, row.path])).toEqual([["R13.3", "packages/producer/studio/lib/b.ts:4"], ["R13.3", "clossys/agents/producer/ia.json"]]);
    expect(copySourceRows({ status: 0, stdout: "ok   jsx\ncheck-copy-source: every rule holds\n", stderr: "" })).toEqual({ r131: [], r133: [] });
  });

  it("a crash or a failing run without finding lines is a no-verdict row on both checks", () => {
    for (const run of [{ status: 1, stdout: "", stderr: "Error [ERR_MODULE_NOT_FOUND]: dist" }, { status: null, stdout: "", stderr: "", error: "spawn ENOENT" }]) {
      const { r131, r133 } = copySourceRows(run);
      expect([...r131, ...r133].map(row => row.check)).toEqual(["R13.1", "R13.3"]);
      expect(r131[0]!.reason).toMatch(/gave no verdict/);
    }
  });
});

describe("R13.2 assemble only", () => {
  it("failing-first: every assemble-only finding is a row", () => {
    expect(assembleRows({ status: 0, stdout: "[]", stderr: "" })).toEqual([]);
    const rows = assembleRows({ status: 1, stdout: JSON.stringify([{ rule: "app-route", file: "packages/producer/studio/app/x/page.tsx", detail: "hand-rolled route" }, { rule: "agent-branch", file: "packages/producer/studio/lib/y.ts", line: 3, detail: "if (agent === 'writer')" }]), stderr: "" });
    expect(rows.map(row => [row.check, row.path])).toEqual([["R13.2", "packages/producer/studio/app/x/page.tsx"], ["R13.2", "packages/producer/studio/lib/y.ts:3"]]);
    expect(assembleRows({ status: 1, stdout: "[]", stderr: "" })[0]!.reason).toMatch(/gave no verdict/);
    expect(assembleRows({ status: 2, stdout: "", stderr: "boom" })[0]!.reason).toMatch(/gave no verdict/);
  });

  it("a code-free root (the fixture) gives no row", () => {
    const ctx = contextOf(cleanSpec());
    expect(Object.values(R13.checks).flatMap(check => check(ctx))).toEqual([]);
  });
});

describe.skipIf(!existsSync(`${MODULE_REPO}/packages/producer/dist/cli/index.js`))("R13 on this repository", () => {
  it("runs check-copy-source and check-assemble-only to a verdict (no broken-script row)", () => {
    const ctx = buildContext(MODULE_REPO, `${MODULE_REPO}/clossys`, { history: () => NO_HISTORY });
    const rows = Object.values(R13.checks).flatMap(check => check(ctx));
    expect(rows.filter(row => /gave no verdict/.test(row.reason))).toEqual([]);
  }, 180_000);
});
