import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runUnitCli, GIT_DEPS } from "./unit.js";
import type { NextGit } from "./unit-next.js";

const TIP = "a".repeat(40), OLD_TIP = "b".repeat(40), HEAD = "c".repeat(40), NEW_HEAD = "d".repeat(40);
const FIXTURES = resolve(dirname(fileURLToPath(import.meta.url)), "../../../planner/test-fixtures/unit-records");

let dir: string;
let refs: Map<string, string>;
let ancestors: Set<string>;
const fakeGit: NextGit = {
  resolve: (_root, ref) => refs.get(ref) ?? null,
  isAncestor: (_root, ancestor, descendant) => ancestor === descendant || ancestors.has(`${ancestor}>${descendant}`),
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "unit-next-"));
  mkdirSync(join(dir, "node_modules"), { recursive: true });
  writeFileSync(join(dir, "node_modules", ".package-lock.json"), "{}");
  refs = new Map([["origin/claude/int", TIP], ["refs/remotes/origin/claude/cp9-x", HEAD]]);
  ancestors = new Set([`${TIP}>${HEAD}`]);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const write = (unit: string, name: string, text: string) => { mkdirSync(join(dir, "units", unit), { recursive: true }); writeFileSync(join(dir, "units", unit, name), text); };
const next = (unit: string, ...argv: string[]) =>
  runUnitCli(["next", unit, "--root", dir, "--records", join(dir, "units"), "--integration", "origin/claude/int", "--state", join(dir, "loop.json"), ...argv], dir, GIT_DEPS, fakeGit);
const fastJson = (head: string, base: string) => JSON.stringify({ schema: "clossys.fast-check/1", verdict: "FAST PASS", head, base });

describe("clossys unit next", () => {
  it("prints the state, the next step and one NEXT verdict line, read from the records and git", async () => {
    write("cp9-x", "exec.md", `# receipt\nDONE: ${HEAD}\nmodel: fixture\n`);
    const result = await next("cp9-x", "--branch", "claude/cp9-x");
    expect(result.exitCode).toBe(0);
    expect(result.message).toContain("state: fast-due");
    expect(result.message.split("\n").at(-1)).toBe(`NEXT: cp9-x fast-due fast ${HEAD} OK`);
  });

  it("next refuses mech when the base is not the integration tip (exit 1, named)", async () => {
    write("cp9-x", "exec.md", `DONE: ${HEAD}\n`);
    write("cp9-x", "fast.json", fastJson(HEAD, OLD_TIP));
    ancestors.clear();
    const result = await next("cp9-x", "--branch", "claude/cp9-x", "--step", "mech");
    expect(result.exitCode).toBe(1);
    expect(result.message).toMatch(/^refused base-not-tip R-UNIT-STEP-ORDER/m);
    expect(result.message.split("\n").at(-1)).toBe(`NEXT: cp9-x rebase-due rebase ${HEAD} mech REFUSED base-not-tip`);
  });

  it("--head refuses a step planned on a head that has since moved", async () => {
    write("cp9-x", "exec.md", `DONE: ${HEAD}\n`);
    const result = await next("cp9-x", "--branch", "claude/cp9-x", "--step", "fast", "--head", NEW_HEAD.slice(0, 12));
    expect(result.exitCode).toBe(1);
    expect(result.message).toMatch(/^refused head-changed /m);
  });

  it("a head change marks queued checks superseded in checks.json, and --dry-run writes nothing", async () => {
    write("cp9-x", "exec.md", `DONE: ${HEAD}\n`);
    const checks = [{ id: "fast-1", step: "fast", head: OLD_TIP, status: "queued" }, { id: "fast-2", step: "fast", head: HEAD, status: "running" }];
    write("cp9-x", "checks.json", JSON.stringify(checks));
    const dry = await next("cp9-x", "--branch", "claude/cp9-x", "--dry-run");
    expect(dry.message).toContain("superseded: fast-1 (fast at " + OLD_TIP + ") (dry run: not written)");
    expect(dry.message).toContain("live checks: 1");
    expect(JSON.parse(readFileSync(join(dir, "units", "cp9-x", "checks.json"), "utf8"))).toEqual(checks);
    await next("cp9-x", "--branch", "claude/cp9-x");
    expect(JSON.parse(readFileSync(join(dir, "units", "cp9-x", "checks.json"), "utf8")).map((check: { status: string }) => check.status)).toEqual(["superseded", "running"]);
  });

  it("counts the other units past exec and not folded against the WIP cap from config.json", async () => {
    mkdirSync(join(dir, "units"), { recursive: true });
    writeFileSync(join(dir, "units", "config.json"), JSON.stringify({ wipCap: 1, integration: "origin/claude/int" }));
    write("cp9-x", "exec.md", `DONE: ${HEAD}\n`);
    const pulled = await runUnitCli(["next", "cp9-new", "--root", dir, "--records", join(dir, "units"), "--state", join(dir, "loop.json"), "--branch", "claude/none"], dir, GIT_DEPS, {
      ...fakeGit, resolve: (root, ref) => (ref === "origin/claude/int" ? TIP : ref.endsWith("claude/none") ? null : fakeGit.resolve(root, ref)),
    });
    // cp9-x has no launch and no branch recorded, so its head is unknown: it is past exec (DONE) and not folded.
    expect(pulled.exitCode).toBe(1);
    expect(pulled.message).toMatch(/^refused wip-cap R-UNIT-WIP/m);
    expect(pulled.message).toContain("wip: 1 other unit(s) past exec and not folded, cap 1");
  });

  it("refuses a usage error and an unknown step with exit 2 messages", async () => {
    await expect(next("cp9-x", "--step", "deploy")).rejects.toThrow(/--step must be one of/);
    await expect(next("../x")).rejects.toThrow(/is not a unit id/);
    const missing = await runUnitCli(["next", "cp9-x", "--root", dir, "--records", join(dir, "units"), "--state", join(dir, "loop.json")], dir, GIT_DEPS, fakeGit);
    expect(missing.exitCode).toBe(2);
    expect(missing.message).toMatch(/no integration ref/);
  });

  it("the rule fixtures: the legal unit passes, a violation of each rule is refused", async () => {
    const run = (unit: string, step: string, root: string) =>
      runUnitCli(["next", unit, "--records", root, "--facts", join(root, "facts.json"), "--step", step, "--dry-run", "--root", dir, "--state", join(dir, "loop.json")], dir, GIT_DEPS, fakeGit);
    expect((await run("cp9-ready", "fold", FIXTURES)).exitCode).toBe(0);
    const order = await run("cp9-stale-base", "mech", resolve(FIXTURES, "../../../../scripts/rules/fixtures/R-UNIT-STEP-ORDER"));
    expect(order.exitCode).toBe(1);
    expect(order.message).toMatch(/^refused base-not-tip R-UNIT-STEP-ORDER/m);
    const wip = await run("cp9-new", "exec", resolve(FIXTURES, "../../../../scripts/rules/fixtures/R-UNIT-WIP"));
    expect(wip.exitCode).toBe(1);
    expect(wip.message).toMatch(/^refused wip-cap R-UNIT-WIP/m);
  });
});
