/**
 * `clossys migrate recut` on a tmp copy of test-fixtures/consumer. The candidates and the library cell are
 * built in tmp from package default candidates (shape only, no new text).
 */
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PRODUCER_ROOT } from "../package-path.js";
import { sha256Hex } from "../records/hash.js";
import { MIGRATIONS_FILE, validateMigrations } from "../records/migrations.js";
import { readRecordHeader } from "../records/schema.js";
import { runMigrateCli } from "../cli/migrate.js";
import { RECUT_AGENTS, RECUT_CLI, applyRecut, packageTables, planRecut, recutPending, recutProblems } from "./recut.js";
import { RETIRE_REASON } from "../constitution/checks/R10-retire.js";

const AT = "2026-11-15T10:00:00Z";
const LATER = "2026-11-16T10:00:00Z";
const PACKAGES = join(PRODUCER_ROOT, "..");
const FRONT = /^---\r?\n[\s\S]*?\r?\n---\r?\n/;

/** A package default candidate's body (its header stripped): existing text, reused for shape only. */
const markdownBody = () => readFileSync(join(PACKAGES, "director", "src", "catalog", "defaults", "advantage.proposition.promise", "template-v1.md"), "utf8").replace(FRONT, "");
const jsonContent = () => (JSON.parse(readFileSync(join(PACKAGES, "writer", "defaults", "lexicon.energy", "energy-v1.json"), "utf8")) as { content: unknown }).content;

let root: string | undefined;
afterEach(() => { if (root) rmSync(root, { recursive: true, force: true }); root = undefined; });

interface World { root: string; consumer: string; agent: (agent: string, ...rest: string[]) => string; put: (path: string, bytes: string) => void }
function world(): World {
  root = mkdtempSync(join(tmpdir(), "recut-"));
  cpSync(join(PRODUCER_ROOT, "test-fixtures", "consumer", "clossys"), join(root, "clossys"), { recursive: true });
  const consumer = join(root, "clossys");
  const put = (path: string, bytes: string) => { mkdirSync(join(path, ".."), { recursive: true }); writeFileSync(path, bytes); };
  return { root, consumer, agent: (agent, ...rest) => join(consumer, "agents", agent, ...rest), put };
}

/** Every file under a folder, as path to sha256. */
function snapshot(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (at: string) => {
    for (const name of readdirSync(at).sort()) {
      const path = join(at, name);
      if (statSync(path).isDirectory()) walk(path);
      else out[relative(dir, path).split(sep).join("/")] = sha256Hex(readFileSync(path));
    }
  };
  walk(dir);
  return out;
}

const placedIds = (file: string): string[] => {
  const doc = JSON.parse(readFileSync(file, "utf8")) as { nodes: { children: { slots: string[] }[] }[] };
  return doc.nodes.flatMap(node => node.children.flatMap(child => child.slots));
};

/** The int2 records the test seeds: a live Director candidate with int2 front matter, two moved candidates, a retired one, a library cell. */
function seed(w: World) {
  const body = markdownBody();
  const live = w.agent("director", "advantage.proposition.promise", "candidates", "promise-v1.md");
  w.put(live, `---\nslot: "director/advantage.proposition.promise"\n---\n${body}`);
  const movedMd = w.agent("writer", "passages.hero", "candidates", "hero-v1.md");
  w.put(movedMd, body);
  const movedJson = w.agent("designer", "components.native-action", "candidates", "native-action-v1.json");
  w.put(movedJson, `${JSON.stringify({ meta: { element: {} }, content: jsonContent() }, null, 2)}\n`);
  const retired = w.agent("designer", "components.chart-heatmap", "candidates", "heatmap-v1.md");
  w.put(retired, body);
  const cell = join(w.consumer, "library", "passages.hero", "hero", "v2");
  w.put(join(cell, "cell.md"), body);
  w.put(join(cell, "element.json"), "{}\n");
  w.put(join(cell, "preview.json"), "{}\n");
  return { body, live, movedMd, movedJson, retired, cell };
}

