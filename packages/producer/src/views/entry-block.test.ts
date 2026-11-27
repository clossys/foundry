/**
 * The AGENTS.md entry block the skills install writes (foundry-build-0048 CP1-FRONTDOOR): one managed block between
 * markers, the covered scope generated from the installed agents and the workspace records, opt-in Producer use, and
 * records protected in any session. Run on temp workspaces with synthetic installed skills and the fixture consumer's IA.
 */
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { placeSkills } from "../cli/init-skills.js";
import { ENTRY_END, ENTRY_START, coveredScope } from "./entry-block.js";

const FIXTURE = fileURLToPath(new URL("../../test-fixtures/consumer/clossys/agents", import.meta.url));
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function workspace(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "entry-block-")));
  roots.push(root);
  mkdirSync(join(root, "clossys", "agents"), { recursive: true });
  writeFileSync(join(root, "clossys", "clossys.config.ts"), "export default {};\n");
  return root;
}
/** A synthetic installed `@clossys/<role>` package that ships a skill. */
function install(root: string, role: string): void {
  const dir = join(root, "node_modules", "@clossys", role, "skill");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), `---\nname: clossys-${role}\ndescription: synthetic ${role} skill\n---\n`);
}
/** The fixture consumer's IA for one agent, copied into the workspace. */
function ia(root: string, agent: string): string[] {
  mkdirSync(join(root, "clossys", "agents", agent), { recursive: true });
  cpSync(join(FIXTURE, agent, "ia.json"), join(root, "clossys", "agents", agent, "ia.json"));
  return (JSON.parse(readFileSync(join(FIXTURE, agent, "ia.json"), "utf8")) as { nodes: { label: string }[] }).nodes.map(node => node.label);
}
const agentsMd = (root: string) => readFileSync(join(root, "AGENTS.md"), "utf8");
const blockOf = (text: string) => text.slice(text.indexOf(ENTRY_START), text.indexOf(ENTRY_END) + ENTRY_END.length);

describe("clossys init: the AGENTS.md entry block", () => {
  it("the AGENTS.md block is idempotent and leaves owner text untouched", () => {
    const root = workspace();
    install(root, "director");
    ia(root, "director");
    const before = "# Repository rules\n\nKeep commits small.\n";
    const after = "\n## Owner notes\n\nNever touch the billing folder.\n";
    writeFileSync(join(root, "AGENTS.md"), before);
    expect(placeSkills(root)).toMatchObject({ entry: "added", issues: [] });
    const first = agentsMd(root);
    expect(first.startsWith(before)).toBe(true);
    expect(first.split(ENTRY_START)).toHaveLength(2);
    expect(first.split(ENTRY_END)).toHaveLength(2);
    // Owner text after the block, then a re-run: the same bytes.
    writeFileSync(join(root, "AGENTS.md"), first + after);
    const owned = agentsMd(root);
    expect(placeSkills(root)).toMatchObject({ entry: "present", issues: [] });
    expect(agentsMd(root)).toBe(owned);
    // Coverage grows (a new agent installed): only the text between the markers changes.
    install(root, "writer");
    expect(placeSkills(root)).toMatchObject({ entry: "updated", issues: [] });
    const grown = agentsMd(root);
    const start = grown.indexOf(ENTRY_START), end = grown.indexOf(ENTRY_END) + ENTRY_END.length;
    expect(grown.slice(0, start)).toBe(owned.slice(0, owned.indexOf(ENTRY_START)));
    expect(grown.slice(end)).toBe(owned.slice(owned.indexOf(ENTRY_END) + ENTRY_END.length));
    expect(blockOf(grown)).toContain("Writer");
    expect(grown.split(ENTRY_START)).toHaveLength(2);
    // A created file holds the block alone; unpaired markers are refused and the file is left as it was.
    const fresh = workspace();
    install(fresh, "director");
    placeSkills(fresh);
    expect(agentsMd(fresh)).toBe(`${blockOf(agentsMd(fresh))}\n`);
    const broken = `${before}${ENTRY_START}\nhalf a block\n`;
    writeFileSync(join(fresh, "AGENTS.md"), broken);
    const refused = placeSkills(fresh);
    expect(refused.entry).toBe("refused");
    expect(refused.issues.join("\n")).toMatch(/entry block markers .* unpaired/);
    expect(agentsMd(fresh)).toBe(broken);
  });

  it("the block lists covered scope generated from installed agents and formats and does not make Producer the default", () => {
    const root = workspace();
    install(root, "director");
    install(root, "writer");
    install(root, "producer");
    const director = ia(root, "director");
    placeSkills(root);
    const block = blockOf(agentsMd(root));
    // The installed agents, each with its workspace IA groups; an agent not installed is not covered.
    expect(block).toContain(`- Director (\`@clossys-director\`): ${[...new Set(director)].join(", ")}`);
    expect(block).toContain("- Writer (`@clossys-writer`)");
    expect(block).not.toMatch(/Designer|Publisher/);
    // Publisher installed with an IA that places releases: the releases join the scope.
    install(root, "publisher");
    ia(root, "publisher");
    const releases = coveredScope(root).find(line => line.startsWith("Publisher releases: "));
    const placed = (JSON.parse(readFileSync(join(FIXTURE, "publisher", "ia.json"), "utf8")) as { nodes: { children: { slots: string[] }[] }[] }).nodes
      .flatMap(node => node.children.flatMap(child => child.slots))
      .filter(slot => slot.startsWith("release.")).map(slot => slot.slice("release.".length));
    expect(placed.length).toBeGreaterThan(0);
    expect(releases).toBe(`Publisher releases: ${placed.join(", ")}`);
    placeSkills(root);
    const grown = blockOf(agentsMd(root));
    expect(grown).toContain(`- ${releases}`);
    expect(grown).toContain("- Publisher (`@clossys-publisher`)");
    // Opt-in, never a takeover: Producer on invocation or a covered ask only; records protected in any session.
    expect(grown).toContain("Use the `clossys-producer` skill only when the owner invokes it (`@clossys-producer`, or \"clossys ...\") or asks for covered work.");
    expect(grown).toContain("Everything else is ordinary work in this repository.");
    expect(grown).toContain("In any session, records under `clossys/` and Clossys-generated output change only through `clossys` verbs.");
    expect(grown).not.toMatch(/act as (the )?Producer|every session (is|acts|runs)|always (use|run|act)|by default/i);
    // No agent installed: nothing is covered, so nothing is written.
    const bare = workspace();
    expect(placeSkills(bare).entry).toBe("none");
    expect(() => readFileSync(join(bare, "AGENTS.md"))).toThrow();
  });
});
