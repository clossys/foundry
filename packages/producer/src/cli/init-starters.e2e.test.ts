/**
 * foundry-build-0048 SITE-PUBLICATION, end to end: `clossys init --starters site` seats the site publication and its
 * routed pages in a consumer workspace the way init seats the admin workspace: through clossys ia, from the Publisher
 * package's page archetypes, with one slot request for each cited slot the workspace lacks and no candidate or pin.
 * A rerun is a no-op, byte for byte.
 * Synthetic fixture consumer: a tmp workspace (`clossys/clossys.config.ts` only) on the installed packages.
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ADMIN_SEATED, NOT_OPTED_IN } from "../check/admin-seated.js";
import { listRequests } from "../records/request.js";
import { listSlots } from "../records/slots.js";
import { adminPlan, readAdminSlot } from "./admin-plan.js";
import { runInitCli } from "./init.js";
import type { StarterSeat } from "./init-starters.js";
import { runCli } from "./main.js";
import { starterContract, starterPlan, starterUnder } from "./starter-plan.js";

const AT = "2026-11-21T09:00:00Z";
const ROUTED = ["page.home", "page.about", "page.pricing", "page.contact", "page.site-page", "page.terms", "page.privacy"];
const SEATED = [...ROUTED, "publication.site"];
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function workspace(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "init-starters-")));
  roots.push(root);
  mkdirSync(join(root, "clossys"), { recursive: true });
  writeFileSync(join(root, "clossys", "clossys.config.ts"), "export default {};\n");
  return root;
}
const seatOf = (output: unknown): StarterSeat => (output as { starters: StarterSeat[] }).starters[0]!;
const view = (root: string, id: string) => readAdminSlot(join(root, "clossys", "agents", "publisher", id))!;
/** Every file under the workspace, by path, with its bytes: a no-op rerun leaves it equal. */
function tree(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (dir: string) => {
    for (const name of readdirSync(dir).sort()) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else out[relative(root, path)] = readFileSync(path, "utf8");
    }
  };
  walk(root);
  return out;
}
const iaGroups = (root: string) => {
  const ia = JSON.parse(readFileSync(join(root, "clossys", "agents", "publisher", "ia.json"), "utf8")) as { nodes: { id: string; children: { id: string; slots: string[] }[] }[] };
  return ia.nodes.flatMap(l1 => l1.children.map(l2 => [`${l1.id}/${l2.id}`, l2.slots] as const));
};
const adopt = async (root: string, agents: readonly string[]) => {
  for (const agent of agents) {
    const adopted = await runCli(["ia", agent, "--adopt", "--root", root]);
    expect(adopted.exitCode, adopted.message).toBe(0);
  }
};

