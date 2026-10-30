import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { agentModule, agentRoot } from "../server/cells.js";
import { parseArgs } from "./args.js";
import { designBrief, runDesign } from "./design.js";
import { runCli } from "./main.js";

let root: string;
const fixture = fileURLToPath(new URL("../../../designer/src/library-cli/__fixtures__/agent-receipted-cells/clossys/agents/designer", import.meta.url));
const ids = ["identity.brand.essence", "identity.brand.personality", "identity.visual.style", "identity.visual.imagery", "identity.verbal.voice", "focus.segment.core", "advantage.proposition.promise", "focus.category.definition"];
const bullets: Record<string, string[]> = {
  "identity.brand.essence": ["Essence: Deliberate clarity.", "Meaning: Explain decisions.", "Not: False certainty."],
  "identity.brand.personality": ["Traits: Precise and calm.", "Not: Loud or ornamental.", "Example: TODO-OWNER: choose a verified example."],
  "identity.visual.style": ["Feel: Quiet confidence.", "Signature: Clear typographic hierarchy.", "Avoid: Decorative motion."],
  "identity.visual.imagery": ["Use: Explain the workflow.", "Never: Imaginary customer logos."],
  "identity.verbal.voice": ["Sound: Plain and direct.", "Do: Explain the practical effect.", "Never: Guaranteed results."],
  "focus.segment.core": ["Who: Small teams.", "Context: TODO-OWNER: verify location."],
  "advantage.proposition.promise": ["Promise: Clear decisions."],
  "focus.category.definition": ["Category: Workflow tools."],
};
async function put(path: string, text: string) { await mkdir(dirname(path), { recursive: true }); await writeFile(path, text); }
async function director(version = 1) {
  for (const id of ids) await put(join(agentRoot(root, "director"), `cells/${id}/v${version}.md`), `---\nid: ${id}\nversion: ${version}\nstatus: active\nupdated: 2026-10-30\ncites: []\nfeeds: []\nfunctions: []\nconfirmed: msg:2026-10-30-1#U1\n---\n\n## Direction\n${bullets[id]!.map(text => `- ${text}`).join("\n")}\n\n## Because\n- Explicit fixture input.\n\n## Watch\n- Revisit after evidence changes.\n`);
  await put(join(agentRoot(root, "director"), "tree.json"), JSON.stringify({ schemaVersion: 1, active: Object.fromEntries(ids.map(id => [id, version])) }));
}
async function designer() { await cp(fixture, agentRoot(root, "designer"), { recursive: true }); }
async function snapshot(path = root, prefix = ""): Promise<Record<string, string>> {
  const rows: Record<string, string> = {};
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const name = `${prefix}${entry.name}`;
    if (entry.isDirectory()) Object.assign(rows, await snapshot(join(path, entry.name), `${name}/`));
    else rows[name] = createHash("sha256").update(await readFile(join(path, entry.name))).digest("hex");
  }
  return rows;
}
const run = (args: string[]) => runDesign(parseArgs(["design", ...args]), root);
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "producer-design-"));
  await put(join(root, "clossys/clossys.config.ts"), "export default {};\n");
  await director();
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe("deterministic design brief/check/compile", () => {
  it("assembles exact ACTIVE inputs, prohibitions and native leaves without authoring a proposal", async () => {
    const source = join(agentRoot(root, "director"), "cells/identity.brand.personality/v1.md");
    await put(source.replace("v1.md", "v2.md"), (await readFile(source, "utf8")).replace("version: 1", "version: 2").replace("status: active", "status: draft").replace("Precise and calm.", "Unconfirmed bold idea."));
    const before = await snapshot();
    const result = await run(["--brief"]);
    expect(result.exitCode).toBe(0);
    const brief = result.result as Awaited<ReturnType<typeof designBrief>>;
    expect(brief.inputs.find(input => input.role === "personality")).toMatchObject({ version: 1, ref: "director:identity.brand.personality@1", direction: expect.arrayContaining([expect.objectContaining({ text: "Precise and calm." })]) });
    expect(brief.inputs.find(input => input.role === "audience")?.direction).toEqual(expect.arrayContaining([expect.objectContaining({ text: "TODO-OWNER: verify location." })]));
    expect(brief.traits.some(trait => trait.text.includes("TODO-OWNER"))).toBe(false);
    expect(brief.limits.filter(limit => limit.code === "unresolved-owner-input")).toHaveLength(2);
    expect(brief.wontClaim).toEqual(expect.arrayContaining([expect.objectContaining({ ref: "director:identity.verbal.voice@1", key: "Never", text: "Guaranteed results." })]));
    expect(brief.leaves).toEqual(expect.arrayContaining([{ id: "tokens.typeface", layer: "tokens" }, { id: "components.button", layer: "components" }]));
    expect(brief.leaves.some(leaf => leaf.layer === "sections")).toBe(true);
    expect(brief.leaves.some(leaf => leaf.layer === "frames")).toBe(true);
    expect(brief.componentSourcePreference.basis).toBe("planner-default");
    expect(await snapshot()).toEqual(before);
  });

  it("reports named missing inputs and refuses missing roots without silently initialising them", async () => {
    const tree = { schemaVersion: 1, active: {} };
    await put(join(agentRoot(root, "director"), "tree.json"), JSON.stringify(tree));
    expect(await run(["--brief"])).toMatchObject({ exitCode: 1, result: { limits: expect.arrayContaining([expect.objectContaining({ code: "missing-director-input", subject: "focus.segment.core" })]) } });
    expect(await run([])).toMatchObject({ exitCode: 2, message: expect.stringContaining("Designer cells are missing") });
    expect(await run(["--check"])).toMatchObject({ exitCode: 2, message: expect.stringContaining("Designer cells are missing") });
    await rm(agentRoot(root, "director"), { recursive: true });
    expect(await run(["--brief"])).toMatchObject({ exitCode: 2, message: expect.stringContaining("Director cells are missing") });
  });

  it("finds missing links, stale ACTIVE versions and uncovered traits; --check changes no consumer bytes", async () => {
    await designer();
    const cellPath = join(agentRoot(root, "designer"), "cells/tokens.radius/v1.md");
    await writeFile(cellPath, (await readFile(cellPath, "utf8")).replace("links: []", "links: [director:identity.brand.personality@2]"));
    const before = await snapshot(), result = await run(["--check"]);
    expect(result.exitCode).toBe(1);
    expect(result.result).toMatchObject({ findings: expect.arrayContaining([
      expect.objectContaining({ code: "missing-director-link" }),
      expect.objectContaining({ code: "stale-director-version", subject: "tokens.radius@1" }),
      expect.objectContaining({ code: "unrealised-director-trait" }),
    ]) });
    expect(await snapshot()).toEqual(before);
  });

  it("requires a nonempty exact realisation marker and current link; drafts cannot make active coverage clean", async () => {
    await designer();
    const brief = await designBrief(root), trait = brief.traits.find(trait => trait.kind === "brand-trait")!;
    const store = await agentModule("director", "cell-format/index.js");
    const profile = await agentModule("designer", "library-cli/cells.js");
    const draft = await store.propose(agentRoot(root, "designer"), "tokens.radius");
    const source = draft.source.replace("links: []", `links: [${trait.ref}]`).replace("## Rationale\n", `## Rationale\n- Realises ${trait.id}: A restrained radius carries deliberate clarity.\n`);
    profile.parseLibraryCell(source, draft.path);
    await writeFile(join(agentRoot(root, "designer"), draft.path), source);
    const initial = (await run(["--check"])).result as any;
    expect(initial.coverage.find((row: any) => row.trait === trait.id).cells).toEqual([]);
    await store.activate(agentRoot(root, "designer"), ["tokens.radius@2"], { confirm: "msg:fixture#U2", beforeActivate: (context: any) => context.cells.forEach((cell: any) => profile.parseLibraryCell(cell.source, cell.path)) });
    const activated = (await run(["--check"])).result as any;
    expect(activated.coverage.find((row: any) => row.trait === trait.id).cells).toEqual(["tokens.radius@2"]);
    const active = join(agentRoot(root, "designer"), draft.path);
    await writeFile(active, (await readFile(active, "utf8")).replace(`Realises ${trait.id}: A restrained radius carries deliberate clarity.`, `Realises ${trait.id}: `));
    expect(((await run(["--check"])).result as any).coverage.find((row: any) => row.trait === trait.id).cells).toEqual([]);
  });

  it("runs native contrast checks and detects an actual failing colour pair", async () => {
    await designer();
    const path = join(agentRoot(root, "designer"), "cells/tokens.text-color/v1.md");
    const profile = await agentModule("designer", "library-cli/cells.js");
    const source = await readFile(path, "utf8"), parsed = profile.parseLibraryCell(source, "cells/tokens.text-color/v1.md");
    const token = parsed.fill.tokens["text-color"].primary;
    token.$value = { colorSpace: "srgb", components: [1, 1, 1] };
    token.$extensions["com.clossys.css"] = { raw: "#ffffff" };
    await writeFile(path, source.slice(0, source.indexOf("```json") + 8) + JSON.stringify(parsed.fill, null, 2) + "\n```\n");
    const result = await run(["--check"]);
    expect(result.exitCode).toBe(1);
    expect(result.result).toMatchObject({ findings: expect.arrayContaining([expect.objectContaining({ code: "native-C9", message: expect.stringContaining("needs") })]), contrast: { boundPairs: expect.any(Number) } });
  });

  it("compiles actual active native selections and preserves drafts and Director bytes", async () => {
    await designer();
    const beforeDirector = await snapshot(agentRoot(root, "director"));
    const store = await agentModule("director", "cell-format/index.js");
    const draft = await store.propose(agentRoot(root, "designer"), "tokens.radius");
    await writeFile(join(agentRoot(root, "designer"), draft.path), draft.source.replace("## Rationale\n", "## Rationale\n- Unconfirmed proposal remains draft.\n"));
    const authored = await snapshot(join(agentRoot(root, "designer"), "cells"));
    expect(await run([])).toMatchObject({ exitCode: 0 });
    const selection = JSON.parse(await readFile(join(agentRoot(root, "designer"), "compiled/selection.json"), "utf8"));
    expect(selection.slots.find((slot: any) => slot.slot === "tokens.radius").rationale).toBeNull();
    expect(JSON.parse(await readFile(join(agentRoot(root, "designer"), "compiled/fills/tokens.radius.json"), "utf8")).tokens.radius).toBeDefined();
    expect(await snapshot(join(agentRoot(root, "designer"), "cells"))).toEqual(authored);
    expect(await snapshot(agentRoot(root, "director"))).toEqual(beforeDirector);
    const before = await snapshot();
    expect((await run([])).exitCode).toBe(0);
    expect(await snapshot()).toEqual(before);
  });

  it("binds --root, runs the compiled bin, and rejects invalid brief flag combinations", async () => {
    const nested = join(root, "nested"); await mkdir(nested);
    expect(await runCli(["design", "--brief", "--root", "..", "--json"], nested)).toMatchObject({ exitCode: 0, verb: "design", root });
    const entry = fileURLToPath(new URL("../../dist/cli/index.js", import.meta.url));
    const result = spawnSync(process.execPath, [entry, "design", "--brief", "--root", root, "--json"], { encoding: "utf8" });
    expect(result.status).toBe(0); expect(JSON.parse(result.stdout)).toMatchObject({ result: { agent: "designer" } });
    for (const args of [["design", "--check", "--brief"], ["produce", "--brief"], ["direct", "--brief"], ["publish", "--brief"]]) expect(() => parseArgs(args)).toThrow();
    expect(parseArgs(["write", "--brief"])).toMatchObject({ brief: true });
  });

  it("refuses symlinked cell roots", async () => {
    await designer();
    const path = agentRoot(root, "designer"), elsewhere = join(root, "held-designer");
    await cp(path, elsewhere, { recursive: true }); await rm(path, { recursive: true }); await symlink(elsewhere, path);
    expect(await run(["--check"])).toMatchObject({ exitCode: 2, message: expect.stringContaining("Symbolic links") });
    expect(await run([])).toMatchObject({ exitCode: 2 });
  });
});
