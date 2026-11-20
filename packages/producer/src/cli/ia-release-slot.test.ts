/**
 * REL-SLOT (foundry-build-0048): `clossys ia publisher/release.<pub> --kind release` creates the release slot that
 * `clossys release <pub>` reads, as a valid clossys.slot/2 slot of kind release, through the ia verb's guarded write
 * and its slot ledger. It is refused for any other agent, an id that is not release.<pub>, another kind on a release id,
 * a publication that does not exist, and a second create. Then the release verbs run on the slot it wrote, and the
 * release slot still refuses a publication record (records/slot-current.ts).
 * Synthetic: the release world (release/__fixtures__/world.ts) with `releaseSlot: false`, so no release slot exists
 * until the verb writes one.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runCli } from "./main.js";
import { runReleaseCli } from "./release.js";
import { clock, releaseWorld, stubBuilder, type ReleaseWorld } from "../release/__fixtures__/world.js";
import { slotReadIssues } from "../records/slot-current.js";
import { STEPS } from "../pipeline/steps/index.js";

const AT = "2026-11-20T09:00:00Z";
const worlds: ReleaseWorld[] = [];
afterEach(() => { for (const world of worlds.splice(0)) world.dispose(); });
const make = (): ReleaseWorld => { const world = releaseWorld({ releaseSlot: false }); worlds.push(world); return world; };

const SLOT = "clossys/agents/publisher/release.site";
const CONTRACT = {
  locales: { from: "director/focus.reach.geography:Language" },
  requirements: [{ check: "release.manifest" }],
  fixture: { route: { path: "/" } },
};
const contract = (world: ReleaseWorld, value: unknown = CONTRACT): string => { world.write("drafts/release.json", `${JSON.stringify(value, null, 2)}\n`); return join(world.root, "drafts/release.json"); };
const ia = (world: ReleaseWorld, target: string, ...rest: string[]) => runCli(["ia", target, "--contract", contract(world), ...rest, "--at", AT, "--root", world.root], world.root);
const create = (world: ReleaseWorld, ...rest: string[]) => ia(world, "publisher/release.site", "--kind", "release", "--standard", "release", "--under", "releases/site", ...rest);
const release = (world: ReleaseWorld, flag: string, now = clock()) => runReleaseCli(["site", flag, "--root", world.root], world.root, { builder: stubBuilder, now });
const json = (world: ReleaseWorld, rel: string) => JSON.parse(world.read(rel)) as Record<string, unknown>;

describe("clossys ia publisher/release.<pub> --kind release creates the release slot (REL-SLOT)", () => {
  it("writes a valid clossys.slot/2 kind release slot through the ia write and its slot ledger", async () => {
    const world = make();
    expect(existsSync(join(world.root, SLOT))).toBe(false);
    const made = await create(world);
    expect(made.exitCode, made.message).toBe(0);
    const doc = json(world, `${SLOT}/slot.json`);
    expect(doc).toMatchObject({ schema: "clossys.slot/2", id: "release.site", agent: "publisher", kind: "release", standard: "release", status: "starter", ia: { l1: "release/releases", l2: "release/releases/site" } });
    expect(doc.contract).toEqual(CONTRACT);
    expect(slotReadIssues(doc, `${SLOT}/slot.json`)).toEqual([]);
    // Placed in the Publisher IA, and recorded in the slot ledger as an ia write naming the bytes it wrote.
    const placed = (json(world, "clossys/agents/publisher/ia.json").nodes as { id: string; children: { id: string; slots: string[] }[] }[])
      .find(node => node.id === "releases")!.children.find(child => child.id === "site")!.slots;
    expect(placed).toEqual(["release.site"]);
    const ledger = world.read(`${SLOT}/ledger.json`);
    expect(ledger).toContain("\"verb\": \"ia\"");
    expect(readdirSync(join(world.root, SLOT)).sort()).toEqual(["ledger.json", "slot.json"]);
  });

  it("refuses another agent, a non-release id, another kind, an unknown publication and a second create, writing nothing", async () => {
    const world = make();
    const designer = await ia(world, "designer/release.site", "--kind", "release", "--under", "sections/sections.story");
    expect(designer.exitCode).toBe(1);
    expect(designer.message).toContain("ia refused: designer/release.site: a release slot is a Publisher slot");
    expect(existsSync(join(world.root, "clossys/agents/designer/release.site"))).toBe(false);

    const id = await ia(world, "publisher/launch.site", "--kind", "release", "--under", "releases/site");
    expect(id.exitCode).toBe(1);
    expect(id.message).toContain("a release slot id is release.<publication>, not launch.site");

    const kind = await ia(world, "publisher/release.site", "--kind", "page", "--under", "releases/site");
    expect(kind.exitCode).toBe(1);
    expect(kind.message).toContain("publisher/release.site is a release slot id: it takes --kind release, not page");
    // No --kind on a release id is still a release slot create, judged by the same rules.
    const blog = await ia(world, "publisher/release.blog", "--under", "releases/site");
    expect(blog.exitCode).toBe(1);
    expect(blog.message).toContain("publisher/release.blog: no publication blog exists");
    expect(existsSync(join(world.root, "clossys/agents/publisher/release.blog"))).toBe(false);
    expect(existsSync(join(world.root, SLOT))).toBe(false);

    expect((await create(world)).exitCode).toBe(0);
    const before = world.read(`${SLOT}/slot.json`), ledger = world.read(`${SLOT}/ledger.json`);
    const again = await ia(world, "publisher/release.site", "--kind", "release");
    expect(again.exitCode).toBe(1);
    expect(again.message).toContain("publisher/release.site already exists: a release slot is created once");
    expect(world.read(`${SLOT}/slot.json`)).toBe(before);
    expect(world.read(`${SLOT}/ledger.json`)).toBe(ledger);
  });

  it("takes a publication placed as publisher/publication.<pub>, and refuses an id the ia.json publication does not name", async () => {
    const world = make();
    const docs = await runCli(["ia", "publisher/publication.docs", "--contract", contract(world, { kind: "publication", requirements: [{ check: "publication.routes" }] }), "--standard", "publication", "--under", "pages/site", "--kind", "publication", "--at", AT, "--root", world.root], world.root);
    expect(docs.exitCode, docs.message).toBe(0);
    const made = await ia(world, "publisher/release.docs", "--kind", "release", "--under", "releases/site");
    expect(made.exitCode, made.message).toBe(0);
    expect(json(world, "clossys/agents/publisher/release.docs/slot.json")).toMatchObject({ schema: "clossys.slot/2", kind: "release", standard: "release" });
    // publisher ia.json names release.site for publication site: release.<other> of site is not site's release slot.
    const ia2 = JSON.parse(world.read("clossys/agents/publisher/ia.json"));
    ia2.publications.site.release = "release.main";
    world.write("clossys/agents/publisher/ia.json", `${JSON.stringify(ia2, null, 2)}\n`);
    const wrong = await create(world);
    expect(wrong.exitCode).toBe(1);
    expect(wrong.message).toContain("publication site names its release slot publisher/release.main in publisher ia.json, not release.site");
  });

  it("is the slot clossys release reads: build, manifest, gates and the ready-pin run on it, and it still refuses a publication record", async () => {
    const world = make();
    const now = clock();
    const before = await release(world, "--build", now);
    expect(before.exitCode).toBe(1);
    expect(before.message).toContain("no release slot for site");
    expect((await create(world)).exitCode).toBe(0);
    const build = await release(world, "--build", now);
    expect(build.exitCode, build.message).toBe(0);
    const manifest = await release(world, "--manifest", now);
    expect(manifest.exitCode, manifest.message).toBe(0);
    expect(readdirSync(join(world.root, SLOT, "candidates"))).toEqual(["site-v1.json"]);
    // The manifest is the engine's: a publication record submitted onto the slot the verb wrote is refused by the reader.
    const record = {
      schema: "clossys.publication/1", format: "web.page.responsive", entryOrder: ["home"], routePack: { packId: "site", homeRouteId: "home" },
      meta: { source: { kind: "derived", ref: ["publisher:ia.json"] }, tree: { id: "site", name: "site.publication", children: [{ id: "site.pages", name: "site.pages", cells: ["page.home"] }] } },
    };
    world.write("drafts/site.json", `${JSON.stringify(record, null, 2)}\n`);
    const skill = STEPS.find(step => step.id === "publisher.candidates")!.command.skill!;
    const submit = await runCli(["next", "publisher/release.site", "--submit", join(world.root, "drafts/site.json"), "--model", "fixture-model", "--tier", "mid", "--basis", "agent", "--skill", skill, "--rung", "adopt", "--seed", "release.site/site-v1.json", "--root", world.root], world.root);
    expect(submit.exitCode, submit.message).not.toBe(0);
    expect(submit.message).toContain("publisher/release.site is a release slot: it holds the manifest clossys release <pub> --manifest writes");
    expect(readdirSync(join(world.root, SLOT, "candidates"))).toEqual(["site-v1.json"]);
    const gates = await release(world, "--gates", now);
    expect(gates.exitCode, gates.message).toBe(0);
    const entry = world.signoff(now);
    const pinned = await runCli(["pin", "publisher/release.site", "site-v1.json", "--by", `owner:${entry}`, "--root", world.root], world.root);
    expect(pinned.exitCode, pinned.message).toBe(0);
    const ready = await release(world, "--ready", now);
    expect(ready.exitCode, ready.message).toBe(0);
    expect(readFileSync(join(world.root, SLOT, "slot.json"), "utf8")).toContain("\"kind\": \"release\"");
  });
});
