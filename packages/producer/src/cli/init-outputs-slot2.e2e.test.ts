/**
 * foundry-build-0048 U18 round 1 (B1): `clossys init --publication` submits its candidate through the one
 * guarded candidates verb (`clossys next --submit`) on a clossys.slot/2 publication, so the candidate it
 * writes carries real submit provenance, passes the CHOOSE gate (`clossys pin`) and the strict
 * constitution run, and the write guard and the symlinked-candidates refusal apply to it.
 * Synthetic: a tmp copy of test-fixtures/consumer-legacy-tree recut to slot/2 (as publication-slot2.e2e.test.ts).
 */
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ADMIN_SEATED, adminSeatedSummary, NOT_OPTED_IN, runAdminSeated } from "../check/admin-seated.js";
import { recutCandidateBytes } from "../migrate/recut.js";
import { PRODUCER_ROOT } from "../package-path.js";
import { writeTargetPin } from "../records/pin-map.js";
import { cliActor } from "../records/pin.js";
import { STEPS } from "../pipeline/steps/index.js";
import { ADMIN_PUBLICATION_SLOT } from "./admin-plan.js";
import { INIT_USAGE } from "./init.js";
import { initPublicationOutputs, InitOutputsRefusal } from "./init-outputs.js";
import { runCli } from "./main.js";

const AT = "2026-11-18T10:00:00Z";
const BY = "planner:foundry-build-0048";
const INSTALL = join(PRODUCER_ROOT, "src", "publish", "__fixtures__", "install-consumer", "clossys", "agents");
const SKILL = STEPS.find(step => step.id === "publisher.candidates")!.command.skill!;
const SUBMIT = ["--model", "fixture-model", "--tier", "mid", "--basis", "agent", "--skill", SKILL];
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const readJson = (file: string) => JSON.parse(readFileSync(file, "utf8"));

const PUBLICATION = {
  schema: "clossys.publication/1", format: "web.page.responsive", entryOrder: ["home"], routePack: { packId: "fixture-site", homeRouteId: "home" },
  meta: { source: { kind: "derived", ref: ["publisher:fixture"] }, tree: { id: "site", name: "site.publication", children: [{ id: "site.pages", name: "site.pages", cells: ["page.home"] }] } },
};

