import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runUnitCli, UNIT_USAGE, type UnitDeps } from "./unit.js";
import { PREFLIGHT_HEADING } from "./unit-rules.js";

const SKILL = resolve(dirname(fileURLToPath(import.meta.url)), "../../../planner/skill/SKILL.md");
const START = new Date("2026-11-28T10:00:00.000Z");

let dir: string;
let clock: Date;
let heads: Map<string, string>;
let remote: boolean | null;
const deps: UnitDeps = { now: () => clock, remoteHead: (_root, branch) => heads.get(branch) ?? null, baseOnRemote: () => remote };

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "unit-cli-"));
  clock = START;
  heads = new Map();
  remote = true;
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const packet = (name: string, body: string) => { const path = join(dir, name); writeFileSync(path, body); return path; };
const unit = (...argv: string[]) => runUnitCli([...argv, "--root", dir, "--skill", SKILL, "--state", join(dir, "loop.json")], dir, deps);

/** A self-contained foundry packet: every path it writes is inside the repository. */
const SELF_CONTAINED = [
  "# CP9-EXAMPLE: rename the status probe's summary line (mid)",
  "",
  "## Repository and base",
  "- Repository: clossys/foundry (public). Base: `claude/r2f-int2`. Branch: `claude/cp9-example`.",
  "- Env: cloud.",
  "",
  "## Objective",
  "- Reword the summary line in `packages/planner/src/owned-rules.ts`.",
  "- Update its README sentence in `packages/planner/README.md`.",
  "",
  "## Validation",
  "- `npm run typecheck -w @clossys/planner` exits 0.",
  "",
  "## Forbidden",
  "- anything under ~/code/agents/ (the planner's machine)",
  "",
].join("\n");

