import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runUnitCli, type UnitDeps } from "./unit.js";
import { FILL, PACKET_SECTIONS } from "./unit-packet.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "../../../..");
const SKILL = join(REPO, "packages/planner/skill/SKILL.md");
const REGISTRY = join(REPO, "scripts/rules/registry.json");
const CLEAN = readFileSync(join(REPO, "packages/planner/test-fixtures/packet-schema/clean.md"), "utf8");

let dir: string;
const deps: UnitDeps = { now: () => new Date("2026-11-28T10:00:00.000Z"), remoteHead: () => null, baseOnRemote: () => true };
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "unit-packet-")); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const packet = (name: string, body: string) => { const path = join(dir, name); writeFileSync(path, body); return path; };
const unit = (...argv: string[]) => runUnitCli([...argv, "--root", dir, "--skill", SKILL, "--registry", REGISTRY], dir, deps);

describe("clossys unit lint", () => {
  it("accepts the schema example", async () => {
    const result = await unit("lint", packet("clean.md", CLEAN));
    expect(result.exitCode).toBe(0);
    expect(result.message).toMatch(/^ok {6}clean\.md$/m);
  });

  it("lint refuses a packet with no write set", async () => {
    const result = await unit("lint", packet("p.md", CLEAN.replace(/^- Write set:.*\n/m, "")));
    expect(result.exitCode).toBe(1);
    expect(result.message).toMatch(/^refused p\.md {2}R-UNIT-PACKET {2}missing write set/m);
    const empty = await unit("lint", packet("q.md", CLEAN.replace(/^- Write set:.*$/m, "- Write set: whatever the executor needs.")));
    expect(empty.exitCode).toBe(1);
    expect(empty.message).toContain("missing write set: `Write set:` lists no backticked path or glob");
  });

  it("lint refuses a malformed branch line", async () => {
    for (const bad of ["Branch: claude/ex-schema.", "Branch: `claude/ex-schema` or `claude/other`.", "Branch: `main`.", "Branch: `claude/ex schema`.", "Branch: `claude/a..b`."]) {
      const result = await unit("lint", packet("b.md", CLEAN.replace("Branch: `claude/ex-schema`.", bad)));
      expect(result.exitCode, bad).toBe(1);
      expect(result.message, bad).toContain("malformed branch line: Branch:");
    }
  });

  it("names every missing section and field", async () => {
    let body = CLEAN.replace(/^## Stop rule\n[^#]*/m, "").replace(/^- Depends on:.*\n/m, "");
    const result = await unit("lint", packet("m.md", body));
    expect(result.exitCode).toBe(1);
    expect(result.message).toContain("missing section: ## Stop rule");
    expect(result.message).toContain("missing field: Depends on:");
    body = CLEAN.replace("(mid, gate: no)", "(mid)");
    expect((await unit("lint", packet("h.md", body))).message).toContain("malformed H1");
    body = CLEAN.replace("- Tier: mid.", "- Tier: high.");
    expect((await unit("lint", packet("t.md", body))).message).toContain("Tier: high contradicts the H1 tier mid");
  });

  it("lints every packet in a directory and exits 1 when any is refused", async () => {
    packet("a.md", CLEAN);
    packet("b.md", CLEAN.replace(/^## Why\n[^#]*/m, ""));
    const result = await unit("lint", dir);
    expect(result.exitCode).toBe(1);
    expect(result.message).toMatch(/^ok {6}a\.md$/m);
    expect(result.message).toMatch(/^refused b\.md {2}R-UNIT-PACKET {2}missing section: ## Why/m);
    expect(result.message).toMatch(/unit lint: 2 packet\(s\), 1 refused$/);
  });
});

describe("clossys unit new", () => {
  it("new writes a skeleton that lints clean once filled", async () => {
    const made = await unit("new", "CP9-NEW", "--out", dir);
    expect(made.exitCode).toBe(0);
    const path = join(dir, "CP9-NEW.md");
    const skeleton = readFileSync(path, "utf8");
    for (const section of PACKET_SECTIONS) expect(skeleton).toContain(`## ${section}\n`);
    const unfilled = await unit("lint", path);
    expect(unfilled.exitCode).toBe(1);
    expect(unfilled.message).toContain("unfilled skeleton");
    const filled = skeleton
      .replace(/<<fill: one-line outcome>>/, "reword one line")
      .replace(/<<fill: owner\/name>>/, "clossys/foundry")
      .replace(/<<fill: `<base branch>` or a commit>>/, "`claude/r2f-int2`")
      .replace(/<<fill: the backticked paths or globs this unit may write>>/, "`packages/planner/README.md`")
      .replace(/<<fill: [^>]*>>/g, "none");
    expect(filled).not.toContain(FILL);
    writeFileSync(path, filled);
    const result = await unit("lint", path);
    expect(result.message).toMatch(/^ok {6}CP9-NEW\.md$/m);
    expect(result.exitCode).toBe(0);
  });

  it("never overwrites a packet", async () => {
    expect((await unit("new", "CP9-NEW", "--out", dir)).exitCode).toBe(0);
    const again = await unit("new", "CP9-NEW", "--out", dir);
    expect(again.exitCode).toBe(2);
    expect(again.message).toContain("never overwrites");
  });
});

describe("clossys unit brief", () => {
  it("brief for a blind role includes review rules and omits exec rules", async () => {
    const path = packet("clean.md", CLEAN);
    const blind = await unit("brief", path, "--role", "blind");
    expect(blind.exitCode).toBe(0);
    expect(blind.message).toMatch(/^# Brief: blind$/m);
    expect(blind.message).toContain("You are a blind reviewer for this unit.");
    expect(blind.message).toMatch(/^- R-REVIEW-MECHANICAL \(owner_agent: reviewer\)/m);
    expect(blind.message).toMatch(/^- R-CHECKS-WIRED \(owner_agent: reviewer\)/m);
    expect(blind.message).not.toContain("R-NO-HIDDEN-FALLBACKS");
    expect(blind.message).toContain("# EX-SCHEMA: reword the status probe's summary line (mid, gate: no)");
    const exec = await unit("brief", path, "--role", "exec");
    expect(exec.exitCode).toBe(0);
    expect(exec.message).toMatch(/^- R-NO-HIDDEN-FALLBACKS \(owner_agent: developer\)/m);
    expect(exec.message).not.toContain("R-REVIEW-MECHANICAL");
  });

  it("refuses to brief a packet that does not lint, and an unknown role", async () => {
    const refused = await unit("brief", packet("p.md", CLEAN.replace(/^- Write set:.*\n/m, "")), "--role", "exec");
    expect(refused.exitCode).toBe(1);
    expect(refused.message).toContain("R-UNIT-PACKET");
    expect(refused.message).toContain("missing write set");
    await expect(unit("brief", packet("c.md", CLEAN), "--role", "boss")).rejects.toThrow(/--role exec\|fix\|blind\|final\|delta/);
  });

  it("withholds local paths from the brief", async () => {
    const result = await unit("brief", packet("c.md", CLEAN.replace("- Weakening or skipping any existing check.", "- anything under ~/code/agents/")), "--role", "exec");
    expect(result.exitCode).toBe(0);
    expect(result.message).not.toContain("~/code/agents");
    expect(result.message).toContain("<local path withheld>");
  });
});
