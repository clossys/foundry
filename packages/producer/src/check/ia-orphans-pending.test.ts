/**
 * CONSISTENCY C2 (foundry-build-0048): ia.orphans splits an unreached folder into `orphan` (fails) and
 * `publication-pending` (listed, does not fail). Pending only when the same edges reach the folder from a publication
 * the installed Publisher package declares (its IA assigns pages to it and its starter lists them) that the consumer
 * has not seated. Every other unreached folder stays an orphan.
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { tallyhouseWorld } from "../records/__fixtures__/slot2-workspace.js";
import { declaredPublications, IA_ORPHANS, runIaOrphans } from "./ia-orphans.js";

const agents = (root: string, ...path: string[]): string => join(root, "clossys", "agents", ...path);
const put = (path: string, doc: unknown) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, `${JSON.stringify(doc, null, 2)}\n`); };

/** Tallyhouse with every folder reached, plus a Publisher package that declares a `docs` publication the consumer has not seated. */
function world() {
  const ws = tallyhouseWorld();
  rmSync(agents(ws.root, "designer", "assets.lockup"), { recursive: true });
  const pkg = (rel: string) => join(ws.root, "packages", "publisher", rel);
  put(pkg("src/catalog/ia/directory.json"), { schema: "test", slots: { "page.docs-index": { kind: "page", publication: "docs", path: "/docs", layouts: ["publisher/layout.docs-index"] } } });
  put(pkg("starters/docs/publication.json"), { id: "docs", root: "/", pages: ["page.docs-index"], layouts: ["layout.docs-index"], chrome: [], defaults: ["page.docs-index/starter-v1.json"] });
  put(pkg("defaults/page.docs-index/starter-v1.json"), { content: { path: "/docs", layout: "publisher/layout.docs-index", sections: [{ use: "designer/sections.hero", copy: "writer/strings.docs#docs.title" }] } });
  // A copy folder only the docs default names, and a section only its consumedBy ref (a docs page) ties to the IA.
  mkdirSync(agents(ws.root, "writer", "strings.docs"), { recursive: true });
  const hero = JSON.parse(readFileSync(agents(ws.root, "designer", "sections.hero", "slot.json"), "utf8")) as Record<string, unknown>;
  const section = (consumer: string) => put(agents(ws.root, "designer", "sections.docs-hero", "slot.json"), {
    ...hero, id: "sections.docs-hero", base: null, refs: [{ to: "designer/themes.primary", rel: "input" }, { to: consumer, rel: "consumedBy" }],
  });
  section("publisher/page.docs-index");
  return { ws, section };
}

describe(`${IA_ORPHANS}: publication-pending (CONSISTENCY C2)`, () => {
  it("reads the declared publications from the Publisher package: its IA pages, its starter and the slots its defaults name", () => {
    const { ws } = world();
    expect(declaredPublications(ws.root)).toEqual(new Map([["docs", expect.arrayContaining(["publisher/page.docs-index", "publisher/layout.docs-index", "designer/sections.hero", "writer/strings.docs"])]]));
  });

  it("lists folders a declared, unseated publication reaches as pending, and passes", () => {
    const { ws } = world();
    const result = runIaOrphans(ws.root);
    expect(result).toEqual({
      check: IA_ORPHANS, status: "pass", findings: [],
      pending: expect.arrayContaining([
        { subject: "designer/sections.docs-hero", detail: expect.stringMatching(/^publication-pending: waits on publication docs, declared by the Publisher package and not seated/) },
        { subject: "writer/strings.docs", detail: expect.stringMatching(/^publication-pending: waits on publication docs/) },
      ]),
    });
    expect(result.pending).toHaveLength(2);
  });

  it("fails a leaf whose consumedBy names a publication the package does not declare (mutation b)", () => {
    const { ws, section } = world();
    section("publisher/page.elsewhere");
    const result = runIaOrphans(ws.root);
    expect(result.status).toBe("fail");
    expect(result.findings).toEqual([{ subject: "designer/sections.docs-hero", detail: "no consumedBy path ends at a publication in publisher/ia.json" }]);
    expect(result.pending).toEqual([{ subject: "writer/strings.docs", detail: expect.stringMatching(/^publication-pending/) }]);
  });

  it("judges a seated publication by its real graph: nothing is pending, an unreached folder is an orphan again", () => {
    const { ws } = world();
    const iaFile = agents(ws.root, "publisher", "ia.json");
    const ia = JSON.parse(readFileSync(iaFile, "utf8")) as { publications?: Record<string, unknown> };
    put(iaFile, { ...ia, publications: { ...ia.publications, docs: { pages: ["page.docs-index"] } } });
    const result = runIaOrphans(ws.root);
    expect(result.pending).toBeUndefined();
    // The section names the seated page as its consumer (reached); only the default names the copy folder.
    expect(result.findings).toEqual([{ subject: "writer/strings.docs", detail: expect.stringMatching(/no slot.json/) }]);
  });

  it("declares nothing for a starter whose listed default is missing: its folders stay orphans (no fallback)", () => {
    const { ws } = world();
    rmSync(join(ws.root, "packages", "publisher", "defaults", "page.docs-index"), { recursive: true });
    expect(declaredPublications(ws.root).size).toBe(0);
    const result = runIaOrphans(ws.root);
    expect(result.status).toBe("fail");
    expect(result.findings.map(finding => finding.subject).sort()).toEqual(["designer/sections.docs-hero", "writer/strings.docs"]);
  });
});
