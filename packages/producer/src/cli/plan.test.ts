import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runCli } from "./main.js";
import { contentPlan, PLAN_USAGE, PlanError, RELEASE_REF, RELEASE_SLOT } from "./plan.js";
import { starterPlan } from "./starter-plan.js";

// The plan runs the real ia, request and pinned readers on a scratch copy of the fixture consumer.
vi.setConfig({ testTimeout: 120_000 });

const FIXTURE = fileURLToPath(new URL("../../test-fixtures/consumer/", import.meta.url));
const AT = "2026-11-26T10:00:00Z";
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

/** The release's own requirement, as the Director catalog's release cell states it (strategy.json). */
const SCOPE_CHECK = { check: "brief.release-scope", params: { kinds: ["site", "docs", "slides", "video", "image set"], stages: ["launch", "mvp", "growth", "mature"], capStages: ["launch", "mvp"], pageCap: 8, need: "context.customer.need" } };
const SCOPE = "site (home, pricing, contact, faq, not-found): launch site that shows founders the claim export; docs (quickstart): launch guide so founders set up exports alone";
const body = (scope: string) => [
  "## Direction", "- Release: claim export for the six insurers", "- Stage: launch", "- Target date: 2026-12-15", `- Scope: ${scope}`, "- Not in scope: slides, video, customer stories",
  "", "## Because", "- Founders lose a week a month to manual claims (director:context.customer.need).", "- Founders arrive from search (director:focus.reach.channel).",
  "", "## Watch", "- If signups fall below 20 by 2027-01-15, then review the launch site with the owner.", "",
].join("\n");

/** Every file under a folder, as bytes. */
function bytes(dir: string, base = dir, out: Record<string, string> = {}): Record<string, string> {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) bytes(path, base, out); else out[path.slice(base.length + 1).split(sep).join("/")] = readFileSync(path, "latin1");
  }
  return out;
}

/** The agent author a fixture Director candidate records (its skill and that skill's sha256), reused for the release. */
function fixtureAuthor(consumer: string): unknown {
  const text = readFileSync(join(consumer, "agents/director/focus.lifecycle.acquisition/candidates/acquisition-v1.md"), "utf8");
  return (JSON.parse(/^clossys: (.*)$/m.exec(text)![1]!) as { createdBy: unknown }).createdBy;
}

/**
 * A scratch consumer whose Director release is pinned: its contract gains the release requirement through `clossys ia`,
 * then a release candidate and its pin are laid down the way the fixture world's pins are (planner basis). Without
 * `publisher`, the copy holds no Publisher slot, so every proposal is a new placement.
 */
async function world(options: { publisher?: boolean; scope?: string; requirement?: boolean } = {}): Promise<{ root: string; consumer: string }> {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "clossys-plan-")));
  roots.push(root);
  const publisher = `${sep}clossys${sep}agents${sep}publisher`;
  cpSync(FIXTURE, root, { recursive: true, filter: source => options.publisher !== false || !source.includes(publisher) });
  const consumer = join(root, "clossys");
  // Every init starts the Publisher IA; a copy with no Publisher slot is a freshly initialised consumer.
  if (options.publisher === false) expect((await runCli(["ia", "publisher", "--start", "--root", root], root)).exitCode).toBe(0);
  const dir = join(consumer, "agents/director", RELEASE_SLOT);
  const slot = JSON.parse(readFileSync(join(dir, "slot.json"), "utf8")) as { contract: Record<string, unknown> };
  if (options.requirement !== false) {
    const contract = { ...slot.contract, requirements: [...(slot.contract.requirements as unknown[]), SCOPE_CHECK] };
    const file = join(root, "release-contract.json");
    writeFileSync(file, `${JSON.stringify(contract, null, 2)}\n`);
    const placed = await runCli(["ia", RELEASE_REF, "--contract", file, "--standard", "brief.list", "--root", root], root);
    expect(placed.exitCode, placed.message).toBe(0);
    rmSync(file);
  }
  const name = "release-v1.md";
  const header = { schema: "clossys.candidate/1", id: `${RELEASE_REF}/${name}`, agent: "director", kind: "candidate", status: "submitted", slot: RELEASE_REF,
    createdBy: fixtureAuthor(consumer), createdAt: AT, refs: [],
    source: { kind: "derived", ref: ["director:context.customer.need", "director:focus.reach.channel"] }, rationale: [] };
  const text = `---\nclossys: ${JSON.stringify(header)}\nslot: "${RELEASE_SLOT}"\nfeeds: []\nfunctions: []\n---\n${body(options.scope ?? SCOPE)}`;
  mkdirSync(join(dir, "candidates"), { recursive: true });
  writeFileSync(join(dir, "candidates", name), text);
  const pin = { schema: "clossys.pin/2", id: `${RELEASE_REF}/pin`, agent: "director", kind: "pin", status: "confirm", createdBy: { actor: "code", cli: "clossys pin", version: "0.1.0" }, createdAt: AT, updatedAt: AT,
    refs: [{ to: "producer/checks.scorecard", rel: "cites", record: RELEASE_REF, sha256: "0".repeat(64) }], candidate: name, sha256: createHash("sha256").update(text).digest("hex"), decidedBy: "planner:fixture-world", basis: "planner", at: AT };
  writeFileSync(join(dir, "pin.json"), `${JSON.stringify(pin, null, 2)}\n`);
  return { root, consumer };
}

