/** B10 (foundry-build-0013 fix r1): the published package carries the loop versions `clossys run` reads. */
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { PRODUCER_ROOT } from "../package-path.js";

describe("@clossys/producer package files", () => {
  it("B10: npm pack includes loops/<loop>/<name>-v1.json for all six loops", () => {
    const out = execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], { cwd: PRODUCER_ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    const files = (JSON.parse(out) as { files: { path: string }[] }[])[0]!.files.map(file => file.path);
    for (const loop of ["fill", "refine", "create", "choose", "release", "audit"]) expect(files, loop).toContain(`loops/loop.${loop}/${loop}-v1.json`);
  }, 60_000);
});

describe("content agent package files (foundry-build-0048 U9a)", () => {
  it("npm pack of each content agent includes its five own loop candidates", async () => {
    const { resolveAgent } = await import("../agents.js");
    for (const agent of ["director", "designer", "writer", "publisher"] as const) {
      const out = execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], { cwd: resolveAgent(agent).packageRoot, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
      const files = (JSON.parse(out) as { files: { path: string }[] }[])[0]!.files.map(file => file.path);
      for (const loop of ["scope", "slot", "create", "choose", "cascade"]) expect(files, `${agent} ${loop}`).toContain(`loops/loop.${loop}/${loop}-v1.json`);
    }
  }, 240_000);
});