/** A recut slot/2 store whose publication `site` was created (P1 create verdict), submitted and pinned through the gate. */
async function store() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "init-outputs-slot2-")));
  roots.push(root);
  cpSync(join(PRODUCER_ROOT, "test-fixtures", "consumer-legacy-tree", "clossys"), join(root, "clossys"), { recursive: true });
  execFileSync("git", ["init", "-q"], { cwd: root });
  const agent = (...rest: string[]) => join(root, "clossys", "agents", ...rest);
  const file = (name: string, value: unknown) => { const path = join(root, name); writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`); return path; };
  const run = async (...args: string[]) => {
    const result = await runCli([...args, "--root", root]);
    expect(result.exitCode, `clossys ${args.join(" ")}: ${result.message}`).toBe(0);
    return result;
  };
  await run("migrate", "recut", "--apply", "--at", AT);
  await run("ia", "publisher/page.home", "--contract", file("page.json", { kind: "page", route: "/", frame: "required", sections: "ordered", requirements: [{ check: "page.assembled" }] }), "--standard", "page", "--under", "site/site-pages", "--kind", "page", "--at", AT);
  await run("ia", "writer/strings.site", "--contract", file("strings.json", { requirements: [{ check: "copy.entries" }] }), "--under", "copy.page-metadata/site", "--kind", "strings", "--at", AT);
  await run("ia", "publisher/publication.site", "--contract", file("publication.json", { kind: "publication", fixture: { route: { path: "/" } }, requirements: [{ check: "publication.routes" }] }), "--standard", "publication", "--under", "site/site-pages", "--kind", "publication", "--inputs", "strings.site", "--uses", "page.home", "--at", AT);
  // The publication's pinned upstream (fixture setup, not under test): the page it uses and the Writer strings it reads,
  // each pinned by the pin writer directly. The guarded pin refuses a publication over an unpinned upstream (R02.2).
  const page = "page-v1.json";
  const pageFile = agent("publisher", "page.home", "candidates", page);
  mkdirSync(join(pageFile, ".."), { recursive: true });
  cpSync(join(INSTALL, "publisher", "page.home", "candidates", page), pageFile);
  writeTargetPin(root, { agent: "publisher", slotId: "page.home", candidate: page, decidedBy: BY, basis: "planner", at: AT, createdBy: cliActor("clossys pin") } as never);
  const strings = "site-v1.md";
  const stringsFile = agent("writer", "strings.site", "candidates", strings);
  mkdirSync(join(stringsFile, ".."), { recursive: true });
  writeFileSync(stringsFile, recutCandidateBytes(strings, readFileSync(join(INSTALL, "writer", "strings.site", "candidates", "site-v2.md"), "utf8"),
    { agent: "writer", slotId: "strings.site", at: AT, version: "0.0.0", sourceRef: `agents/writer/strings.site/candidates/${strings}` } as never));
  writeTargetPin(root, { agent: "writer", slotId: "strings.site", record: "site", candidate: strings, decidedBy: BY, basis: "planner", at: AT, createdBy: cliActor("clossys pin") } as never);
  // P2 for each candidate (section 5b): brief, three diverging directions, render, then a critique record named for it.
  const crafted = async (slot: string, candidate: string) => {
    const at = (name: string, value: unknown) => file(`${slot}.${name}.json`, value);
    const craft = ["--model", "fixture-model", "--tier", "mid", "--skill", SKILL];
    await run("next", `publisher/${slot}`, "--stage", "brief", ...craft, "--file", at("brief", { goal: "fixture: one route" }));
    // Code chose the run's recipe at brief (its assembled recipe): every direction takes a distinct value on each of its axes.
    const briefed = (readJson(agent("publisher", slot, "ledger.json")) as { events: { op: string; assembled?: { recipe?: { axes?: string[] } } }[] }).events.filter(event => event.op === "craft:brief").at(-1);
    const axes = briefed?.assembled?.recipe?.axes ?? [];
    await run("next", `publisher/${slot}`, "--stage", "diverge", ...craft, "--file", at("diverge", ["flat", "nested", "hub"].map((shape, index) => ({ id: `d${index + 1}`, idea: `a ${shape} route tree`, axes: { shape, ...Object.fromEntries(axes.map(axis => [axis, `${axis}-${shape}`])) } }))));
    await run("next", `publisher/${slot}`, "--stage", "render", ...craft);
    writeFileSync(join(root, "render.png"), "fixture render");
    const manifest = [{ role: "taste", ref: "packages/publisher/standards/publication/taste.md" }, { role: "contract", ref: `clossys/agents/publisher/${slot}/slot.json#contract` }, { role: "render", ref: "render.png" }];
    await run("critique", `publisher/${slot}`, "--record", at("critique", { schema: "clossys.critique/1", slot, candidate, standard: "publication", scores: { findability: 4 }, packet: { manifest } }), "--model", "fixture-critic", "--tier", "mid", "--at", AT);
  };
  // The publication comes in through the verbs: a P1 create verdict, a crafted create submit, a gated pin.
  const verdict = file("verdict.json", { schema: "clossys.verdict/1", slot: "publication.site", create: true, reason: "fixture: no publication yet", gaps: [{ id: "findability" }] });
  await run("verdict", "publisher/publication.site", "--record", verdict, "--model", "fixture-model", "--tier", "mid", "--by", "agent:publisher.verdict", "--at", AT);
  await crafted("publication.site", "site-v1.json");
  await run("next", "publisher/publication.site", "--submit", file("site.json", PUBLICATION), ...SUBMIT, "--rung", "create", "--reason", "fixture: no seed publication");
  await run("pin", "publisher/publication.site", "site-v1.json", "--by", BY, "--at", AT);
  // init's candidate is the next P2 run's.
  await crafted("publication.site", "site-v2.json");
  const events = () => (readJson(agent("publisher", "publication.site", "ledger.json")) as { events: Record<string, unknown>[] }).events;
  return { root, agent, run, events };
}

const strict = (root: string) => runCli(["check", "--constitution", "--strict", "--slot", "publisher/publication.site", "--root", root]);
/** The finding rows (rule id, then subject), without the per-rule summary lines. */
const rows = (message: string) => message.split("\n").filter(line => /^  R\d+\.\d+ /.test(line));
const INIT = ["init", "--publication", "site", "--forms", "contact", "--origin", "https://example.test", ...SUBMIT];

