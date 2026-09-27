import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, readFileSync, readlinkSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildMaterializedFixture } from "./apply-step-fixture.js";
import { CHANGE_SET_STORE_REL, storeChangeSet } from "./apply-store.js";
import { skillPath } from "./change-set-contract.js";
import { renderInstalledLedger } from "./ledger-contract.js";
import { materializeRepository } from "./materialize.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("materializeRepository", () => {
  it("writes the change set into a clean clone and stores it in the hub", async () => {
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

    for (const file of fixture.set.files) {
      if ("derived" in file || file.after === null) continue;
      const path = join(fixture.clone, file.path);
      if (file.mode === "120000") {
        expect(readlinkSync(path)).toBe(fixture.texts[file.path]);
      } else {
        expect(readFileSync(path)).toEqual(Buffer.from(fixture.texts[file.path]!, "utf8"));
      }
    }

    const ledgerExpected = renderInstalledLedger(null, fixture.set, fixture.binding, fixture.planPackages);
    expect(readFileSync(join(fixture.clone, "clossys/.state/installed.json"))).toEqual(Buffer.from(ledgerExpected, "utf8"));

    const digest = fixture.set.changeSetDigest.slice("sha256:".length);
    expect(existsSync(join(fixture.hub, CHANGE_SET_STORE_REL, `${digest}.json`))).toBe(true);
  });

  it("does not rewrite when the branch already exists, and reports diverged after a tamper", async () => {
    const fixture = buildMaterializedFixture(roots);
    const input = {
      clone: fixture.clone,
      hub: fixture.hub,
      set: fixture.set,
      texts: fixture.texts,
      binding: fixture.binding,
      heldChangeSets: [],
    };
    expect((await materializeRepository(input)).exitCode).toBe(0);
    expect(await materializeRepository(input)).toEqual({ exitCode: 0, verdict: "materialized" });

    const skill = skillPath("strategist");
    writeFileSync(join(fixture.clone, skill), "tampered\n");
    const diverged = await materializeRepository(input);
    expect(diverged.exitCode).toBe(1);
    expect(diverged.reason).toBe("diverged");
    expect(readFileSync(join(fixture.clone, skill), "utf8")).toBe("tampered\n");
  });

  it("writes whole files from texts on the stored change set without a separate texts map", async () => {
    const fixture = buildMaterializedFixture(roots);
    const stored = {
      ...fixture.set,
      texts: Object.entries(fixture.texts)
        .map(([path, text]) => ({ path, text }))
        .sort((left, right) => left.path.localeCompare(right.path)),
    };
    storeChangeSet(fixture.hub, stored);
    const outcome = await materializeRepository({
      clone: fixture.clone,
      hub: fixture.hub,
      set: stored,
      texts: {},
      binding: fixture.binding,
      heldChangeSets: [],
    });
    expect(outcome).toEqual({ exitCode: 0, verdict: "materialized" });
    const briefPath = stored.files.find((file) => file.path === "clossys/brief.json");
    if (briefPath !== undefined && "derived" in briefPath) throw new Error("unexpected derived brief");
    const briefFile = stored.files.find((file) => file.path === "clossys/brief.json" && !("derived" in file));
    if (briefFile !== undefined && briefFile.after !== null) {
      expect(readFileSync(join(fixture.clone, "clossys/brief.json"), "utf8")).toBe(
        stored.texts!.find((row) => row.path === "clossys/brief.json")!.text,
      );
    }
  });

  it("does not create the apply branch or write when git status fails", async () => {
    const fixture = buildMaterializedFixture(roots);
    writeFileSync(join(fixture.clone, "dirty.txt"), "x\n");
    const index = join(fixture.clone, ".git/index");
    chmodSync(index, 0o000);
    const branch = fixture.set.branch;
    let outcome;
    try {
      outcome = await materializeRepository({
        clone: fixture.clone,
        hub: fixture.hub,
        set: fixture.set,
        texts: fixture.texts,
        binding: fixture.binding,
        heldChangeSets: [],
      });
    } finally {
      chmodSync(index, 0o644);
    }
    expect(outcome).toEqual({ exitCode: 2, verdict: "indeterminate", reason: "remote-tip-unreadable" });
    expect(
      spawnSync("git", ["-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", "show-ref", "--verify", `refs/heads/${branch}`], {
        cwd: fixture.clone,
        stdio: "ignore",
      }).status,
    ).not.toBe(0);
    expect(existsSync(join(fixture.hub, CHANGE_SET_STORE_REL))).toBe(false);
  });
});