describe("clossys plan (CP1-PLAN)", () => {
  it("plan proposes only menu-served placements with director input refs", async () => {
    const site = starterPlan(FIXTURE, "site");
    const menu = new Set([...site.pages.map(page => page.id), site.publication]);
    // A consumer that places no Publisher slot: every served page and its publication is a new placement.
    const fresh = await world({ publisher: false });
    const plan = contentPlan(fresh.root);
    expect(plan.stage).toBe("launch");
    expect(plan.placements.map(item => item.slot)).toEqual(["page.home", "page.pricing", "page.contact", "publication.site"]);
    for (const item of plan.placements) {
      expect(menu.has(item.slot), item.slot).toBe(true);
      expect(item.inputs[0], item.slot).toBe(RELEASE_SLOT);
      expect(item.command, item.slot).toMatch(new RegExp(`^clossys ia publisher/${item.slot.replace(".", "\\.")} --contract <dir>/${item.slot.replace(".", "\\.")}\\.json --standard ${item.kind} --under site/\\S+ --kind ${item.kind} --inputs ${RELEASE_SLOT}[,\\s]`));
      expect(item.contract, item.slot).toBeDefined();
    }
    // The publication lists only the pages the release asks for.
    expect(plan.placements.at(-1)!.contract).toMatchObject({ kind: "publication", pages: ["page.home", "page.pricing", "page.contact"] });
    // What the menu cannot serve is reported, never invented: a page with no archetype, a held status page, a kind with no starter.
    expect(plan.unserved.map(item => [item.page ?? item.row.split(" ")[0], item.reason.split(":")[0]])).toEqual([["faq", "the site starter has no page.faq archetype (it has home, about, pricing, contact, site-page, terms, privacy)"], ["not-found", "held"], ["docs", "no seatable docs starter"]]);
    expect(plan.notInScope).toEqual(["slides", "video", "customer stories"]);

    // Applied after approval, the lines are real ia placements: each placed slot reads the release.
    const dir = mkdtempSync(join(fresh.root, "plan-contracts-"));
    for (const item of plan.placements) {
      writeFileSync(join(dir, `${item.slot}.json`), `${JSON.stringify(item.contract, null, 2)}\n`);
      const argv = item.command.replace(/^clossys /, "").replace("<dir>", dir).split(" ");
      const applied = await runCli([...argv, "--root", fresh.root], fresh.root);
      expect(applied.exitCode, `${item.command}: ${applied.message}`).toBe(0);
      const doc = JSON.parse(readFileSync(join(fresh.consumer, "agents/publisher", item.slot, "slot.json"), "utf8")) as { refs: { to: string; rel: string }[] };
      expect(doc.refs, item.slot).toContainEqual({ to: RELEASE_REF, rel: "input" });
    }
    // Planned: a second plan proposes nothing more for those rows.
    expect(contentPlan(fresh.root).placements).toEqual([]);

    // A consumer that already places the site pages: each line adds the release input to the placed slot, keeping its own.
    const placed = await world();
    const rewired = contentPlan(placed.root);
    // The fixture places the site pages but no publication slot, so the publication is still a new placement.
    expect(rewired.placements.map(item => [item.slot, item.placed])).toEqual([["page.home", true], ["page.pricing", true], ["page.contact", true], ["publication.site", false]]);
    expect(rewired.placements.at(-1)!.inputs[0]).toBe(RELEASE_SLOT);
    for (const item of rewired.placements.filter(entry => entry.placed)) {
      expect(item.inputs.at(-1), item.slot).toBe(RELEASE_SLOT);
      expect(item.command, item.slot).toMatch(new RegExp(`^clossys ia publisher/${item.slot.replace(".", "\\.")} --standard \\S+ --inputs \\S*${RELEASE_SLOT.replace(/\./g, "\\.")}`));
    }
  });

  it("plan files one owner request and writes nothing else", async () => {
    const { root, consumer } = await world();
    const before = bytes(root);
    const dry = await runCli(["plan", "--dry", "--at", AT, "--root", root], root);
    expect(dry.exitCode, dry.message).toBe(0);
    expect(dry.message).toMatch(/^plan: would file /);
    expect(bytes(root)).toEqual(before);

    const filed = await runCli(["plan", "--at", AT, "--root", root], root);
    expect(filed.exitCode, filed.message).toBe(0);
    const after = bytes(root);
    const touched = Object.keys(after).filter(path => after[path] !== before[path]);
    expect(Object.keys(before).filter(path => !(path in after))).toEqual([]);
    // One record: the request entry. The engine logs that write in its own chain and derived index (clossys/.state/).
    expect(touched.filter(path => path.startsWith("clossys/.state/")).sort()).toEqual(["clossys/.state/events.jsonl", "clossys/.state/index.json"]);
    const changed = touched.filter(path => !path.startsWith("clossys/.state/"));
    expect(changed, JSON.stringify(changed)).toHaveLength(1);
    const entry = JSON.parse(after[changed[0]!]!) as Record<string, any>;
    expect(changed[0]).toMatch(/^clossys\/agents\/producer\/queue\.[a-z]+\/entries\/[^/]+\.json$/);
    expect(entry).toMatchObject({ kind: "change", target: RELEASE_REF, from: "owner", status: "open" });
    expect(entry.assignee).toBe("owner");
    // The proposal rides on the raised event: every ia line, each new slot's contract, and the unserved rows.
    const raised = (entry.events as { op: string; detail?: string }[]).find(event => event.op === "raised")!;
    expect(raised.detail).toContain(`clossys ia publisher/page.home --standard page --inputs`);
    expect(raised.detail).toContain("contract publication.site: ");
    expect(raised.detail).toContain("unserved");
    // Nothing is placed: the Publisher's slots are byte for byte what they were.
    expect(Object.keys(after).filter(path => path.startsWith("clossys/agents/publisher/") && after[path] !== before[path])).toEqual([]);
    expect(consumer).toBe(join(root, "clossys"));
  });

  it("refuses with no fallback: no pinned release, or a release contract with no brief.release-scope", async () => {
    const bare = await world({ requirement: false });
    expect(() => contentPlan(bare.root)).toThrow(PlanError);
    expect(() => contentPlan(bare.root)).toThrow(/states no brief\.release-scope requirement/);
    const refused = await runCli(["plan", "--at", AT, "--root", bare.root], bare.root);
    expect(refused.exitCode).toBe(1);
    expect(refused.message).toMatch(/^plan refused: /);
    const unpinned = realpathSync(mkdtempSync(join(tmpdir(), "clossys-plan-")));
    roots.push(unpinned);
    cpSync(FIXTURE, unpinned, { recursive: true });
    expect(() => contentPlan(unpinned)).toThrow(/is not pinned/);
    // A release with no row places nothing: the scope it states must be plannable first.
    const empty = await world({ scope: "none" });
    expect(() => contentPlan(empty.root)).toThrow(/does not state a plannable scope/);
  });

  it("clossys plan --help names the loop order and the menu", async () => {
    const help = await runCli(["plan", "--help"], FIXTURE);
    expect(help.exitCode).toBe(0);
    expect(help.message).toBe(PLAN_USAGE);
    expect(PLAN_USAGE).toContain("Loop order: Director release, then clossys plan, then the owner approves, then clossys ia.");
    expect(PLAN_USAGE).toContain("(site)");
  });
});