describe("init --publication submits through the guarded candidates verb (slot/2)", () => {
  it("writes a candidate with submit provenance that passes the CHOOSE gate and the strict constitution run", async () => {
    const s = await store();
    const before = await strict(s.root);
    const result = await s.run(...INIT);
    expect(result.output).toMatchObject({ slot: "publication.site", candidate: "site-v2.json" });
    expect(s.events().at(-1)).toMatchObject({
      op: "submit", name: "site-v2.json", by: "agent:publisher.candidates", model: "fixture-model", tier: "mid",
      rung: "adapt", seed: "publication.site/site-v1.json", skill: { path: SKILL },
    });
    expect(readJson(s.agent("publisher", "publication.site", "candidates", "site-v2.json")).outputs).toMatchObject({ origin: "https://example.test", forms: [{ id: "contact" }] });
    await s.run("pin", "publisher/publication.site", "site-v2.json", "--by", BY, "--at", AT);
    expect(readJson(s.agent("publisher", "publication.site", "pin.json"))).toMatchObject({ schema: "clossys.pin/2", candidate: "site-v2.json" });
    // The strict constitution run on the slot: no row about the init-written candidate, and no row it did not have before
    // (the slot's remaining rows are the fixture's and the pin verb's own, the same before and after).
    const after = await strict(s.root);
    expect(after.message.split("\n").filter(line => /site-v2/.test(line))).toEqual([]);
    expect(rows(after.message)).toEqual(rows(before.message));
    expect(after.exitCode).toBe(before.exitCode);
    // A second identical init adds no option: the candidates verb's byte-identical refusal.
    const again = await runCli([...INIT, "--root", s.root]);
    expect(again.exitCode).toBe(1);
    expect(again.message).toMatch(/^init --publication refused: .*byte-identical/);
  }, 300_000);

  it("runs plain init first and seats no admin starter, so publisher.admin-seated skips (CP1-U2: the consumer owns its pages)", async () => {
    const s = await store();
    const skip = `${ADMIN_SEATED}: skip (${NOT_OPTED_IN})`;
    // Fresh: the store holds no admin starter slot, and plain init places none.
    expect(adminSeatedSummary(runAdminSeated(s.root))).toBe(skip);
    const result = await s.run(...INIT, "--at", AT);
    expect(result.output).toMatchObject({ slot: "publication.site", candidate: "site-v2.json", init: { outcome: "added", admin: { seated: false } } });
    expect(result.message).toMatch(/^seated no admin page, publication or release: the consumer owns its pages\./);
    expect(result.message).toContain("submitted publisher/publication.site/site-v2.json");
    expect(existsSync(join(s.root, "AGENTS.md"))).toBe(true);
    expect(existsSync(s.agent("publisher", ADMIN_PUBLICATION_SLOT))).toBe(false);
    expect(adminSeatedSummary(runAdminSeated(s.root))).toBe(skip);
    const check = await runCli(["check", "--root", s.root]);
    expect(check.message).toContain(skip);
    // An outputs refusal after plain init still reports it, and still seats nothing.
    const again = await runCli([...INIT, "--root", s.root]);
    expect(again.exitCode).toBe(1);
    expect(again.message).toMatch(/^init --publication refused: .*byte-identical/);
    expect(again.message).toContain("seated no admin page, publication or release");
    expect(adminSeatedSummary(runAdminSeated(s.root))).toBe(skip);
    // A usage error writes nothing at all, seat included; and the usage documents both modes.
    const bare = await store();
    const usage = await runCli(["init", "--publication", "site", "--forms", "webhook", ...SUBMIT, "--root", bare.root]);
    expect(usage.exitCode).not.toBe(0);
    expect(usage.message).toMatch(/--forms: unknown form webhook/);
    expect(existsSync(join(bare.root, "AGENTS.md"))).toBe(false);
    expect(adminSeatedSummary(runAdminSeated(bare.root))).toBe(`${ADMIN_SEATED}: skip (${NOT_OPTED_IN})`);
    // So does a --tier or --basis the submit refuses: checked by the submit's own rule before plain init writes (M1).
    const submits = bare.events().filter(event => event.op === "submit").length;
    for (const [flag, value, pattern] of [["--tier", "bogus", /^init --publication: --tier must be low, mid, high, got bogus\n/], ["--basis", "bogus", /^init --publication: --basis must be agent, owner, planner, got bogus\n/]] as const) {
      const argv = INIT.map((arg, index) => (INIT[index - 1] === flag ? value : arg));
      expect(argv).toContain(value);
      const refused = await runCli([...argv, "--root", bare.root]);
      expect(refused.exitCode, refused.message).toBe(2);
      expect(refused.message).toMatch(pattern);
      expect(refused.message).toContain("Usage: clossys init --publication <id>");
      expect(existsSync(join(bare.root, "AGENTS.md"))).toBe(false);
      expect(adminSeatedSummary(runAdminSeated(bare.root))).toBe(`${ADMIN_SEATED}: skip (${NOT_OPTED_IN})`);
      expect(existsSync(bare.agent("publisher", "publication.site", "candidates", "site-v2.json"))).toBe(false);
      expect(bare.events().filter(event => event.op === "submit").length).toBe(submits);
    }
    expect(INIT_USAGE).toContain("Usage: clossys init [--starters <id,...>] [--root <dir>] [--at <iso>] [--json]");
    expect(INIT_USAGE).toContain("Usage: clossys init --publication <id>");
    expect(INIT_USAGE).toContain("runs plain clossys init first");
  }, 300_000);

  it("a guard finding refuses the init write and undoes it", async () => {
    const outputs = { publication: "site", forms: ["contact"] as const, origin: "https://example.test" };
    const submit = { model: "fixture-model", tier: "mid", basis: "agent", skill: SKILL };
    // The real guard: R06.6 (no two slots hold identical content) finds the candidate this init writes already held by
    // another slot. The same init on a twin store gives that content.
    const twin = await store();
    await initPublicationOutputs(twin.root, outputs, submit);
    const s = await store();
    writeFileSync(s.agent("publisher", "page.home", "candidates", "page-v2.json"), readFileSync(twin.agent("publisher", "publication.site", "candidates", "site-v2.json")));
    const before = s.events().length;
    let refusal: unknown;
    try { await initPublicationOutputs(s.root, outputs, submit); }
    catch (error) { refusal = error; }
    expect(refusal).toBeInstanceOf(InitOutputsRefusal);
    expect((refusal as InitOutputsRefusal).result.output).toMatchObject({ schema: "clossys.next-submit-refused/1", verb: "submit", checks: ["R06.6"] });
    expect((refusal as InitOutputsRefusal).result.message).toMatch(/^init --publication refused: .*R06\.6 identical content .*also held by clossys\/agents\/publisher\/page\.home\/candidates\/page-v2\.json/s);
    expect(existsSync(s.agent("publisher", "publication.site", "candidates", "site-v2.json"))).toBe(false);
    expect(s.events().length).toBe(before);
  }, 300_000);

  it("refuses a symlinked candidates folder", async () => {
    const s = await store();
    const dir = s.agent("publisher", "publication.site", "candidates");
    const elsewhere = join(s.root, "elsewhere");
    renameSync(dir, elsewhere);
    symlinkSync(elsewhere, dir);
    const result = await runCli([...INIT, "--root", s.root]);
    expect(result.exitCode, result.message).toBe(1);
    expect(result.message).toMatch(/^init --publication refused: .*[Ss]ymbolic link/);
    expect(readdirSync(elsewhere)).toEqual(["site-v1.json"]);
    expect(s.events().filter(event => event.op === "submit").map(event => event.name)).toEqual(["site-v1.json"]);
  }, 300_000);

  it("refuses a bad outputs record at submit and at pin (B2)", async () => {
    const s = await store();
    const bad = { ...PUBLICATION, outputs: { origin: "http://example.test", feed: "rss2", extra: 1 } };
    const path = join(s.root, "bad.json");
    writeFileSync(path, `${JSON.stringify(bad, null, 2)}\n`);
    const before = s.events().length;
    const submit = await runCli(["next", "publisher/publication.site", "--submit", path, ...SUBMIT, "--rung", "adapt", "--seed", "publication.site/site-v1.json", "--root", s.root]);
    expect(submit.exitCode, submit.message).toBe(1);
    expect(submit.message).toMatch(/outputs/);
    expect(existsSync(s.agent("publisher", "publication.site", "candidates", "site-v2.json"))).toBe(false);
    expect(s.events().length).toBe(before);
    // A candidate placed by hand (no verb) is refused by the pin writer itself, whatever gate runs before it.
    writeFileSync(s.agent("publisher", "publication.site", "candidates", "site-v2.json"), `${JSON.stringify(bad, null, 2)}\n`);
    expect(() => writeTargetPin(s.root, { agent: "publisher", slotId: "publication.site", candidate: "site-v2.json", decidedBy: BY, basis: "planner", at: AT, createdBy: cliActor("clossys pin") } as never))
      .toThrow(/outputs: unknown key extra/);
    expect(readJson(s.agent("publisher", "publication.site", "pin.json"))).toMatchObject({ candidate: "site-v1.json" });
  }, 300_000);
});
