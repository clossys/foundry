import { describe, expect, it } from "vitest";
import { readCauses } from "./causes.js";
import { DEFAULT_CAUSES } from "./cli.js";
import { heal } from "./heal.js";
import { REMEDIES, killOrphanGroups, type HealEnv, type ProcessRow, type Remedy } from "./remedies.js";
import { incidentRecord } from "./signature.js";
import type { RunResult } from "./types.js";

const causes = readCauses(DEFAULT_CAUSES).causes;
const NOW = () => new Date("2026-11-28T12:00:00Z");

interface Call { readonly kind: "run" | "base" | "kill"; readonly command: string; readonly cwd?: string; readonly env?: NodeJS.ProcessEnv }

/** A recording environment: every side effect is a call in `calls`; results come from the queues. */
function fakeEnv(results: { run?: RunResult[]; base?: RunResult[]; processes?: ProcessRow[] } = {}) {
  const calls: Call[] = [];
  const shared: NodeJS.ProcessEnv = { FAKE: "1" };
  const runs = [...(results.run ?? [])], bases = [...(results.base ?? [])];
  const env: HealEnv = {
    cwd: "/work/foundry", env: shared, base: "origin/claude/r2f-int2",
    run: async (command, options) => { calls.push({ kind: "run", command, cwd: options.cwd, env: options.env }); return runs.shift() ?? { exit: 0, output: "" }; },
    runOnBase: async (command, options) => { calls.push({ kind: "base", command, cwd: options.cwd, env: options.env }); return bases.shift() ?? { exit: 0, output: "" }; },
    processes: async () => results.processes ?? [],
    killGroup: async pgid => { calls.push({ kind: "kill", command: String(pgid) }); },
  };
  return { env, calls, shared };
}

const staleFold = incidentRecord({
  stage: "fold", command: "git merge-tree --write-tree claude/r2f-int2 claude/r2f-0048-cp1-heal", exit: 1,
  output: "refusing to fold: local claude/r2f-0048-cp1-heal 1a2b3c4d5 does not match origin 9e8d7c6b5", at: "2026-11-28T03:00:00Z",
});

