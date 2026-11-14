import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { readStandard } from "../records/standards.js";
// Load the CLI first, as every caller does: owner.ts sits in an import cycle with the pipeline handlers.
import "./main.js";
import { runIaCli } from "./owner.js";
import { runStandardCli, STANDARD_USAGE } from "./standard.js";

const FIXTURE = fileURLToPath(new URL("../constitution/__fixtures__/standards/fixture-headline/", import.meta.url));
const AT = ["--at", "2026-11-13T00:00:00.000Z"];
const put = (path: string, text: string) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, text); };
function workspace(): string {
  const root = mkdtempSync(join(tmpdir(), "standard-cli-"));
  put(join(root, "clossys", "clossys.config.ts"), "export default {};\n");
  return root;
}
const parts = ["--requirements", join(FIXTURE, "requirements.json"), "--taste", join(FIXTURE, "taste.md"), "--exemplars", join(FIXTURE, "exemplars", "exemplars.json"),
  "--exemplar-file", join(FIXTURE, "exemplars", "plain-claim.md"), "--exemplar-file", join(FIXTURE, "exemplars", "house-voice.md")];
const dirOf = (root: string) => join(root, "packages", "writer", "standards", "fixture-headline");
const events = (root: string) => (JSON.parse(readFileSync(join(dirOf(root), "ledger.json"), "utf8")) as { events: Record<string, unknown>[] }).events;

describe("clossys standard", () => {
  it("writes a new standard by the planner and records every file in one ledger event", async () => {
    const root = workspace();
    const result = await runStandardCli(["writer/fixture-headline", "--by", "planner", ...parts, ...AT], root);
    expect(result.exitCode, result.message).toBe(0);
    const standard = readStandard(root, "writer", "fixture-headline");
    expect(standard.issues).toEqual([]);
    expect(events(root)).toEqual([{ op: "standard", at: "2026-11-13T00:00:00.000Z", by: "planner", verb: "standard", model: "none", tier: "none", standard: { agent: "writer", id: "fixture-headline", sha256: standard.sha256 }, files: standard.files }]);
    // The verb copies bytes: the written standard has the fixture's sha, and its ledger matches the fixture's.
    const copy = workspace();
    cpSync(FIXTURE, dirOf(copy), { recursive: true });
    expect(standard.sha256).toBe(readStandard(copy, "writer", "fixture-headline").sha256);
    expect(events(root)[0]!.files).toEqual(events(copy)[0]!.files);
  });

  it("refuses any author but the owner or the planner, writing nothing", async () => {
    const root = workspace();
    const result = await runStandardCli(["writer/fixture-headline", "--by", "agent:writer", ...parts, ...AT], root);
    expect(result).toMatchObject({ exitCode: 1 });
    expect(result.message).toMatch(/standards change by owner or planner only/);
    expect(existsSync(dirOf(root))).toBe(false);
  });

  it("refuses an invalid standard and rolls every byte back", async () => {
    const root = workspace();
    expect((await runStandardCli(["writer/fixture-headline", "--by", "owner", ...parts, ...AT], root)).exitCode).toBe(0);
    const before = readFileSync(join(dirOf(root), "taste.md"), "utf8");
    const ledger = readFileSync(join(dirOf(root), "ledger.json"), "utf8");
    const bad = join(root, "bad-taste.md");
    put(bad, "## clarity\n- 1: only one anchor\n");
    const result = await runStandardCli(["writer/fixture-headline", "--by", "owner", "--taste", bad, ...AT], root);
    expect(result.exitCode).toBe(1);
    expect(result.message).toMatch(/clarity has no anchor for 2, 3, 4, 5/);
    expect(readFileSync(join(dirOf(root), "taste.md"), "utf8")).toBe(before);
    expect(readFileSync(join(dirOf(root), "ledger.json"), "utf8")).toBe(ledger);
  });

  it("refuses an unregistered requirement on a new standard and leaves no folder behind", async () => {
    const root = workspace();
    const requirements = JSON.parse(readFileSync(join(FIXTURE, "requirements.json"), "utf8")) as { requirements: unknown[] };
    requirements.requirements.push({ check: "text.not-registered", params: {} });
    const file = join(root, "requirements.json");
    put(file, JSON.stringify(requirements));
    const args = [...parts]; args[1] = file;
    const result = await runStandardCli(["writer/fixture-headline", "--by", "planner", ...args, ...AT], root);
    expect(result.exitCode).toBe(1);
    expect(result.message).toMatch(/text\.not-registered is not registered/);
    expect(existsSync(dirOf(root))).toBe(false);
  });

  it("appends an event per change and refuses seeds outside the Designer", async () => {
    const root = workspace();
    expect((await runStandardCli(["writer/fixture-headline", "--by", "planner", ...parts, ...AT], root)).exitCode).toBe(0);
    const taste = join(root, "taste.md");
    put(taste, `${readFileSync(join(FIXTURE, "taste.md"), "utf8")}\n`);
    expect((await runStandardCli(["writer/fixture-headline", "--by", "owner", "--taste", taste, ...AT], root)).exitCode).toBe(0);
    expect(events(root).map(event => event.by)).toEqual(["planner", "owner"]);
    const seeded = join(root, "seeded.json");
    put(seeded, JSON.stringify({ ...JSON.parse(readFileSync(join(FIXTURE, "requirements.json"), "utf8")), seeds: ["shadcn/button"] }));
    const result = await runStandardCli(["writer/fixture-headline", "--by", "owner", "--requirements", seeded, ...AT], root);
    expect(result.message).toMatch(/writer standards list no seeds/);
    expect(events(root)).toHaveLength(2);
  });

  it("checks its arguments", async () => {
    const root = workspace();
    expect((await runStandardCli(["--help"], root)).message).toBe(STANDARD_USAGE);
    await expect(runStandardCli(["writer/fixture-headline", ...parts], root)).rejects.toThrow(/--by is required/);
    await expect(runStandardCli(["nobody/x", "--by", "owner"], root)).rejects.toThrow(/standard target must be/);
    await expect(runStandardCli(["writer/fixture-headline", "--by", "owner", "--at", "yesterday"], root)).rejects.toThrow(/--at must be an ISO timestamp/);
    expect((await runStandardCli(["writer/fixture-headline", "--by", "owner"], root)).message).toMatch(/does not exist; a new standard needs/);
  });
});

