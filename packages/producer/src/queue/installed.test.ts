/**
 * The installed layout (foundry-build-0048 U7, routing): a consumer that installs the agents reads each agent's
 * conform.json from node_modules/@clossys/<agent>/ (readDeclarations' default is the folder beside the installed
 * producer). Every agent package ships conform.json, so a handler row routes to its agent instead of falling to the
 * owner catch-all, and a cross-agent raise over a declared issuing edge still works.
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, cpSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { raiseWork } from "../records/request.js";
import { consumerFacts, routeEntry } from "./routing.js";

const PACKAGES = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../..");
const FIXTURE = join(PACKAGES, "producer/test-fixtures/consumer");
const AGENTS = ["director", "designer", "writer", "publisher"] as const;
const AT = "2026-11-17T10:00:00Z";
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

/** The files `npm pack` would ship for one agent package (no scripts run). */
function packed(agent: string): string[] {
  const out = execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], { cwd: join(PACKAGES, agent), encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  return (JSON.parse(out) as { files: { path: string }[] }[])[0]!.files.map(file => file.path);
}

/** A consumer with node_modules/@clossys/<agent>/ holding each agent's packed package.json and conform.json. */
function installed(ship: (agent: string) => boolean) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "installed-")));
  roots.push(root);
  cpSync(FIXTURE, root, { recursive: true });
  const scope = join(root, "node_modules/@clossys");
  for (const agent of AGENTS) {
    mkdirSync(join(scope, agent), { recursive: true });
    copyFileSync(join(PACKAGES, agent, "package.json"), join(scope, agent, "package.json"));
    if (ship(agent)) copyFileSync(join(PACKAGES, agent, "conform.json"), join(scope, agent, "conform.json"));
  }
  const consumer = join(root, "clossys");
  return { consumer, facts: consumerFacts(consumer, { packagesDir: scope }) };
}

describe("an installed consumer", () => {
  it("gets conform.json in every agent package's packed files", { timeout: 120_000 }, () => {
    for (const agent of AGENTS) expect(packed(agent), agent).toContain("conform.json");
  });

  it("routes a fix to its handler and raises across agents over a declared edge", () => {
    const shipped = new Set(AGENTS.filter(agent => packed(agent).includes("conform.json")));
    const { consumer, facts } = installed(agent => shipped.has(agent as never));
    expect(routeEntry(facts, { kind: "fix", target: "designer/sections.hero", assignee: "designer" })).toMatchObject({ row: "fix.live", assignee: "designer", handler: { loop: "loop.create" } });
    expect(routeEntry(facts, { kind: "change", target: "writer/narratives.article", assignee: "writer" })).toMatchObject({ row: "change.live", assignee: "writer" });
    const raised = raiseWork(consumer, { kind: "change", target: "designer/sections.hero", from: "writer/narratives.article", why: "the copy needs a wider column", want: "contract", source: "cli", by: "writer", at: AT }, { facts });
    expect(raised.request).toMatchObject({ assignee: "designer", route: { row: "change.live" } });
  }, 120_000);

  it("falls to the owner catch-all and refuses the cross-agent raise when the packages ship no conform.json (the control)", () => {
    const { consumer, facts } = installed(() => false);
    expect(routeEntry(facts, { kind: "fix", target: "designer/sections.hero", assignee: "designer" })).toMatchObject({ row: "catch-all", assignee: "owner" });
    expect(() => raiseWork(consumer, { kind: "change", target: "designer/sections.hero", from: "writer/narratives.article", why: "the copy needs a wider column", want: "contract", source: "cli", by: "writer", at: AT }, { facts })).toThrow(/declares no issuing edge/);
  });
});
