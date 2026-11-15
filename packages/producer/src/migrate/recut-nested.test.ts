/**
 * `clossys migrate recut` on a nested consumer (foundry-build-0030): slot folders sit under group folders at any
 * depth below `agents/<agent>/` and are found by their slot.json. The layout is built in tmp from
 * test-fixtures/consumer (folders only regrouped, no new text); the page candidate is the install fixture's
 * clossys.page/1 record.
 */
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, sep } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PRODUCER_ROOT } from "../package-path.js";
import { sha256Hex } from "../records/hash.js";
import { MIGRATIONS_FILE } from "../records/migrations.js";
import { runMigrateCli } from "../cli/migrate.js";
import { applyRecut, planRecut, recutCandidateBytes, recutPending, recutProblems } from "./recut.js";

const AT = "2026-11-15T10:00:00Z";
const LATER = "2026-11-16T10:00:00Z";
const PACKAGES = join(PRODUCER_ROOT, "..");
const FRONT = /^---\r?\n[\s\S]*?\r?\n---\r?\n/;
const PAGE_FIXTURE = join(PRODUCER_ROOT, "src", "publish", "__fixtures__", "install-consumer", "clossys", "agents", "publisher", "page.home");

const markdownBody = () => readFileSync(join(PACKAGES, "director", "src", "catalog", "defaults", "advantage.proposition.promise", "template-v1.md"), "utf8").replace(FRONT, "");

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

interface World { root: string; consumer: string; agent: (agent: string, ...rest: string[]) => string }
function world(): World {
  const root = mkdtempSync(join(tmpdir(), "recut-nested-"));
  roots.push(root);
  cpSync(join(PRODUCER_ROOT, "test-fixtures", "consumer", "clossys"), join(root, "clossys"), { recursive: true });
  const consumer = join(root, "clossys");
  return { root, consumer, agent: (agent, ...rest) => join(consumer, "agents", agent, ...rest) };
}
const put = (path: string, bytes: string) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, bytes); };

function snapshot(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (at: string) => {
    for (const name of readdirSync(at).sort()) {
      const path = join(at, name);
      if (statSync(path).isDirectory()) { out[`${relative(dir, path).split(sep).join("/")}/`] = "dir"; walk(path); }
      else out[relative(dir, path).split(sep).join("/")] = sha256Hex(readFileSync(path));
    }
  };
  walk(dir);
  return out;
}

/** int2 records on four agents: live, moved and retired candidates, and a Publisher page candidate (clossys.page/1). */
function seed(w: World) {
  const body = markdownBody();
  put(w.agent("director", "advantage.proposition.promise", "candidates", "promise-v1.md"), `---\nslot: "director/advantage.proposition.promise"\n---\n${body}`);
  put(w.agent("writer", "passages.hero", "candidates", "hero-v1.md"), body);
  put(w.agent("designer", "components.native-action", "candidates", "native-action-v1.md"), body);
  put(w.agent("designer", "components.chart-heatmap", "candidates", "heatmap-v1.md"), body);
  cpSync(PAGE_FIXTURE, w.agent("publisher", "page.home"), { recursive: true });
  return { body, page: readFileSync(join(PAGE_FIXTURE, "candidates", "page-v1.json"), "utf8") };
}

/** Moves `agents/<agent>/<id>` under group folders: the nested int2 layout. */
const nest = (w: World, agent: string, id: string, ...groups: string[]) => {
  mkdirSync(w.agent(agent, ...groups), { recursive: true });
  renameSync(w.agent(agent, id), w.agent(agent, ...groups, id));
};

/** Two agents nested two deep, a moved id and its target nested, a retired id nested, the page nested. */
function nestAll(w: World) {
  nest(w, "director", "advantage.proposition.promise", "advantage", "proposition");
  nest(w, "director", "context.market.size", "context", "market");
  nest(w, "writer", "passages.hero", "passages");
  nest(w, "designer", "components.native-action", "components", "actions");
  nest(w, "designer", "components.button", "components", "actions");
  nest(w, "designer", "components.chart-heatmap", "components", "charts");
  nest(w, "publisher", "page.home", "site", "site-pages");
}

