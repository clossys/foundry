/**
 * CONSISTENCY C3 (foundry-build-0048): the Writer and Director record suites skip the agent's own `loop.*` slots (JSON
 * loop versions that `loop.agent-standard` validates), count the content slots the agent IA places, and still fail on
 * a broken markdown cell in a content slot.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { directorSuite, recordSuitesSummary, runRecordSuites, writerSuite } from "./record-suites.js";
import { sha256Hex } from "../records/hash.js";
import { serializeFrontmatter, slotPositions, type IaDoc } from "../records/slot-model/index.js";

const temps: string[] = [];
afterAll(() => { for (const dir of temps) rmSync(dir, { recursive: true, force: true }); });
function consumer(): string {
  const root = mkdtempSync(join(tmpdir(), "producer-record-suites-loops-"));
  temps.push(root);
  mkdirSync(join(root, "clossys"), { recursive: true });
  writeFileSync(join(root, "clossys", "clossys.config.ts"), "export default {};\n");
  return root;
}
const LOOP = "loop.scope";
/** An agent IA placing `content` (one content slot) and the agent's loop.scope slot. */
function agentIa(root: string, agent: "writer" | "director", content: string): IaDoc {
  const ia: IaDoc = { schema: "clossys.ia/1", source: "synthetic#fixture", extensions: [], nodes: [
    { id: "content", label: "Content", children: [{ id: "content-group", label: "Content group", slots: [content] }] },
    { id: "loops", label: "Loops", children: [{ id: "agent", label: "Agent", slots: [LOOP] }] },
  ] };
  mkdirSync(join(root, "clossys", "agents", agent), { recursive: true });
  writeFileSync(join(root, "clossys", "agents", agent, "ia.json"), JSON.stringify(ia));
  return ia;
}
function pinned(root: string, agent: string, ia: IaDoc, id: string, name: string, bytes: string, kind: string): void {
  const dir = join(root, "clossys", "agents", agent, id);
  mkdirSync(join(dir, "candidates"), { recursive: true });
  writeFileSync(join(dir, "slot.json"), JSON.stringify({ schema: "clossys.slot/1", id, agent, ia: slotPositions(agent as "writer", ia).get(id), kind, contract: {}, inputs: [], uses: [] }));
  writeFileSync(join(dir, "candidates", name), bytes);
  writeFileSync(join(dir, "pin.json"), JSON.stringify({ candidate: name, sha256: sha256Hex(bytes), decidedBy: "planner:W3", basis: "planner", at: "2026-11-10T00:00:00Z" }));
}
/** A JSON loop version, as `clossys init` adopts and pins it. */
const loopVersion = `${JSON.stringify({ clossys: { schema: "clossys.candidate/1", slot: LOOP }, content: { loop: LOOP, steps: [] } }, null, 2)}\n`;
const title = (id: string, text: string) => `### ${id}\n<!-- ${JSON.stringify({ id, bindings: [] })} -->\n${text}\n\n`;
const writerCell = (body: string) => serializeFrontmatter({ slot: "strings.page-titles", locales: ["en"], source: { kind: "original", ref: [] } }, body);

describe("record suites skip the agent loop slots (CONSISTENCY C3)", () => {
  it("passes the strict Writer and Director suites over pinned JSON loop versions and counts the adopted content slots", async () => {
    const root = consumer();
    const writer = agentIa(root, "writer", "strings.page-titles");
    pinned(root, "writer", writer, LOOP, "scope-v1.json", loopVersion, "loop");
    pinned(root, "writer", writer, "strings.page-titles", "titles-v1.md", writerCell(`## en\n${title("home.title", "Home")}`), "strings");
    const director = agentIa(root, "director", "identity.brand.essence");
    pinned(root, "director", director, LOOP, "scope-v1.json", loopVersion, "loop");
    const writerReport = await writerSuite(root);
    expect(writerReport).toMatchObject({ suite: "writer-slots", status: "ran", checked: 1, adopted: 1, totals: { error: 0 } });
    expect(writerReport.findings.filter(row => row.where.startsWith(LOOP))).toEqual([]);
    const directorReport = await directorSuite(root);
    expect(directorReport).toMatchObject({ suite: "director-slots", status: "ran", checked: 0, adopted: 1, totals: { error: 0 } });
    const all = await runRecordSuites(root, { strict: true });
    const summary = recordSuitesSummary(all);
    expect(summary).toMatch(/Writer slots: 1 slots pinned of 1 adopted, errors=0/);
    expect(summary).toMatch(/Director slots: 0 cells pinned of 1 adopted, errors=0/);
    expect(summary).not.toMatch(/loop\.scope/);
  });

  it("still fails the strict suite on a markdown-cell error in a content Writer slot (mutation c)", async () => {
    const root = consumer();
    const writer = agentIa(root, "writer", "strings.page-titles");
    pinned(root, "writer", writer, LOOP, "scope-v1.json", loopVersion, "loop");
    // A content cell with no frontmatter: the Writer's own parser refuses it.
    pinned(root, "writer", writer, "strings.page-titles", "titles-v1.md", `## en\n${title("home.title", "Home")}`, "strings");
    const report = await writerSuite(root);
    expect(report.findings.filter(row => row.severity === "error").map(row => `${row.code} ${row.where} ${row.message}`)).toEqual([
      "INPUT strings.page-titles agents/writer/strings.page-titles/candidates/titles-v1.md Invalid candidate frontmatter",
    ]);
    const strict = await runRecordSuites(root, { strict: true });
    expect(strict.suites.find(suite => suite.suite === "writer-slots")).toMatchObject({ status: "ran", totals: { error: 1 } });
    expect(strict.exitCode).toBe(1);
  });
});
