/**
 * foundry-build-0048 SITE-PUBLICATION: the site starter plan is the Publisher package's own starter and page
 * archetypes, read by code; a page whose archetype is missing or disagrees refuses with PageArchetypeError.
 * Synthetic: a tmp workspace reading the installed Publisher package, and test worlds holding a copy of its starter
 * data under their own `packages/publisher/` with one part of one archetype removed or changed.
 */
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { installedPackageRoot } from "../package-path.js";
import { runCli } from "./main.js";
import { PageArchetypeError, SEATABLE_STARTERS, starterContract, starterPlan, starterUnder } from "./starter-plan.js";

const ROUTED = ["page.home", "page.about", "page.pricing", "page.contact", "page.site-page", "page.terms", "page.privacy"];
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function workspace(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "starter-plan-")));
  roots.push(root);
  mkdirSync(join(root, "clossys"), { recursive: true });
  writeFileSync(join(root, "clossys", "clossys.config.ts"), "export default {};\n");
  return root;
}
/** A test world: the installed Publisher starter data copied under `<root>/packages/publisher/`. */
function world(): string {
  const root = workspace();
  const source = installedPackageRoot("publisher")!;
  for (const rel of ["starters", "src/catalog/ia/directory.json", "src/catalog/ia/composition.json", "defaults"]) {
    cpSync(join(source, rel), join(root, "packages", "publisher", rel), { recursive: true });
  }
  return root;
}
const editJson = (file: string, edit: (doc: Record<string, any>) => void) => {
  const doc = JSON.parse(readFileSync(file, "utf8")) as Record<string, any>;
  edit(doc);
  writeFileSync(file, `${JSON.stringify(doc, null, 2)}\n`);
};
const archetypeError = (root: string): PageArchetypeError => {
  try { starterPlan(root, "site"); } catch (error) { if (error instanceof PageArchetypeError) return error; throw error; }
  throw new Error("starterPlan did not refuse");
};

describe("the site plan is the Publisher site starter and its page archetypes", () => {
  it("seats the seven routed pages in starter order and holds the two status pages", () => {
    const plan = starterPlan(workspace(), "site");
    expect(SEATABLE_STARTERS).toEqual(["site"]);
    expect(plan.publication).toBe("publication.site");
    expect(plan.root).toBe("/");
    expect(plan.pages.map(page => page.id)).toEqual(ROUTED);
    expect(plan.pages.map(page => page.route)).toEqual(["/", "/about", "/pricing", "/contact", "/<slug>", "/terms", "/privacy"]);
    expect(plan.held.map(page => [page.id, page.status])).toEqual([["page.not-found", 404], ["page.error", 500]]);
    for (const page of plan.held) expect(page.reason).toContain("page.assembled holds every page record to one");
  });

  it("reads each page's frame, chrome units, ordered sections and copy slots from its archetype", () => {
    const plan = starterPlan(workspace(), "site");
    for (const page of plan.pages) {
      expect(page.uses.slice(0, 3), page.id).toEqual(["frames.site-shell", "frames.site-header", "frames.site-footer"]);
      expect(page.uses.slice(3).every(use => use.startsWith("sections.")), page.id).toBe(true);
      expect(page.copy[0], page.id).toBe(`${page.id}.meta`);
      expect(page.copy.slice(-2), page.id).toEqual(["frames.site-header.copy", "frames.site-footer.copy"]);
      expect(page.cites, page.id).toEqual([...page.uses, ...page.copy]);
    }
    const home = plan.pages[0]!;
    expect(home.uses.slice(3)).toEqual(["sections.hero", "sections.logo-cloud", "sections.features", "sections.steps", "sections.faq", "sections.call-to-action"]);
    expect(home.copy.slice(1, -2)).toEqual(home.uses.slice(3).map(use => `${use}.copy`));
    const site = plan.pages.find(page => page.id === "page.site-page")!;
    expect(site.params).toEqual(["slug"]);
    expect(site.collection).toBe("site-pages");
    expect(site.sample).toBe("/sample");
    // A static route of the same length wins over /<slug>, so its segment is a value <slug> never takes.
    expect(site.reserved.slug).toEqual(expect.arrayContaining(["about", "pricing", "contact", "terms", "privacy", "admin"]));
  });

  it("writes one contract per slot, key for key from the archetype", () => {
    const plan = starterPlan(workspace(), "site");
    expect(starterContract(plan, "page.home")).toEqual({
      kind: "page", publication: "site", route: "/", package: "publisher/page.home", layout: "publisher/layout.marketing-home",
      frame: "required", sections: "ordered", meta: "required",
      composes: plan.pages[0]!.uses.map(id => `designer/${id}`), copy: plan.pages[0]!.copy.map(id => `writer/${id}`),
      requirements: [{ check: "page.assembled" }], fixture: { route: { path: "/" } },
    });
    expect(starterContract(plan, "page.site-page")).toMatchObject({ route: "/<slug>", routeFormat: { pattern: "/<slug>", params: ["slug"], collection: "site-pages" }, fixture: { route: { path: "/sample" } } });
    expect(starterContract(plan, "publication.site")).toEqual({ kind: "publication", publication: "site", root: "/", pages: ROUTED, requirements: [{ check: "publication.routes" }], fixture: { route: { path: "/" } } });
    expect(() => starterContract(plan, "page.not-found")).toThrow("is not a seated slot");
    expect(ROUTED.map(id => starterUnder(plan, id))).toEqual(["site/home", "site/about", "site/pricing", "site/contact", "site/site-page", "site/terms", "site/privacy"]);
    expect(starterUnder(plan, "publication.site")).toBe("site/publication");
  });

  it("reads a test world's own package copy the same way", () => {
    expect(starterPlan(world(), "site")).toEqual(starterPlan(workspace(), "site"));
  });
});