describe("migrate recut: nested slot folders", () => {
  it("finds slot folders by slot.json at any depth, names them by slot.json id, and plans them as the flat layout", () => {
    const w = world();
    seed(w);
    nestAll(w);
    const before = snapshot(w.consumer);
    const plan = planRecut(w.root, { at: AT });
    expect(plan.unknown).toEqual([]);
    expect(plan.findings).toEqual([]);
    expect(recutProblems(plan)).toEqual([]);
    const row = (agent: string, id: string) => plan.rows.find(item => item.agent === agent && item.id === id);
    expect(row("director", "advantage.proposition.promise")?.fate).toBe("live");
    expect(row("writer", "passages.hero")).toMatchObject({ fate: "move", target: "sections.hero.copy" });
    expect(row("designer", "components.chart-heatmap")?.fate).toBe("retire");
    expect(row("publisher", "page.home")?.fate).toBe("live");
    // Group folders are not ids.
    for (const group of ["advantage", "context", "passages", "components", "site"]) expect(plan.rows.some(item => item.id === group)).toBe(false);
    expect(plan.flatten.map(move => `${move.agent}/${move.id}`).sort()).toEqual([
      "designer/components.button", "designer/components.chart-heatmap", "designer/components.native-action",
      "director/advantage.proposition.promise", "director/context.market.size", "publisher/page.home", "writer/passages.hero",
    ]);
    expect(plan.counts.director.flattened).toBe(2);
    expect(plan.counts.designer.flattened).toBe(3);
    // The slot.json id names the folder, not the folder name: a depth-1 folder named otherwise moves too.
    expect(snapshot(w.consumer)).toEqual(before);
  });

  it("--apply on the nested layout writes the bytes --apply writes on the flat layout, removes the empty groups, and a second --apply changes nothing", async () => {
    const flat = world();
    seed(flat);
    applyRecut(planRecut(flat.root, { at: AT }));

    const w = world();
    seed(w);
    nestAll(w);
    expect((await runMigrateCli(["recut", "--check", "--at", AT, "--root", w.root], w.root)).exitCode).toBe(1);
    const applied = await runMigrateCli(["recut", "--apply", "--at", AT, "--root", w.root], w.root);
    expect(applied.exitCode, applied.message).toBe(0);
    expect(applied.message).toMatch(/^director: .*2 nested folder\(s\) flattened/m);
    expect(snapshot(w.consumer)).toEqual(snapshot(flat.consumer));
    for (const group of [["director", "advantage"], ["director", "context"], ["writer", "passages"], ["designer", "components"], ["publisher", "site"]]) {
      expect(existsSync(w.agent(...(group as [string, string]))), group.join("/")).toBe(false);
    }
    expect(existsSync(w.agent("director", "advantage.proposition.promise", "slot.json"))).toBe(true);
    expect(existsSync(w.agent("designer", "_retired", "components.chart-heatmap", "candidates", "heatmap-v1.md"))).toBe(true);

    const once = snapshot(w.consumer);
    expect((await runMigrateCli(["recut", "--apply", "--at", LATER, "--root", w.root], w.root)).exitCode).toBe(0);
    expect(snapshot(w.consumer)).toEqual(once);
    expect(recutPending(planRecut(w.root, { at: LATER }))).toBe(0);
    expect((await runMigrateCli(["recut", "--check", "--at", LATER, "--root", w.root], w.root)).exitCode).toBe(0);
  });

  it("moves a depth-1 folder to the id its slot.json names", () => {
    const w = world();
    renameSync(w.agent("director", "context.market.trend"), w.agent("director", "market-trend"));
    const plan = planRecut(w.root, { at: AT });
    expect(plan.unknown).toEqual([]);
    expect(plan.flatten).toEqual([expect.objectContaining({ agent: "director", id: "context.market.trend", from: w.agent("director", "market-trend"), to: w.agent("director", "context.market.trend") })]);
    applyRecut(plan);
    expect(existsSync(w.agent("director", "market-trend"))).toBe(false);
    expect(existsSync(w.agent("director", "context.market.trend", "slot.json"))).toBe(true);
  });

  it("refuses a duplicate slot id at two depths: every mode exits 1 and writes nothing", async () => {
    const w = world();
    seed(w);
    nestAll(w);
    // A second designer/components.button, one depth down, with other bytes.
    cpSync(w.agent("designer", "components", "actions", "components.button"), w.agent("designer", "components", "components.button"), { recursive: true });
    put(w.agent("designer", "components", "components.button", "candidates", "copy-v1.md"), markdownBody());
    const before = snapshot(w.consumer);
    const plan = planRecut(w.root, { at: AT });
    const problems = recutProblems(plan);
    expect(problems.some(problem => problem.startsWith("designer/components.button: duplicate slot id at agents/designer/components/actions/components.button, agents/designer/components/components.button"))).toBe(true);
    for (const args of [[], ["--check"], ["--apply"]]) {
      const result = await runMigrateCli(["recut", ...args, "--at", AT, "--root", w.root], w.root);
      expect(result.exitCode, args.join(" ") || "dry run").toBe(1);
      expect(result.message).toContain("designer/components.button: duplicate slot id");
    }
    expect(() => applyRecut(plan)).toThrow(/nothing written/);
    expect(snapshot(w.consumer)).toEqual(before);
  });

  it("refuses a nested slot whose flat place holds other bytes, and a group folder holding more than slot folders", async () => {
    const w = world();
    seed(w);
    nestAll(w);
    put(w.agent("publisher", "page.home"), "not a folder\n");
    put(w.agent("director", "context", "notes.md"), "stray\n");
    const before = snapshot(w.consumer);
    const problems = recutProblems(planRecut(w.root, { at: AT }));
    expect(problems).toContain("agents/publisher/page.home: the flatten move would land on one that exists with other bytes");
    expect(problems.some(problem => problem.startsWith("agents/director/context/notes.md: a group folder holds a file"))).toBe(true);
    const result = await runMigrateCli(["recut", "--apply", "--at", AT, "--root", w.root], w.root);
    expect(result.exitCode).toBe(1);
    expect(snapshot(w.consumer)).toEqual(before);
  });
});

