import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolveAgent } from "../../agents.js";
import { runCli } from "../../cli/main.js";
import { composedSlots } from "../../specimen/composed-slots.js";
import { buildContext } from "../context.js";
import { NO_HISTORY } from "../__fixtures__/workspace.js";
import { iaLabelUnique } from "../rules/r01-ia.js";
import type { ConstitutionContext, Row } from "../types.js";
import { contractDedupe, contractFixture } from "./R01-catalog.js";

/**
 * R01.3, R01.6 and R01.12 over the catalogs the Designer and Writer packages ship (CP1-U1): a fresh consumer adopts
 * the package IA through the verbs, and the checks read what the adopt wrote. R01.3 itself asks a token or asset
 * contract for a preview only where the element certifier mounts one (owner D1), so no contract kind is set aside
 * here; a composed slot's fixture is the consumer's (FCR), so R01.3 is read on every other slot: the scope comes from
 * the package's composed list, not from a slot list.
 */
const AGENTS = ["designer", "writer"] as const;

let root = "";
let ctx: ConstitutionContext;
beforeAll(async () => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "r01-package-catalog-")));
  const at = ["--root", root];
  for (const args of [["config", "--init"], ["ia", "director", "--adopt"], ["ia", "designer", "--adopt"], ["ia", "writer", "--adopt"]]) {
    const result = await runCli([...args, ...at], root);
    expect(result.exitCode, `${args.join(" ")}: ${result.message}`).toBe(0);
  }
  ctx = buildContext(root, join(root, "clossys"), { history: () => NO_HISTORY });
}, 240_000);
afterAll(() => { if (root) rmSync(root, { recursive: true, force: true }); });

const ours = (rows: readonly Row[]) => rows.filter(each => (AGENTS as readonly string[]).includes(each.agent));
const show = (rows: readonly Row[]) => rows.map(each => `${each.agent}/${each.slot}: ${each.reason}`).join("\n");

describe("the shipped Designer and Writer catalogs (R01 data rows)", () => {
  it("adopts both catalogs, so the checks below are not vacuous", () => {
    for (const agent of AGENTS) {
      const record = ctx.agents.find(each => each.agent === agent);
      expect(record, agent).toBeDefined();
      expect(record!.liveIds.length, agent).toBeGreaterThan(20);
    }
  });

  it("R01.3: every Writer slot and every Designer slot whose certifier mounts a preview carries one (composed slots are the consumer's)", () => {
    const composed = composedSlots(resolveAgent("designer").packageRoot);
    const rows = ours(contractFixture(ctx)).filter(each => each.agent === "writer" || !composed.has(each.slot));
    expect(show(rows)).toBe("");
  });

  it("R01.6: no two Designer or Writer slots share one contract (each icon names its glyph)", () => {
    expect(show(ours(contractDedupe(ctx)))).toBe("");
  });

  it("R01.12: every Designer and Writer L0 and L1 label is its id and names one concept", () => {
    expect(show(ours(iaLabelUnique(ctx)))).toBe("");
  });
});