describe("heal", () => {
  it("a known signature runs its remedy and re-runs the step", async () => {
    const { env, calls } = fakeEnv({ run: [{ exit: 0, output: "fetched" }, { exit: 0, output: "fetched" }, { exit: 0, output: "tree" }] });
    const result = await heal(staleFold, { causes, env, now: NOW });
    expect(result.cause?.id).toBe("stale-branch-ref");
    // The remedy fetches every compared branch, then the failed step re-runs exactly once.
    expect(calls.map(call => call.command)).toEqual([
      "git fetch origin claude/r2f-int2",
      "git fetch origin claude/r2f-0048-cp1-heal",
      staleFold.command,
    ]);
    expect(result.outcome).toBe("healed");
    expect(result.exit).toBe(0);
    expect(result.record).toMatchObject({ cause: "stale-branch-ref", outcome: "healed", remedy: "fetch-then-compare", rerun_exit: 0 });
    expect(result.lines.at(-1)).toMatch(/^HEALED stale-branch-ref: /);

    // The verdict is the re-run's: a remedy that ran is not a heal when the step still fails.
    const still = fakeEnv({ run: [{ exit: 0, output: "" }, { exit: 0, output: "" }, { exit: 1, output: "conflict" }] });
    const failing = await heal(staleFold, { causes, env: still.env, now: NOW });
    expect(still.calls.filter(call => call.command === staleFold.command)).toHaveLength(1);
    expect(failing.outcome).toBe("still-failing");
    expect(failing.exit).toBe(1);
    expect(failing.record.rerun_exit).toBe(1);
    expect(failing.lines.at(-1)).toMatch(/^STILL-FAILING stale-branch-ref owner=planner: /);
  });

  it("an unknown signature prints NEW-CAUSE and no remedy runs", async () => {
    let remedied = 0;
    const counting: Record<string, Remedy> = Object.fromEntries(Object.entries(REMEDIES).map(([name, remedy]) => [name, async (record, env) => { remedied++; return remedy(record, env); }]));
    const { env, calls } = fakeEnv();
    const record = incidentRecord({ stage: "build", command: "npm run build -w @clossys/writer", exit: 2, output: "error TS2307: Cannot find module '@clossys/kit' at /tmp/x/src/a.ts:12:3", at: "2026-11-28T04:00:00Z" });
    const result = await heal(record, { causes, env, remedies: counting, now: NOW });
    expect(result.outcome).toBe("new-cause");
    expect(result.exit).toBe(1);
    expect(result.lines).toEqual(["NEW-CAUSE error TS2307: Cannot find module '@clossys/kit' at <path>"]);
    expect(remedied).toBe(0);
    expect(calls).toEqual([]);
    expect(result.record).toMatchObject({ cause: null, outcome: "new-cause", remedy: null, rerun_exit: null });
  });

  it("a known cause with no remedy prints its owner and blocker and runs nothing", async () => {
    const { env, calls } = fakeEnv();
    const record = incidentRecord({ stage: "validate", command: "npm run test -w @clossys/designer", exit: 1, output: "packet lint: `npm run test -w @clossys/designer` has two expectations (exit 0 and same exit as base)" });
    const result = await heal(record, { causes, env, now: NOW });
    expect(result.outcome).toBe("blocked");
    expect(result.lines[0]).toMatch(/^BLOCKED contradictory-packet owner=planner \(no remedy\): the packet states two expectations/);
    expect(calls).toEqual([]);
  });

  it("base-relative root check compares in one environment", async () => {
    const record = incidentRecord({ stage: "accept", command: "npm run check", exit: 1, output: "FAIL npm run check: head exit 1 (required exit 0)" });
    const same = fakeEnv({ run: [{ exit: 1, output: "red" }], base: [{ exit: 1, output: "red" }] });
    const healed = await heal(record, { causes, env: same.env, now: NOW });
    expect(healed.cause?.id).toBe("fixed-exit-root-check");
    const [head, base] = same.calls;
    expect(head).toMatchObject({ kind: "run", command: "npm run check" });
    expect(base).toMatchObject({ kind: "base", command: "npm run check" });
    // One environment: the very same env object and directory for the head and the base.
    expect(base!.env).toBe(head!.env);
    expect(head!.env).toBe(same.shared);
    expect(base!.cwd).toBe(head!.cwd);
    expect(healed.outcome).toBe("healed");
    expect(healed.record).toMatchObject({ rerun_exit: 1, base_exit: 1 });
    expect(healed.lines.at(-1)).toMatch(/same exit as base origin\/claude\/r2f-int2 in the same environment/);

    // A head that is red where the base is green is a new red, never healed.
    const worse = fakeEnv({ run: [{ exit: 1, output: "red" }], base: [{ exit: 0, output: "" }] });
    const failing = await heal(record, { causes, env: worse.env, now: NOW });
    expect(failing.outcome).toBe("still-failing");
    expect(failing.record).toMatchObject({ rerun_exit: 1, base_exit: 0 });
  });

  it("a load-noise timeout is re-run alone, then compared with the base", async () => {
    const record = incidentRecord({ stage: "test", command: "npm run test -w @clossys/producer", exit: 1, output: "Error: Test timed out in 5000ms." });
    const alonePasses = fakeEnv({ run: [{ exit: 0, output: "" }] });
    const noise = await heal(record, { causes, env: alonePasses.env, now: NOW });
    expect(noise.cause?.id).toBe("load-noise-timeout");
    expect(noise.outcome).toBe("healed");
    expect(alonePasses.calls.map(call => call.kind)).toEqual(["run"]);

    const real = fakeEnv({ run: [{ exit: 1, output: "" }], base: [{ exit: 0, output: "" }] });
    const red = await heal(record, { causes, env: real.env, now: NOW });
    expect(real.calls.map(call => call.kind)).toEqual(["run", "base"]);
    expect(red.outcome).toBe("still-failing");
  });

  it("kill-orphan-groups ends only orphaned test runners of this checkout, never its own group", async () => {
    const rows: ProcessRow[] = [
      { pid: process.pid, ppid: 10, pgid: 500, args: "node heal" },
      { pid: 41, ppid: 1, pgid: 41, args: "node /work/foundry/node_modules/vitest/vitest.mjs run" },
      { pid: 42, ppid: 41, pgid: 41, args: "node /work/foundry/packages/x/child.js" },
      { pid: 51, ppid: 1, pgid: 51, args: "node /elsewhere/node_modules/vitest/vitest.mjs run" },
      { pid: 61, ppid: 1, pgid: 61, args: "node /work/foundry/scripts/server.mjs" },
      { pid: 71, ppid: 1, pgid: 500, args: "node /work/foundry/node_modules/vitest/vitest.mjs run" },
    ];
    const { env, calls } = fakeEnv({ processes: rows });
    const result = await killOrphanGroups(staleFold, env);
    expect(calls).toEqual([{ kind: "kill", command: "41" }]);
    expect(result.note).toBe("ended 1 orphaned test process group(s)");
  });
});
