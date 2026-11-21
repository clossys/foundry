/**
 * The base lookup of the strict checks for a content agent's loop slots (foundry-build-0048 CHECK-FIX P2): a loop
 * slot `clossys loop` adopted resolves from the base path it declares, and from nothing else; `records.computed-match`
 * and `brief.tighten-only` fail, naming the declared base, when that base is missing or unreadable, even when the
 * package catalog holds a slot of the same id (no fallback chain).
 */
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { adoptAgentLoops, adoptedLoopBasePath } from "../loop/agent-loop-adopt.js";
import { AGENT_LOOPS, LOOP_AGENTS } from "../loop/agent-loops-ia.js";
import { installedPackageRoot } from "../package-path.js";
import { readSlot, type TreeFinding } from "../records/slot.js";
import { runBriefTightenOnly } from "./brief-tighten-only.js";
import { declaresLoopBase, resolveSlotBase } from "./declared-base.js";
import { runRecordsComputedMatch } from "./records-computed-match.js";

const FIXTURE = fileURLToPath(new URL("../../test-fixtures/consumer", import.meta.url));
const AT = "2026-11-17T12:00:00Z";
/** Adoption runs the slot model check twice over the seeded world: seconds alone, more under a parallel suite. */
const LONG = 60_000;
const temps: string[] = [];
afterEach(() => { for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true }); });

/** A copy of the seeded consumer with every content agent's loops adopted through the verb. */
function adoptedWorld(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "declared-base-")));
  temps.push(root);
  cpSync(join(FIXTURE, "clossys"), join(root, "clossys"), { recursive: true });
  for (const agent of LOOP_AGENTS) expect(adoptAgentLoops(root, agent, { by: "planner:package-default", at: AT }).refused, agent).toEqual([]);
  return root;
}
const loopFindings = (findings: readonly TreeFinding[], agent = "[a-z]+") => findings.filter(finding => new RegExp(`^${agent}/loop\\.`).test(finding.subject));
/** Director's loop findings: with a local packages/ folder only packages/director is there, so the other agents' bases are missing. */
const directorFindings = (findings: readonly TreeFinding[]) => loopFindings(findings, "director");
const slotFile = (root: string, agent: string, loop: string) => join(root, "clossys", "agents", agent, loop, "slot.json");
const DECLARED = `@clossys/director/${adoptedLoopBasePath("loop.create")}`;

/** The root gains a local packages/director (as the Foundry repository has), so the declared base resolves there. */
function localDirector(root: string): string {
  const installed = installedPackageRoot("director")!;
  const local = join(root, "packages", "director");
  mkdirSync(local, { recursive: true });
  cpSync(join(installed, "package.json"), join(local, "package.json"));
  cpSync(join(installed, "loops"), join(local, "loops"), { recursive: true });
  return local;
}

describe("declared loop bases (CHECK-FIX P2)", () => {
  it("resolves a loop slot with a declared base: both checks pass every adopted loop slot", () => {
    const root = adoptedWorld();
    expect(loopFindings(runRecordsComputedMatch(root).findings)).toEqual([]);
    expect(loopFindings(runBriefTightenOnly(root).findings)).toEqual([]);
    const installed = installedPackageRoot("director")!;
    for (const loop of AGENT_LOOPS) {
      const slot = readSlot(slotFile(root, "director", loop));
      expect(declaresLoopBase(slot), loop).toBe(true);
      const base = resolveSlotBase(root, slot)!;
      // Read from the declared file: its bytes are the base the slot records.
      const bytes = readFileSync(join(installed, slot.base!.path));
      expect(base.meta, loop).toEqual({ ...slot.base, sha256: createHash("sha256").update(bytes).digest("hex") });
      expect(base.doc.contract, loop).toEqual(slot.contract);
    }
  }, LONG);

  it("resolves from the declared package only: a local packages/director is read, and its loop file judged", () => {
    const root = adoptedWorld();
    const local = localDirector(root);
    expect(directorFindings(runRecordsComputedMatch(root).findings)).toEqual([]);
    expect(directorFindings(runBriefTightenOnly(root).findings)).toEqual([]);
    // An edited declared base is read too: the recorded sha256 no longer matches it.
    const file = join(local, adoptedLoopBasePath("loop.create"));
    writeFileSync(file, readFileSync(file, "utf8").replace(/\n$/, "\n\n"));
    expect(directorFindings(runBriefTightenOnly(root).findings).map(finding => finding.subject)).toEqual(["director/loop.create"]);
    expect(directorFindings(runRecordsComputedMatch(root).findings)).toEqual([{ subject: "director/loop.create", detail: "computed field(s) base differ from what clossys ia sync writes" }]);
  }, LONG);

  it("fails when the declared base is missing, even with a catalog slot of the same id", () => {
    const root = adoptedWorld();
    const local = localDirector(root);
    rmSync(join(local, adoptedLoopBasePath("loop.create")));
    // A catalog base of the same id must not stand in for the declared one.
    mkdirSync(join(local, "src", "catalog", "slots", "loop.create"), { recursive: true });
    cpSync(slotFile(root, "director", "loop.create"), join(local, "src", "catalog", "slots", "loop.create", "slot.json"));
    const missing = [{ subject: "director/loop.create", detail: `declared base ${DECLARED} is missing` }];
    expect(directorFindings(runRecordsComputedMatch(root).findings)).toEqual(missing);
    expect(directorFindings(runBriefTightenOnly(root).findings)).toEqual(missing);
    // A declared path that names no file in the package is missing too.
    const slot = JSON.parse(readFileSync(slotFile(root, "director", "loop.scope"), "utf8"));
    slot.base.path = "loops/loop.scope/scope-v9.json";
    writeFileSync(slotFile(root, "director", "loop.scope"), `${JSON.stringify(slot, null, 2)}\n`);
    expect(directorFindings(runBriefTightenOnly(root).findings)).toEqual([
      ...missing, { subject: "director/loop.scope", detail: "declared base @clossys/director/loops/loop.scope/scope-v9.json is missing" },
    ]);
  }, LONG);

  it("fails when the declared base is unreadable: not JSON, or not this slot's package loop candidate", () => {
    const root = adoptedWorld();
    const local = localDirector(root);
    writeFileSync(join(local, adoptedLoopBasePath("loop.create")), "{ not json");
    cpSync(join(local, adoptedLoopBasePath("loop.slot")), join(local, adoptedLoopBasePath("loop.choose")));
    for (const run of [runRecordsComputedMatch, runBriefTightenOnly]) {
      const findings = directorFindings(run(root).findings);
      expect(findings.map(finding => finding.subject)).toEqual(["director/loop.choose", "director/loop.create"]);
      for (const finding of findings) expect(finding.detail).toMatch(/^declared base @clossys\/director\/loops\/loop\.(choose|create)\/(choose|create)-v1\.json is unreadable: /);
    }
  }, LONG);
});