describe("migrate recut: plan", () => {
  it("maps every slot folder through the package trees and retired.json, and writes nothing", () => {
    const w = world();
    seed(w);
    const before = snapshot(w.consumer);
    const plan = planRecut(w.root, { at: AT });
    expect(plan.unknown).toEqual([]);
    expect(plan.missingRetired).toEqual([]);
    const row = (agent: string, id: string) => plan.rows.find(item => item.agent === agent && item.id === id);
    expect(row("writer", "passages.hero")).toEqual({ agent: "writer", id: "passages.hero", fate: "move", target: "sections.hero.copy" });
    expect(row("designer", "components.native-action")).toEqual({ agent: "designer", id: "components.native-action", fate: "move", target: "components.button" });
    expect(row("designer", "components.chart-heatmap")).toEqual({ agent: "designer", id: "components.chart-heatmap", fate: "retire" });
    expect(row("director", "advantage.proposition.promise")?.fate).toBe("live");
    // The Studio publication's Designer leaves are package leaves, not unknown.
    expect(row("designer", "themes.success")?.fate).toBe("live");
    for (const agent of RECUT_AGENTS) {
      const c = plan.counts[agent];
      expect(c.live + c.moved + c.retired + c.unknown).toBe(plan.rows.filter(item => item.agent === agent).length);
    }
    expect(plan.counts.writer.carried).toBe(1);
    expect(plan.counts.designer.carried).toBe(1);
    expect(plan.counts.director.headers).toBe(1);
    expect(plan.counts.writer.cells).toBe(1);
    expect(plan.skipped.every(id => id.startsWith("producer/"))).toBe(true);
    expect(snapshot(w.consumer)).toEqual(before);
  });

  it("follows a retired id to the live leaf its target names", () => {
    const tables = packageTables(join(PRODUCER_ROOT, "test-fixtures", "consumer"));
    for (const agent of RECUT_AGENTS) for (const [id, target] of tables[agent].retired) {
      expect(tables[agent].live.has(id)).toBe(false);
      if (target !== undefined) expect(tables[agent].live.has(target)).toBe(true);
    }
  });
});