describe("clossys ia --standard", () => {
  async function placed(): Promise<string> {
    const root = workspace();
    expect((await runIaCli(["writer", "--start"], root)).exitCode).toBe(0);
    const contract = join(root, "contract.json");
    put(contract, JSON.stringify({ summary: "strings home.hero", fixture: { keys: ["title"], locales: ["en"] } }));
    const result = await runIaCli(["writer/home.hero", "--contract", contract, "--under", "copy/hero", "--kind", "strings"], root);
    expect(result.exitCode, result.message).toBe(0);
    return root;
  }
  const slotJson = (root: string) => JSON.parse(readFileSync(join(root, "clossys", "agents", "writer", "home.hero", "slot.json"), "utf8")) as Record<string, unknown>;

  it("names an existing standard of the slot's kind, keeping the written contract", async () => {
    const root = await placed();
    const contract = slotJson(root).contract;
    expect((await runIaCli(["writer/home.hero", "--standard", "fixture-headline"], root)).message).toMatch(/standard fixture-headline does not exist under packages\/writer\/standards/);
    cpSync(FIXTURE, dirOf(root), { recursive: true });
    const result = await runIaCli(["writer/home.hero", "--standard", "fixture-headline"], root);
    expect(result.exitCode, result.message).toBe(0);
    expect(result.message).toMatch(/standard fixture-headline named/);
    expect(slotJson(root)).toMatchObject({ standard: "fixture-headline", contract });
  });

  it("refuses a standard of another kind or an invalid one, and a bad id", async () => {
    const root = await placed();
    cpSync(FIXTURE, dirOf(root), { recursive: true });
    const requirements = join(dirOf(root), "requirements.json");
    put(requirements, readFileSync(requirements, "utf8").replace("\"strings\"", "\"element\""));
    expect((await runIaCli(["writer/home.hero", "--standard", "fixture-headline"], root)).message).toMatch(/serves element, not strings/);
    rmSync(join(dirOf(root), "taste.md"));
    expect((await runIaCli(["writer/home.hero", "--standard", "fixture-headline"], root)).message).toMatch(/is not valid: no taste\.md/);
    await expect(runIaCli(["writer/home.hero", "--standard", "Bad Id"], root)).rejects.toThrow(/--standard must be a standard id/);
    expect(slotJson(root).standard).toBeUndefined();
  });

  it("writes a contract and a standard together", async () => {
    const root = await placed();
    cpSync(FIXTURE, dirOf(root), { recursive: true });
    const contract = join(root, "contract2.json");
    put(contract, JSON.stringify({ summary: "strings home.hero v2", fixture: { keys: ["title"], locales: ["en"] } }));
    const result = await runIaCli(["writer/home.hero", "--contract", contract, "--standard", "fixture-headline"], root);
    expect(result.exitCode, result.message).toBe(0);
    expect(slotJson(root)).toMatchObject({ standard: "fixture-headline", contract: { summary: "strings home.hero v2" } });
  });
});
