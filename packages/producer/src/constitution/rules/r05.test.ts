import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { writerText } from "../certify/certify.world.js";
import { cleanSpec, contextOf, expectCatches, validPin } from "../__fixtures__/workspace.js";
import type { Check, ConstitutionContext } from "../types.js";
import { BORROWING, R05, R05_3_ROOTS, R05_CHECKS, r05_1, r05_2, r05_3, reasonText } from "./r05.js";
import { certifiedSpec, certifiedWorld, heroSlot, type Edit } from "./r05.world.js";

const put = (path: string, text: string) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, text); };
const source = (rel: string, text: string): Edit => root => put(join(root, rel), text);

function catches(check: Check, broken: ConstitutionContext, reason: RegExp, clean: ConstitutionContext = certifiedWorld()) {
  const rows = expectCatches(check, clean, broken);
  expect(rows.map(row => row.reason).join("\n")).toMatch(reason);
  for (const row of rows) expect(row.rule).toBe("R05");
  return rows;
}

describe("R05 module", () => {
  it("declares R05.1-R05.3", () => {
    expect(R05.rule).toBe("R05");
    expect(Object.keys(R05_CHECKS)).toEqual(["R05.1", "R05.2", "R05.3"]);
  });

  it("the certified world is clean under every R05 check", () => {
    const ctx = certifiedWorld();
    for (const [id, check] of Object.entries(R05_CHECKS)) expect(check(ctx), id).toEqual([]);
  });

  it("reasonText leads with the codes so fit failures group by code", () => {
    expect(reasonText([{ code: "no-standard", message: "a" }, { code: "no-fixture", message: "b" }, { code: "no-standard", message: "c" }])).toBe("[no-standard,no-fixture] a; b; c");
  });

  it("c3-8 reasonText lists every reason; the codes and the pass set do not change", () => {
    const reasons = [{ code: "no-standard", message: "a" }, { code: "no-fixture", message: "b" }, { code: "no-standard", message: "c" }];
    const text = reasonText(reasons);
    expect(text).not.toMatch(/more\)/);
    for (const reason of reasons) expect(text).toContain(reason.message);
    expect(text.startsWith("[no-standard,no-fixture] ")).toBe(true);
    expect(reasonText([])).toBe("[] uncertified");
    // The pass set: the certified world still yields no row under any R05 check.
    const ctx = certifiedWorld();
    for (const [id, check] of Object.entries(R05_CHECKS)) expect(check(ctx), id).toEqual([]);
  });
});

describe("R05.1 every candidate of every live slot is certified", () => {
  it("catches a candidate that misses a fixture key", () => {
    const rows = catches(r05_1, certifiedWorld(certifiedSpec(heroSlot({ "hero-v2.md": writerText("home.hero", { lede: "Hello." }) }))), /^\[fixture\] en lacks 1 fixture key\(s\): title/);
    expect(rows).toEqual([expect.objectContaining({ check: "R05.1", agent: "writer", slot: "home.hero", candidate: "hero-v2.md" })]);
  });

  it("catches a candidate that fails a requirement of the standard", () => {
    catches(r05_1, certifiedWorld(certifiedSpec(heroSlot({ "hero-v2.md": writerText("home.hero", { title: "TODO lorem ipsum" }) }))), /^\[requirement\]/);
  });

  it("catches every candidate of a slot whose standard is missing, and of a slot with no fixture", () => {
    catches(r05_1, certifiedWorld(certifiedSpec(), root => put(join(root, "packages/writer/standards/fixture-headline/requirements.json"), "{")), /^\[standard\]/);
    const contextless = heroSlot();
    const doc = contextless.slot as Record<string, unknown>;
    const { fixture: _fixture, ...contract } = doc.contract as Record<string, unknown>;
    catches(r05_1, certifiedWorld(certifiedSpec({ ...contextless, slot: { ...doc, contract } })), /^\[no-fixture\]/);
  });

  it("reports every candidate of a workspace with no standards (nothing passes by default)", () => {
    const ctx = contextOf(cleanSpec());
    const rows = r05_1(ctx);
    expect(rows).toHaveLength(6);
    for (const row of rows) expect(row.reason).toMatch(/^\[[a-z-,]*no-standard[a-z-,]*\]/);
  });
});

describe("R05.2 a pin points only to a certified candidate", () => {
  it("catches a pin to an uncertified candidate", () => {
    const bad = writerText("home.hero", { lede: "Hello." });
    const rows = catches(r05_2, certifiedWorld(certifiedSpec(heroSlot({ "lede-v1.md": bad }, { pin: validPin("lede-v1.md", bad) }))), /pins lede-v1\.md, which is uncertified: \[fixture\]/);
    expect(rows).toEqual([expect.objectContaining({ check: "R05.2", candidate: "lede-v1.md" })]);
  });

  it("is silent on a slot with no pin (R04 reports that)", () => {
    expect(r05_2(certifiedWorld(certifiedSpec(heroSlot({}, { pin: false }))))).toEqual([]);
  });
});

describe("R05.3 no fixture borrowing", () => {
  it("catches specimen, server or certify code reading a sibling or borrowed fixture", () => {
    for (const dir of R05_3_ROOTS) {
      const rows = catches(r05_3, certifiedWorld(certifiedSpec(), source(`${dir}/borrow.ts`, "export const fixture = (slot) => slotFixture(slot);\n")), /reads slotFixture/);
      expect(rows).toEqual([expect.objectContaining({ check: "R05.3", path: `${dir}/borrow.ts` })]);
    }
    catches(r05_3, certifiedWorld(certifiedSpec(), source("packages/producer/src/server/a.tsx", "const x = siblingPreviews[0];\n")), /reads siblingPreviews/);
  });

  it("ignores comments, tests and fixtures", () => {
    const ctx = certifiedWorld(certifiedSpec(), root => {
      put(join(root, "packages/producer/src/server/history.ts"), "// 18: an option mounts the slot fixture, library-source slotFixture (deleted)\nexport const x = 1;\n");
      put(join(root, "packages/producer/src/server/a.test.ts"), "slotFixture();\n");
      put(join(root, "packages/producer/src/specimen/__fixtures__/b.ts"), "slotFixture();\n");
    });
    expect(r05_3(ctx)).toEqual([]);
    expect(BORROWING.test("borrowedPreview")).toBe(true);
    expect(BORROWING.test("contract.fixture")).toBe(false);
  });
});
