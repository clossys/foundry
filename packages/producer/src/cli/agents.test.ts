/**
 * CP1-AGENTLADDER: `clossys agents check` computes every agent's rung with the checkout's real rung checks against a
 * tmp agents.json world, fails on a rung that fell or a list need that does not hold, and files one report per failing
 * agent into a tmp copy of the consumer fixture, never a second while one is open. Nothing outside the tmp dirs is written.
 */
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { listReports } from "../records/report.js";
import { AGENT_LADDER, AGENT_RUNGS, AGENT_RUNGS_BY_PACKAGE } from "../agent-rungs.generated.js";
import { AGENT_LISTS } from "../agent-lists.generated.js";
import { installedRungsLine, installNeedLine } from "../agent-readiness.js";
import { runAgentsCli } from "./agents.js";

vi.setConfig({ testTimeout: 60_000 });

const FIXTURE = fileURLToPath(new URL("../../test-fixtures/consumer/", import.meta.url));
const AT = "2026-11-27T10:00:00Z";
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

const tmp = (name: string) => { const root = realpathSync(mkdtempSync(join(tmpdir(), name))); roots.push(root); return root; };

/** A repository world: ghost's row (in the install list when `installed`), and a rungs file that held ghost at `prior`. */
function repoWorld(prior: string | null, installed: boolean) {
  const repo = tmp("agents-check-repo-");
  mkdirSync(join(repo, "docs/contracts"), { recursive: true });
  const ladder = { description: "rungs", rungs: AGENT_LADDER.map(id => ({ id, check: `check:${id}`, means: id })), needs: [{ list: "install", rung: "packed", description: "installed" }] };
  const lists = { install: { description: "installed", members: installed ? ["ghost"] : ["nobody"] } };
  writeFileSync(join(repo, "docs/contracts/agents.json"), JSON.stringify({ schemaVersion: 2, agents: [{ id: "ghost", package: "@clossys/ghost", class: "other", definitionOwner: "controller" }], ladder, lists }));
  writeFileSync(join(repo, "docs/contracts/agents.rungs.json"), JSON.stringify({ schemaVersion: 1, ladder: AGENT_LADDER, needs: {}, agents: [{ id: "ghost", package: "@clossys/ghost", rung: prior, next: null, missing: [] }] }));
  return repo;
}
function workspace() {
  const root = tmp("agents-check-ws-");
  cpSync(FIXTURE, root, { recursive: true });
  return root;
}
const check = (repo: string, ...more: string[]) => runAgentsCli(["check", "--repo", repo, ...more, "--at", AT], repo);
const reportsAbout = (root: string, id: string) => listReports(join(root, "clossys")).filter(read => read.report?.about === `agent/${id}`);

describe("clossys agents check", () => {
  it("a rung regression fails agents check and files one request to the owner", async () => {
    // ghost was held at conforming; its declared check cannot pass in this world, so its rung falls to none.
    const repo = repoWorld("conforming", false), root = workspace();
    const first = await check(repo, "--file-requests", "--root", root);
    expect(first.exitCode).toBe(1);
    expect(first.message).toMatch(/^fall ghost: conforming -> none \(owner ghost\); missing at declared: /m);
    expect(first.message).toMatch(/^filed 1 request\(s\): ghost; 0 already open$/m);
    const filed = reportsAbout(root, "ghost");
    expect(filed).toHaveLength(1);
    expect(filed[0]!.report).toMatchObject({ what: "bug", status: "open", source: "check", createdBy: { cli: "clossys agents check" } });
    expect(filed[0]!.report!.why).toMatch(/fall ghost: conforming -> none/);
    // The rungs file now holds the fallen rung: nothing falls again, and nothing more is filed.
    const rungs = JSON.parse(readFileSync(join(repo, "docs/contracts/agents.rungs.json"), "utf8"));
    expect(rungs.agents[0]).toMatchObject({ id: "ghost", rung: null, next: "declared" });
    const second = await check(repo, "--file-requests", "--root", root);
    expect(second.exitCode).toBe(0);
    expect(reportsAbout(root, "ghost")).toHaveLength(1);
  });

  it("an install agent below packed fails every run; --file-requests files N, then 0", async () => {
    const repo = repoWorld(null, true), root = workspace();
    const first = await check(repo, "--file-requests", "--root", root);
    expect(first.exitCode).toBe(1);
    expect(first.message).toMatch(/^shortfall ghost: at none; install needs packed \(owner ghost\); missing at declared: /m);
    expect(first.message).toMatch(/^install list \(.*\): ghost$/m);
    expect(first.message).toMatch(/^computed at packed or higher: none$/m);
    expect(first.message).toMatch(/^filed 1 request\(s\): ghost; 0 already open$/m);
    const second = await check(repo, "--file-requests", "--root", root);
    expect(second.exitCode).toBe(1);
    expect(second.message).toMatch(/^filed 0 request\(s\); 1 already open: ghost$/m);
    expect(reportsAbout(root, "ghost")).toHaveLength(1);
    expect(reportsAbout(root, "ghost")[0]!.report!.what).toBe("gap");
  });

  it("--dry writes no rungs file, and a repository without agents.json is refused", async () => {
    const repo = repoWorld("conforming", false);
    const dry = await check(repo, "--dry");
    expect(dry.exitCode).toBe(1);
    expect(JSON.parse(readFileSync(join(repo, "docs/contracts/agents.rungs.json"), "utf8")).agents[0].rung).toBe("conforming");
    expect((await check(tmp("agents-check-empty-"))).exitCode).toBe(2);
  });

  it("clossys status shows the installed agents' rungs; clossys init shows the install list next to the computed packed set", () => {
    const root = workspace();
    expect(installedRungsLine(root)).toBe("agent rungs: no agent package installed");
    const [name, rung] = Object.entries(AGENT_RUNGS_BY_PACKAGE)[0]!;
    mkdirSync(join(root, "node_modules", name), { recursive: true });
    mkdirSync(join(root, "node_modules/@clossys/not-an-agent"), { recursive: true });
    expect(installedRungsLine(root)).toBe(`agent rungs: ${name} ${rung ?? "none"}`);
    const packed = Object.entries(AGENT_RUNGS).filter(([, at]) => at !== null && AGENT_LADDER.indexOf(at as never) >= AGENT_LADDER.indexOf("packed")).map(([id]) => id);
    expect(installNeedLine()).toBe(`install list: ${AGENT_LISTS.install.join(", ")}; computed at packed or higher: ${packed.join(", ") || "none"} (clossys agents check)`);
  });
});