describe("migrate recut: apply", () => {
  it("moves candidates to their targets with the candidate/1 header, keeps every body byte, and records each rewrite", () => {
    const w = world();
    const seeded = seed(w);
    const original = { live: readFileSync(seeded.live, "utf8"), movedMd: readFileSync(seeded.movedMd, "utf8"), movedJson: readFileSync(seeded.movedJson, "utf8"), retired: readFileSync(seeded.retired, "utf8") };
    const plan = planRecut(w.root, { at: AT });
    applyRecut(plan);

    // Moved Markdown: the target holds it with a new header and the same body; the old folder is retired.
    const hero = w.agent("writer", "sections.hero.copy", "candidates", "hero-v1.md");
    const heroText = readFileSync(hero, "utf8");
    const header = readRecordHeader("hero-v1.md", heroText) as Record<string, unknown>;
    expect(header).toMatchObject({ schema: "clossys.candidate/1", id: "writer/sections.hero.copy/hero-v1.md", slot: "writer/sections.hero.copy", status: "submitted", createdAt: AT });
    expect(header.createdBy).toMatchObject({ actor: "code", cli: RECUT_CLI });
    expect(heroText).toBe(`---\nclossys: ${JSON.stringify(header)}\n---\n${original.movedMd}`);
    expect(existsSync(w.agent("writer", "passages.hero"))).toBe(false);
    expect(existsSync(w.agent("writer", "_retired", "passages.hero", "slot.json"))).toBe(true);

    // Moved JSON: content kept as is.
    const button = JSON.parse(readFileSync(w.agent("designer", "components.button", "candidates", "native-action-v1.json"), "utf8")) as { clossys: Record<string, unknown>; content: unknown };
    expect(button.content).toEqual(jsonContent());
    expect(button.clossys.slot).toBe("designer/components.button");

    // Live: the int2 front matter is the header that changes; the body after it is kept.
    const live = readFileSync(seeded.live, "utf8");
    expect(live.replace(FRONT, "")).toBe(original.live.replace(FRONT, ""));
    expect((readRecordHeader("promise-v1.md", live) as { createdBy: unknown }).createdBy).toMatchObject({ actor: "code", cli: RECUT_CLI });

    // Retired: the folder moved whole, bytes unchanged.
    expect(readFileSync(w.agent("designer", "_retired", "components.chart-heatmap", "candidates", "heatmap-v1.md"), "utf8")).toBe(original.retired);

    // Library cell: one candidate in the target slot, preview.json dropped, the cell folder gone.
    const cell = readFileSync(w.agent("writer", "sections.hero.copy", "candidates", "hero-v2.md"), "utf8");
    expect(cell.replace(FRONT, "")).toBe(seeded.body);
    expect(existsSync(join(w.consumer, "library"))).toBe(false);

    // Migration manifest: old and new sha of every rewritten candidate.
    const manifest = JSON.parse(readFileSync(join(w.consumer, MIGRATIONS_FILE), "utf8")) as { events: { migration: string; file: string; from: { sha256: string }; to: { sha256: string } }[] };
    expect(validateMigrations(manifest)).toEqual([]);
    const event = manifest.events.find(item => item.file === "agents/writer/sections.hero.copy/candidates/hero-v1.md");
    expect(event).toMatchObject({ migration: "recut", from: { sha256: sha256Hex(original.movedMd) }, to: { sha256: sha256Hex(heroText) } });
    expect(manifest.events.map(item => item.file).sort()).toEqual([
      "agents/designer/components.button/candidates/native-action-v1.json",
      "agents/director/advantage.proposition.promise/candidates/promise-v1.md",
      "agents/writer/sections.hero.copy/candidates/hero-v1.md",
      "agents/writer/sections.hero.copy/candidates/hero-v2.md",
    ]);
  });

  it("retires every leaf a package retired.json lists out of the consumer ia.json, by command", () => {
    const w = world();
    // The two retired Director leaves, as an int2 consumer still places them.
    const tables = packageTables(w.root);
    const directorRetired = [...tables.director.retired.keys()];
    expect(directorRetired.length).toBeGreaterThan(0);
    const iaFile = w.agent("director", "ia.json");
    const ia = JSON.parse(readFileSync(iaFile, "utf8")) as { nodes: { children: { slots: string[] }[] }[] };
    ia.nodes[0]!.children[0]!.slots.push(...directorRetired);
    writeFileSync(iaFile, `${JSON.stringify(ia, null, 2)}\n`);
    for (const id of directorRetired) cpSync(w.agent("director", "context.market.size"), w.agent("director", id), { recursive: true });
    for (const id of directorRetired) {
      const slot = JSON.parse(readFileSync(w.agent("director", id, "slot.json"), "utf8")) as Record<string, unknown>;
      writeFileSync(w.agent("director", id, "slot.json"), `${JSON.stringify({ ...slot, id }, null, 2)}\n`);
    }

    applyRecut(planRecut(w.root, { at: AT }));
    for (const agent of RECUT_AGENTS) {
      const file = w.agent(agent, "ia.json");
      if (!existsSync(file)) continue;
      const placed = placedIds(file);
      for (const id of tables[agent].retired.keys()) expect(placed, `${agent} still places ${id}`).not.toContain(id);
      for (const target of tables[agent].retired.values()) if (target) expect(placed).toContain(target);
    }
    const retiredRows = (JSON.parse(readFileSync(iaFile, "utf8")) as { retired: { slot: string; by: string; reason: string }[] }).retired;
    expect(retiredRows.map(row => row.slot)).toEqual(expect.arrayContaining(directorRetired.map(id => `director/${id}`)));
    // The rows take the clossys.retire/1 shape for by and reason (the schema's own patterns).
    const schema = JSON.parse(readFileSync(join(PRODUCER_ROOT, "src", "constitution", "schemas", "retire.schema.json"), "utf8")) as { properties: { by: { pattern: string }; reason: { pattern: string } } };
    for (const row of retiredRows) {
      expect(row.by).toMatch(new RegExp(schema.properties.by.pattern));
      expect(row.reason).toMatch(new RegExp(schema.properties.reason.pattern));
      expect(row.reason).toMatch(RETIRE_REASON);
    }
    for (const id of directorRetired) expect(existsSync(w.agent("director", "_retired", id))).toBe(true);
  });

  it("a second --apply changes no byte, at any time", async () => {
    const w = world();
    seed(w);
    expect((await runMigrateCli(["recut", "--apply", "--at", AT, "--root", w.root], w.root)).exitCode).toBe(0);
    const once = snapshot(w.consumer);
    const again = await runMigrateCli(["recut", "--apply", "--at", LATER, "--root", w.root], w.root);
    expect(again.exitCode).toBe(0);
    expect(snapshot(w.consumer)).toEqual(once);
    expect(recutPending(planRecut(w.root, { at: LATER }))).toBe(0);
  });
});