describe("a page with no archetype refuses with PageArchetypeError", () => {
  it("mutation: a removed package default names the page and the file", () => {
    const root = world();
    rmSync(join(root, "packages/publisher/defaults/page.about"), { recursive: true });
    const error = archetypeError(root);
    expect(error.name).toBe("PageArchetypeError");
    expect([error.starter, error.page]).toEqual(["site", "page.about"]);
    expect(error.message).toBe("no page archetype for publisher/page.about (starter site): the package default defaults/page.about/starter-v1.json is missing");
  });

  it("mutation: a page the directory tree does not hold", () => {
    const root = world();
    editJson(join(root, "packages/publisher/src/catalog/ia/directory.json"), doc => { delete doc.slots["page.pricing"]; });
    expect(archetypeError(root).message).toBe("no page archetype for publisher/page.pricing (starter site): the Publisher directory tree holds no page slot of that id");
  });

  it("mutation: a layout the composition tree does not hold, and chrome with no unit", () => {
    const root = world();
    const composition = join(root, "packages/publisher/src/catalog/ia/composition.json");
    editJson(composition, doc => { delete doc.slots["layout.contact"]; });
    expect(archetypeError(root).page).toBe("page.contact");
    cpSync(join(installedPackageRoot("publisher")!, "src/catalog/ia/composition.json"), composition);
    editJson(composition, doc => { delete doc.slots["chrome.site-footer"].unit; });
    expect(archetypeError(root).message).toContain("places chrome publisher/chrome.site-footer, which names no Designer unit and Writer copy");
  });

  it("mutation: a default that disagrees with its directory slot (route, sections, copy) is no archetype", () => {
    const root = world();
    const terms = join(root, "packages/publisher/defaults/page.terms/starter-v1.json");
    const original = readFileSync(terms, "utf8");
    editJson(terms, doc => { doc.content.path = "/legal/terms"; });
    expect(archetypeError(root).message).toContain(`routes "/legal/terms", not the directory's /terms`);
    writeFileSync(terms, original);
    editJson(terms, doc => { doc.content.sections = []; });
    expect(archetypeError(root).message).toContain("orders no sections");
    writeFileSync(terms, original);
    editJson(terms, doc => { delete doc.content.sections[1].copy; });
    expect(archetypeError(root).message).toContain("section 2 of its package default binds no Writer copy");
    writeFileSync(terms, original);
    editJson(terms, doc => { delete doc.content.meta; });
    expect(archetypeError(root).message).toContain("names no Writer meta record");
  });

  it("mutation: a status page with no default refuses too (held pages still need their archetype)", () => {
    const root = world();
    rmSync(join(root, "packages/publisher/defaults/page.error"), { recursive: true });
    expect(archetypeError(root).page).toBe("page.error");
  });
});

describe("init --starters names only seatable starters", () => {
  it("refuses an unknown starter and the admin starter as usage errors, before any write", async () => {
    const root = workspace();
    const unknown = await runCli(["init", "--starters", "websites", "--root", root]);
    expect(unknown.exitCode).toBe(2);
    expect(unknown.message).toContain("--starters websites: init seats the starters site");
    const admin = await runCli(["init", "--starters", "admin", "--root", root]);
    expect(admin.exitCode).toBe(2);
    expect(admin.message).toContain("the admin workspace is seated by every clossys init");
    const bare = await runCli(["init", "--starters", "--root", root]);
    expect(bare.exitCode).toBe(2);
    expect(() => readFileSync(join(root, "AGENTS.md"))).toThrow();
  });
});