describe("clossys unit env", () => {
  it("env is cloud for a self-contained foundry packet", async () => {
    const result = await unit("env", packet("cp9.md", SELF_CONTAINED));
    expect(result.exitCode).toBe(0);
    expect(result.message).toMatch(/^env: cloud \(cloud by default: no local need detected\)$/);
  });

  it("env refuses local with no detected need", async () => {
    const result = await unit("env", packet("cp9.md", SELF_CONTAINED.replace("- Env: cloud.", "- Env: local (faster on my machine)")));
    expect(result.exitCode).toBe(1);
    expect(result.message).toContain("R-UNIT-ENV");
    expect(result.message).toContain("no local need is detected");
  });

  it("env is local when the write set leaves the repo", async () => {
    const result = await unit("env", packet("cp9.md", SELF_CONTAINED.replace("- Env: cloud.", "- Env: local (writes the planner's notes)")
      .replace("- Update its README sentence in `packages/planner/README.md`.", "- Append the run to `~/notes/runs.md`.")));
    expect(result.exitCode).toBe(0);
    expect(result.message).toMatch(/^env: local \(the write set names a path outside the repository \(~\/notes\/runs\.md\)\)/);
  });

  it("is local for the fold gate, a base not on the remote, and two failed cloud launches", async () => {
    expect((await unit("env", packet("a.md", SELF_CONTAINED.replace("- Env: cloud.", "- Step: fold")))).message).toContain("the step is the fold gate");
    remote = false;
    expect((await unit("env", packet("b.md", SELF_CONTAINED))).message).toMatch(/^env: local \(the base claude\/r2f-int2 is not on the remote/);
    remote = true;
    const path = packet("c.md", SELF_CONTAINED);
    for (const reason of ["preflight push refused", "proxy cut the clone"]) {
      expect((await unit("run", path)).exitCode).toBe(0);
      expect((await unit("run", path, "--mark-failed", reason)).exitCode).toBe(0);
    }
    expect((await unit("env", path)).message).toContain("the launch log shows 2 failed cloud launches");
  });

  it("refuses a packet with neither an Env field nor an Objective for the rule to fill it in", async () => {
    const result = await unit("env", packet("bare.md", "# CP9-BARE: nothing to read (mid)\n\n## Why\n- because\n"));
    expect(result.exitCode).toBe(1);
    expect(result.message).toContain("no Env: field and no Objective");
  });
});

describe("clossys unit tier", () => {
  it("tier refuses a packet below the computed floor", async () => {
    const gate = SELF_CONTAINED.replace("(mid)", "(low)").replace("- Reword the summary line", "- Add a refusal to the scanner, and reword the summary line");
    const result = await unit("tier", packet("gate.md", gate));
    expect(result.exitCode).toBe(1);
    expect(result.message).toContain("R-UNIT-TIER");
    expect(result.message).toContain("Tier: low is below the computed floor high");
  });

  it("is high for Gate: YES, low for one behaviour in at most three files with a named failing test, mid otherwise", async () => {
    expect((await unit("tier", packet("g.md", SELF_CONTAINED.replace("(mid)", "").replace("- Env: cloud.", "- Gate: YES.")))).message).toMatch(/^tier: high \(floor high/);
    const low = SELF_CONTAINED.replace("(mid)", "").replace("- Update its README sentence in `packages/planner/README.md`.\n", "")
      .replace("- `npm run typecheck", "- \"names the summary\" fails before the fix.\n- `npm run typecheck");
    expect((await unit("tier", packet("l.md", low))).message).toMatch(/^tier: low \(floor low/);
    expect((await unit("tier", packet("m.md", SELF_CONTAINED))).message).toMatch(/^tier: mid \(floor mid/);
  });
});

describe("clossys unit run", () => {
  it("run cloud dry-run prints a self-sufficient prompt with preflight and no local paths", async () => {
    const result = await unit("run", packet("cp9.md", SELF_CONTAINED), "--dry-run");
    expect(result.exitCode).toBe(0);
    const message = result.message;
    expect(message).toContain(PREFLIGHT_HEADING);
    expect(message).toContain("`git push --dry-run origin HEAD:refs/heads/claude/cp9-example` ok");
    expect(message).toContain("NO-LOCAL-FILES:");
    expect(message).toContain("push claude/cp9-example-report holding one REPORT.md");
    expect(message).toContain("## Packet");
    expect(message).toContain("# CP9-EXAMPLE: rename the status probe's summary line (mid)");
    expect(message).toMatch(/^command: claude --cloud "\$\(cat '.*CP9-EXAMPLE\.cloud-prompt\.md'\)"$/m);
    const prompt = message.slice(message.indexOf("--- prompt"), message.indexOf("--- end prompt ---"));
    expect(prompt).not.toMatch(/~\/|\/home\/|\/Users\/|[A-Za-z]:\\/);
    expect(prompt).not.toContain(dir);
    expect(existsSync(join(dir, "CP9-EXAMPLE.cloud-prompt.md"))).toBe(false);
    expect(existsSync(join(dir, "loop.json"))).toBe(false);
  });

  it("local prints the wt lease command and the tier profile", async () => {
    const result = await unit("run", packet("cp9.md", SELF_CONTAINED.replace("- Env: cloud.", "- Step: fold")), "--dry-run");
    expect(result.exitCode).toBe(0);
    expect(result.message).toContain("command: wt lease claude/cp9-example --base claude/r2f-int2 --profile program-mid");
    expect(result.message).toContain("profile: program-mid");
  });

  it("records the launch with unit, env, tier and time, and writes the prompt", async () => {
    const result = await unit("run", packet("cp9.md", SELF_CONTAINED));
    expect(result.exitCode).toBe(0);
    const state = JSON.parse(readFileSync(join(dir, "loop.json"), "utf8"));
    expect(state.units["CP9-EXAMPLE"]).toEqual([{ unit: "CP9-EXAMPLE", env: "cloud", tier: "mid", at: START.toISOString(), branch: "claude/cp9-example", headAtLaunch: null, status: "launched" }]);
    expect(readFileSync(join(dir, "CP9-EXAMPLE.cloud-prompt.md"), "utf8")).toContain(PREFLIGHT_HEADING);
  });

  it("run flags a launch with no progress after 90 min as stale", async () => {
    const path = packet("cp9.md", SELF_CONTAINED);
    const other = packet("cp8.md", SELF_CONTAINED.replace("CP9-EXAMPLE", "CP8-OTHER").replace("claude/cp9-example", "claude/cp8-other"));
    expect((await unit("run", path)).exitCode).toBe(0);
    expect((await unit("run", other)).exitCode).toBe(0);
    heads.set("claude/cp8-other", "abc1234");
    clock = new Date(START.getTime() + 89 * 60_000);
    expect((await unit("run", path, "--dry-run")).message).not.toContain("stale:");
    clock = new Date(START.getTime() + 90 * 60_000);
    const result = await unit("run", path, "--dry-run");
    expect(result.message).toContain("stale: CP9-EXAMPLE launched 2026-11-28T10:00:00.000Z on cloud (mid); no progress pushed to claude/cp9-example in 90 minutes");
    expect(result.message).not.toContain("stale: CP8-OTHER");
    await unit("run", other);
    const state = JSON.parse(readFileSync(join(dir, "loop.json"), "utf8"));
    expect(state.units["CP9-EXAMPLE"][0].status).toBe("stale");
    expect(state.units["CP8-OTHER"][0].status).toBe("progressed");
  });
});

describe("clossys unit help and check", () => {
  it("documents env, tier and run", async () => {
    const result = await runUnitCli(["--help"], dir, deps);
    expect(result.exitCode).toBe(0);
    for (const verb of ["env", "tier", "run", "check"]) expect(result.message).toMatch(new RegExp(`^\\s+${verb}\\s`, "m"));
    expect(result.message).toBe(UNIT_USAGE);
  });

  it("checks a directory of packets and names each refusal", async () => {
    packet("good.md", SELF_CONTAINED);
    packet("bad.md", SELF_CONTAINED.replace("CP9-EXAMPLE", "CP9-BAD").replace("- Env: cloud.", "- Env: local (habit)"));
    const result = await unit("check", dir);
    expect(result.exitCode).toBe(1);
    expect(result.message).toMatch(/^refused bad\.md {2}R-UNIT-ENV {2}/m);
    expect(result.message).toMatch(/^ok {6}good\.md {2}cloud {2}mid$/m);
  });
});
