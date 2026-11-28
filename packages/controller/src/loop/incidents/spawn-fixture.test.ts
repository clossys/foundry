import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_SPAWNER, PACKAGE_ROOT } from "./cli.js";
import { probeSpawner } from "./guards.js";
import { groupAlive, processAlive, spawnFixture } from "./spawn-fixture.js";

const PARENT = [
  "const { spawn } = require('node:child_process');",
  "const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], { stdio: 'ignore' });",
  "process.stdout.write(child.pid + '\\n');",
  "setTimeout(() => {}, 30000);",
].join("\n");

describe("spawnFixture", () => {
  it("fixture spawner leaves no child after teardown", async () => {
    const fixture = spawnFixture(process.execPath, ["-e", PARENT]);
    const grandchild = await new Promise<number>(accept => fixture.child.stdout!.once("data", chunk => accept(Number(String(chunk).trim()))));
    expect(processAlive(grandchild)).toBe(true);
    // The test is the killed run: its parent goes, and the child the parent started must go with it.
    await fixture.teardown(300);
    expect(processAlive(fixture.pid)).toBe(false);
    expect(processAlive(grandchild)).toBe(false);
    expect(groupAlive(fixture.pid)).toBe(false);

    // The guard probes the shipped spawner the same way, and catches one that ends only the parent.
    expect(await probeSpawner(DEFAULT_SPAWNER)).toEqual([]);
    const bad = await probeSpawner(resolve(PACKAGE_ROOT, "../../scripts/rules/fixtures/R-FIXTURE-NO-ORPHAN/bad-spawner.mjs"), { label: "bad-spawner.mjs" });
    expect(bad).toEqual([{ guard: "R-FIXTURE-NO-ORPHAN", message: "a child of the fixture survived teardown: bad-spawner.mjs ends the parent, not its process group" }]);
  });
});