describe("migrate recut: CLI", () => {
  it("dry runs with counts per agent, --check exits 1 while work remains and 0 after --apply", async () => {
    const w = world();
    seed(w);
    const before = snapshot(w.consumer);
    const dry = await runMigrateCli(["recut", "--at", AT, "--root", w.root], w.root);
    expect(dry.exitCode).toBe(0);
    for (const agent of RECUT_AGENTS) expect(dry.message).toMatch(new RegExp(`^${agent}: \\d+ live, \\d+ moved, \\d+ retired, 0 unknown`, "m"));
    expect(snapshot(w.consumer)).toEqual(before);
    expect((await runMigrateCli(["recut", "--check", "--at", AT, "--root", w.root], w.root)).exitCode).toBe(1);
    expect((await runMigrateCli(["recut", "--apply", "--at", AT, "--root", w.root], w.root)).exitCode).toBe(0);
    const check = await runMigrateCli(["recut", "--check", "--at", AT, "--root", w.root], w.root);
    expect(check.message).toContain("0 write(s) pending");
    expect(check.exitCode).toBe(0);
  });

  it("names an old id in no tree and no retired.json, exits 1 and writes nothing", async () => {
    const w = world();
    seed(w);
    cpSync(w.agent("designer", "components.button"), w.agent("designer", "components.not-in-any-tree"), { recursive: true });
    const before = snapshot(w.consumer);
    for (const args of [[], ["--apply"], ["--check"]]) {
      const result = await runMigrateCli(["recut", ...args, "--at", AT, "--root", w.root], w.root);
      expect(result.exitCode).toBe(1);
      expect(result.message).toContain("unknown: designer/components.not-in-any-tree is in no package tree and no retired.json");
    }
    expect(snapshot(w.consumer)).toEqual(before);
    expect(() => applyRecut(planRecut(w.root, { at: AT }))).toThrow(/designer\/components\.not-in-any-tree/);
  });

  it("a library cell clashing with a retired slot's candidate: the dry run names it and exits 1, --apply exits 1 and writes nothing", async () => {
    const w = world();
    const seeded = seed(w);
    // The retired slot's candidate heatmap-v1.md, mirrored by an int2 library cell of the same slot.
    w.put(join(w.consumer, "library", "components.chart-heatmap", "heatmap", "v1", "cell.md"), seeded.body);
    const before = snapshot(w.consumer);
    const plan = planRecut(w.root, { at: AT });
    expect(plan.findings.some(finding => finding.includes("library/components.chart-heatmap/heatmap/v1") && finding.includes("already exists"))).toBe(true);
    expect(plan.library.conversions.some(conversion => conversion.cell.slot === "components.chart-heatmap")).toBe(false);
    expect(recutProblems(plan).length).toBeGreaterThan(0);
    for (const args of [[], ["--check"], ["--apply"]]) {
      const result = await runMigrateCli(["recut", ...args, "--at", AT, "--root", w.root], w.root);
      expect(result.exitCode, args.join(" ") || "dry run").toBe(1);
      expect(result.message).toContain("library/components.chart-heatmap/heatmap/v1");
    }
    expect(() => applyRecut(plan)).toThrow(/nothing written/);
    expect(snapshot(w.consumer)).toEqual(before);
  });

  it("names a library slot in no tree and no retired.json, exits 1 in every mode and writes nothing", async () => {
    const w = world();
    const seeded = seed(w);
    w.put(join(w.consumer, "library", "passages.not-a-slot", "x", "v1", "cell.md"), seeded.body);
    const before = snapshot(w.consumer);
    expect(planRecut(w.root, { at: AT }).unknown).toContain("library/passages.not-a-slot");
    for (const args of [[], ["--apply"], ["--check"]]) {
      const result = await runMigrateCli(["recut", ...args, "--at", AT, "--root", w.root], w.root);
      expect(result.exitCode, args.join(" ") || "dry run").toBe(1);
      expect(result.message).toContain("unknown: library/passages.not-a-slot is in no package tree and no retired.json");
    }
    expect(snapshot(w.consumer)).toEqual(before);
  });

  it("a folder that does not fully move keeps its id placed, and every mode exits 1 on the finding", async () => {
    const w = world();
    seed(w);
    w.put(w.agent("writer", "passages.hero", "candidates", "notes.txt"), "stray\n");
    const iaFile = w.agent("writer", "ia.json");
    const ia = JSON.parse(readFileSync(iaFile, "utf8")) as { nodes: { children: { slots: string[] }[] }[] };
    if (!placedIds(iaFile).includes("passages.hero")) {
      ia.nodes[0]!.children[0]!.slots.push("passages.hero");
      writeFileSync(iaFile, `${JSON.stringify(ia, null, 2)}\n`);
    }
    const before = snapshot(w.consumer);
    const plan = planRecut(w.root, { at: AT });
    expect(plan.findings.some(finding => finding.includes("writer/passages.hero: not every candidate moves"))).toBe(true);
    const writerIa = plan.ia.find(item => item.file === iaFile);
    const planned = writerIa ? (JSON.parse(writerIa.bytes) as { nodes: { children: { slots: string[] }[] }[] }).nodes.flatMap(node => node.children.flatMap(child => child.slots)) : placedIds(iaFile);
    expect(planned).toContain("passages.hero");
    for (const args of [[], ["--check"], ["--apply"]]) {
      expect((await runMigrateCli(["recut", ...args, "--at", AT, "--root", w.root], w.root)).exitCode, args.join(" ") || "dry run").toBe(1);
    }
    expect(snapshot(w.consumer)).toEqual(before);
  });
});