describe("clossys init --starters site", () => {
  it("seats the seven routed pages and publication.site in the site tab, raises every cited slot the workspace lacks, and a rerun is a no-op", async () => {
    const root = workspace();
    const result = await runCli(["init", "--starters", "site", "--at", AT, "--root", root]);
    expect(result.exitCode, result.message).toBe(0);
    const seat = seatOf(result.output);
    expect(seat.placed).toEqual(SEATED);
    expect(seat.rewired).toEqual([]);
    expect(seat.held.map(page => page.id)).toEqual(["page.not-found", "page.error"]);
    const plan = starterPlan(root, "site");
    expect(iaGroups(root).filter(([under]) => under.startsWith("site/"))).toEqual(SEATED.map(slot => [starterUnder(plan, slot), [slot]]));
    for (const slot of SEATED) {
      const read = view(root, slot);
      expect(JSON.parse(readFileSync(join(root, "clossys", "agents", "publisher", slot, "slot.json"), "utf8")).schema, slot).toBe("clossys.slot/2");
      expect(read.doc.standard, slot).toBe(slot === "publication.site" ? "publication" : "page");
      expect(read.doc.contract, slot).toEqual(starterContract(plan, slot));
    }
    // A bare workspace holds no Designer or Writer slot: the pages cite nothing, the publication cites its pages.
    for (const page of ROUTED) expect([view(root, page).doc.inputs, view(root, page).doc.uses], page).toEqual([[], []]);
    expect(view(root, "publication.site").doc.inputs).toEqual(ROUTED);
    // One request per cited slot, to its own agent (frames and sections to the Designer, copy to the Writer).
    const designer = [...new Set(plan.pages.flatMap(page => page.uses))].map(id => `designer/${id}`);
    const writer = [...new Set(plan.pages.flatMap(page => page.copy))].map(id => `writer/${id}`);
    expect(seat.requests.map(request => request.target).sort()).toEqual([...designer, ...writer].sort());
    expect(seat.requests.every(request => request.from === "owner")).toBe(true);
    // A default init seats no admin starter (CP1-U2), so no admin request precedes the site's: each one is new.
    expect(seat.requests.every(request => request.created)).toBe(true);
    const consumer = join(root, "clossys");
    const entries = listRequests(consumer).map(read => read.request!).filter(request => seat.requests.some(item => item.id === request.id));
    expect(entries).toHaveLength(seat.requests.length);
    for (const entry of entries) {
      expect([entry.kind, entry.status, entry.source], entry.target).toEqual(["slot", "open", "ia"]);
      expect(entry.rel, entry.target).toBe(entry.target.startsWith("designer/") ? "uses" : "input");
      const site = /^the site publication \(page\.[a-z-]+(, page\.[a-z-]+)*\) (composes|reads) .+, which no workspace slot holds$/;
      const created = seat.requests.find(item => item.id === entry.id)!.created;
      if (created) expect(entry.why, entry.target).toMatch(site);
      else expect(entry.events.filter(event => event.op === "raised").map(event => event.detail).filter(detail => site.test(detail ?? "")), entry.target).toHaveLength(1);
    }
    // No candidate and no pin: each page is its agent's first fill.
    for (const entry of listSlots(consumer, "publisher").filter(each => SEATED.includes(each.id))) expect([entry.id, entry.candidates, entry.pin]).toEqual([entry.id, [], null]);
    expect(seat.unfilled).toEqual(ROUTED);
    expect(result.message).toContain("seated the site publication: 8 Publisher slots placed");
    expect(result.message).toContain(`raised ${seat.requests.filter(request => request.created).length} slot requests for site units no workspace slot holds`);
    expect(result.message).toContain("held publisher/page.not-found: a status page (404) has no route");
    // The site seat does not seat the admin starter: the consumer opts in with --starters admin (CP1-U2).
    const check = await runCli(["check", "--root", root]);
    expect(check.message).toContain(`${ADMIN_SEATED}: skip (${NOT_OPTED_IN})`);
    expect(adminPlan(root).pages.filter(page => existsSync(join(root, "clossys", "agents", "publisher", page.id)))).toEqual([]);

    const before = tree(root);
    const again = await runCli(["init", "--starters", "site", "--at", "2026-11-21T10:00:00Z", "--root", root]);
    expect(again.exitCode, again.message).toBe(0);
    const second = seatOf(again.output);
    expect([second.placed, second.rewired]).toEqual([[], []]);
    expect(second.requests.map(request => request.id)).toEqual(seat.requests.map(request => request.id));
    expect(second.requests.every(request => !request.created)).toBe(true);
    expect(again.message).toContain("the site publication is already seated");
    expect(again.message).not.toContain("raised ");
    expect(tree(root)).toEqual(before);
  }, 180_000);

  it("cites every slot the workspace holds once the Director, Designer and Writer IAs are adopted, and raises nothing", async () => {
    const root = workspace();
    await adopt(root, ["director", "designer", "writer"]);
    const result = await runInitCli(["--starters", "site", "--at", AT], root);
    expect(result.exitCode, result.message).toBe(0);
    const seat = seatOf(result.output);
    expect(seat.placed).toEqual(SEATED);
    expect(seat.requests).toEqual([]);
    for (const page of starterPlan(root, "site").pages) {
      expect(view(root, page.id).doc.inputs, page.id).toEqual(page.cites);
      expect(view(root, page.id).doc.uses, page.id).toEqual(page.cites);
    }
    const check = await runCli(["check", "--root", root]);
    expect(check.message).toContain(`${ADMIN_SEATED}: skip (${NOT_OPTED_IN})`);
    expect(check.message).not.toMatch(/agents\/publisher\/(page\.(home|about|pricing|contact|site-page|terms|privacy)|publication\.site)\/slot\.json \[/);
    const before = tree(root);
    const again = await runInitCli(["--starters", "site", "--at", "2026-11-21T10:00:00Z"], root);
    expect(again.exitCode, again.message).toBe(0);
    expect([seatOf(again.output).placed, seatOf(again.output).rewired, seatOf(again.output).requests]).toEqual([[], [], []]);
    expect(tree(root)).toEqual(before);
  }, 240_000);

  it("rewires on a rerun: seated bare, then the Designer and Writer adopt, then init again cites every held slot", async () => {
    const root = workspace();
    expect((await runInitCli(["--starters", "site", "--at", AT], root)).exitCode).toBe(0);
    await adopt(root, ["director", "designer", "writer"]);
    const again = await runInitCli(["--starters", "site", "--at", "2026-11-21T10:00:00Z"], root);
    expect(again.exitCode, again.message).toBe(0);
    const seat = seatOf(again.output);
    expect(seat.placed).toEqual([]);
    expect(seat.rewired).toEqual(ROUTED);
    for (const page of starterPlan(root, "site").pages) expect(view(root, page.id).doc.inputs, page.id).toEqual(page.cites);
    expect(again.message).toContain(`rewired 7 site slots to the slots the workspace now holds: ${ROUTED.join(", ")}`);
  }, 240_000);

  it("restores a tampered page contract to its archetype on a rerun", async () => {
    const root = workspace();
    expect((await runInitCli(["--starters", "site", "--at", AT], root)).exitCode).toBe(0);
    const file = join(root, "clossys", "agents", "publisher", "page.about", "slot.json");
    const doc = JSON.parse(readFileSync(file, "utf8")) as Record<string, any>;
    doc.contract.route = "/company";
    writeFileSync(file, `${JSON.stringify(doc, null, 2)}\n`);
    const again = await runInitCli(["--starters", "site", "--at", "2026-11-21T10:00:00Z"], root);
    expect(again.exitCode, again.message).toBe(0);
    expect(seatOf(again.output).rewired).toEqual(["page.about"]);
    expect(view(root, "page.about").doc.contract).toEqual(starterContract(starterPlan(root, "site"), "page.about"));
  }, 180_000);

  it("plain init seats no site page", async () => {
    const root = workspace();
    const result = await runInitCli(["--at", AT], root);
    expect(result.exitCode, result.message).toBe(0);
    expect((result.output as { starters?: unknown }).starters).toBeUndefined();
    expect(listSlots(join(root, "clossys"), "publisher").map(entry => entry.id).filter(id => SEATED.includes(id))).toEqual([]);
  }, 120_000);
});