describe("migrate recut: Publisher page candidates", () => {
  it("passes a clossys.page/1 page record through untouched, and a top-level schema record stays refused elsewhere", () => {
    const page = readFileSync(join(PAGE_FIXTURE, "candidates", "page-v1.json"), "utf8");
    const context = (agent: "publisher" | "designer", slotId: string) => ({ agent, slotId, at: AT, version: "0.0.0", sourceRef: `agents/${agent}/${slotId}/candidates/page-v1.json` });
    expect(recutCandidateBytes("page-v1.json", page, context("publisher", "page.home"))).toBe(page);
    expect(() => recutCandidateBytes("page-v1.json", page, context("designer", "components.button"))).toThrow(/is a record, not an int2 candidate/);
    const other = `${JSON.stringify({ schema: "clossys.other/1" }, null, 2)}\n`;
    expect(() => recutCandidateBytes("page-v1.json", other, context("publisher", "page.home"))).toThrow(/is a record, not an int2 candidate/);
  });

  it("a consumer with a page candidate plans with no finding, keeps its bytes and records no migrated event for it", () => {
    const w = world();
    const seeded = seed(w);
    const plan = planRecut(w.root, { at: AT });
    expect(plan.findings).toEqual([]);
    expect(plan.candidates.some(change => change.from.includes(`${sep}page.home${sep}`))).toBe(false);
    applyRecut(plan);
    expect(readFileSync(w.agent("publisher", "page.home", "candidates", "page-v1.json"), "utf8")).toBe(seeded.page);
    const manifest = JSON.parse(readFileSync(join(w.consumer, MIGRATIONS_FILE), "utf8")) as { events: { file: string }[] };
    expect(manifest.events.some(event => event.file.startsWith("agents/publisher/"))).toBe(false);
  });
});
