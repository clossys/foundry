import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildMaterializedFixture } from "./apply-step-fixture.js";
import { discoveryLinkPath, skillPath } from "./change-set-contract.js";
import { materializeRepository, verifyRepository } from "./materialize.js";

const SITE_ID = "example-owner/site";
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

async function materialized() {
  const fixture = buildMaterializedFixture(roots);
  const outcome = await materializeRepository({
    clone: fixture.clone,
    hub: fixture.hub,
    set: fixture.set,
    texts: fixture.texts,
    binding: fixture.binding,
    heldChangeSets: [],
  });
  expect(outcome).toEqual({ exitCode: 0, verdict: "materialized" });
  return fixture;
}

describe("verifyRepository", () => {
  it("reports violations for tampered files, links, modes, ledger, undeclared paths, and dirty trees", async () => {
    let fixture = await materialized();
    const skill = skillPath("strategist");
    writeFileSync(join(fixture.clone, skill), "tampered\n");
    expect((await verifyRepository({ clone: fixture.clone, set: fixture.set, binding: fixture.binding })).exitCode).toBe(1);

    fixture = await materialized();
    const link = discoveryLinkPath(".claude/skills", "writer");
    unlinkSync(join(fixture.clone, link));
    symlinkSync("elsewhere", join(fixture.clone, link));
    expect((await verifyRepository({ clone: fixture.clone, set: fixture.set, binding: fixture.binding })).exitCode).toBe(1);

    fixture = await materialized();
    chmodSync(join(fixture.clone, skillPath("writer")), 0o755);
    expect((await verifyRepository({ clone: fixture.clone, set: fixture.set, binding: fixture.binding })).exitCode).toBe(1);

    fixture = await materialized();
    const ledger = join(fixture.clone, "clossys/.state/installed.json");
    const bytes = readFileSync(ledger);
    bytes[0] ^= 0xff;
    writeFileSync(ledger, bytes);
    expect((await verifyRepository({ clone: fixture.clone, set: fixture.set, binding: fixture.binding })).exitCode).toBe(1);

    fixture = await materialized();
    writeFileSync(join(fixture.clone, "README.md"), "# changed\n");
    const undeclared = await verifyRepository({ clone: fixture.clone, set: fixture.set, binding: fixture.binding });
    expect(undeclared).toMatchObject({ exitCode: 1, reason: "undeclared-path" });

    fixture = await materialized();
    writeFileSync(join(fixture.clone, "leftover.txt"), "x\n");
    expect((await verifyRepository({ clone: fixture.clone, set: fixture.set, binding: fixture.binding })).reason).toBe("dirty");

    fixture = await materialized();
    mkdirSync(join(fixture.clone, ".agents/skills/clossys-leftover"), { recursive: true });
    writeFileSync(join(fixture.clone, ".agents/skills/clossys-leftover/NOTE"), "x\n");
    const leftover = await verifyRepository({ clone: fixture.clone, set: fixture.set, binding: fixture.binding });
    expect(leftover).toMatchObject({ exitCode: 1, reason: "dirty" });
    expect(leftover.detail).toContain("left by an earlier run");
    expect(existsSync(join(fixture.clone, ".agents/skills/clossys-leftover/NOTE"))).toBe(true);
  });

  it("reports a missing clone as indeterminate", async () => {
    const fixture = buildMaterializedFixture(roots);
    const outcome = await verifyRepository({ clone: join(fixture.clone, "missing"), set: fixture.set, binding: fixture.binding });
    expect(outcome).toEqual({ exitCode: 2, verdict: "indeterminate", reason: "missing-clone" });
    const { verifyMain } = await import("./apply-plan-cli.js");
    expect(await verifyMain(["--repo", SITE_ID], { cwd: fixture.hub, clone: join(fixture.clone, "missing"), set: fixture.set, binding: fixture.binding })).toBe(2);
  });

  it("matches verifyMain exit codes for a violated tree", async () => {
    const fixture = await materialized();
    writeFileSync(join(fixture.clone, skillPath("strategist")), "tampered\n");
    const { verifyMain } = await import("./apply-plan-cli.js");
    const code = await verifyMain(["--repo", SITE_ID], { cwd: fixture.hub, clone: fixture.clone, set: fixture.set, binding: fixture.binding });
    expect(code).toBe(1);
  });
});
