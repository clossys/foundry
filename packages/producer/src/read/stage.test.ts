/**
 * `clossys status --json` `stage` and `next` (foundry-build-0048 CP1-FRONTDOOR): where the engagement stands and the
 * exact step a resumed session runs first, with the model tier its subagent uses and that tier's seat-policy model.
 * Run on temp workspaces through the real CLI, so the dry walk is the one `clossys run --dry` takes.
 */
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import "../cli/main.js";
import { runInitCli } from "../cli/init.js";
import { runStatusCli } from "../cli/status.js";
import { validateAgainst, type JsonSchema } from "../records/schema.js";
import { SEAT_POLICY_FILE, SEAT_POLICY_SCHEMA } from "../pipeline/seat-policy.js";
import { modelOfTier, tierOfKind, type NextStep, type Stage } from "./stage.js";

const SCHEMA = JSON.parse(readFileSync(new URL("../../schemas/status.json", import.meta.url), "utf8")) as JsonSchema;
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function workspace(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "stage-")));
  roots.push(root);
  mkdirSync(join(root, "clossys"), { recursive: true });
  writeFileSync(join(root, "clossys", "clossys.config.ts"), "export default {};\n");
  return root;
}
async function where(root: string): Promise<{ stage: Stage; next: NextStep | null }> {
  const result = await runStatusCli(["--json"], root);
  expect(result.exitCode).toBe(0);
  const view = result.output as { stage: Stage; next: NextStep | null };
  expect(validateAgainst(SCHEMA, view)).toEqual([]);
  return view;
}
function seatPolicy(root: string, models: Record<string, string>): void {
  writeFileSync(join(root, SEAT_POLICY_FILE), `${JSON.stringify({ schema: SEAT_POLICY_SCHEMA, models, humanOnly: false }, null, 2)}\n`);
}

describe("clossys status: stage and next", { timeout: 300_000 }, () => {
  it("a fresh workspace is stage strategy with next on Director", async () => {
    const root = workspace();
    const { stage, next } = await where(root);
    expect(stage).toBe("strategy");
    expect(next).toMatchObject({ step: "ia", agent: "director", kind: "decide:judgment", tier: "mid", model: null });
    expect(next?.skill).toMatch(/skill\.md$/);
    // The same bytes for the same records.
    const again = await where(root);
    expect(JSON.stringify({ stage: again.stage, next: again.next })).toBe(JSON.stringify({ stage, next }));
  });

  it("a workspace with Director pinned moves next to Designer or Writer", async () => {
    const root = workspace();
    const init = await runInitCli(["--at", "2026-11-25T09:00:00Z"], root);
    expect(init.exitCode).toBe(0);
    const { stage, next } = await where(root);
    expect(["designer", "writer"]).toContain(next?.agent);
    expect(stage).toBe("fill");
  });

  it("next.tier follows the step kind and next.model reads seat-policy", async () => {
    expect(tierOfKind("plumb")).toBe("none");
    expect(tierOfKind("decide:judgment")).toBe("mid");
    expect(tierOfKind("decide:creative")).toBe("high");
    const root = workspace();
    // No policy: the tier stands, the model is never guessed.
    expect((await where(root)).next).toMatchObject({ tier: "mid", model: null });
    seatPolicy(root, { mid: "synthetic-mid-model", high: "synthetic-high-model" });
    expect((await where(root)).next).toMatchObject({ kind: "decide:judgment", tier: "mid", model: "synthetic-mid-model" });
    expect(modelOfTier(root, "high")).toBe("synthetic-high-model");
    expect(modelOfTier(root, "none")).toBeNull();
    // A policy that names no model for the tier: null, not another tier's model.
    seatPolicy(root, { high: "synthetic-high-model" });
    expect((await where(root)).next).toMatchObject({ tier: "mid", model: null });
    // An invalid policy is never a default.
    writeFileSync(join(root, SEAT_POLICY_FILE), "not json\n");
    expect((await where(root)).next?.model).toBeNull();
  });
});
