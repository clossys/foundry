import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { CONSUMER, tallyhouseWorld } from "../records/__fixtures__/slot2-workspace.js";
import { IA_ORPHANS, publicationRoots, runIaOrphans } from "./ia-orphans.js";

const agents = (root: string, ...path: string[]): string => join(root, "clossys", "agents", ...path);
/** Tallyhouse without its one unreached folder (see the first test). */
function reachedWorld() {
  const ws = tallyhouseWorld();
  rmSync(agents(ws.root, "designer", "assets.lockup"), { recursive: true });
  return ws;
}

describe(IA_ORPHANS, () => {
  it("on frozen Tallyhouse, finds the lockup only the unpinned page.home candidate names", () => {
    const ws = tallyhouseWorld();
    expect(publicationRoots(ws.root).roots).toEqual([
      "publisher/page.home", "publisher/page.about", "publisher/page.pricing", "publisher/page.contact", "publisher/page.terms",
      "publisher/page.privacy", "publisher/page.not-found", "publisher/page.error", "publisher/chrome.site-header", "publisher/chrome.site-footer", "publisher/release.site",
    ]);
    expect(runIaOrphans(ws.root).findings).toEqual([{ subject: "designer/assets.lockup", detail: expect.stringMatching(/no slot.json/) }]);
  });

  it("passes when every folder is reached, through refs, consumedBy and the pinned release candidate", () => {
    expect(runIaOrphans(reachedWorld().root)).toEqual({ check: IA_ORPHANS, status: "pass", findings: [] });
  });

  it("fails a consumer slot folder with no ia entry", () => {
    const ws = reachedWorld();
    const stray = agents(ws.root, "designer", "assets.app-icon", "slot.json");
    mkdirSync(dirname(stray), { recursive: true });
    cpSync(join(CONSUMER, "clossys/agents/designer/assets.app-icon/slot.json"), stray);
    const result = runIaOrphans(ws.root);
    expect(result.status).toBe("fail");
    expect(result.findings).toEqual([{ subject: "designer/assets.app-icon", detail: expect.stringMatching(/no consumedBy path ends at a publication/) }]);
  });

  it("never reads a retired slot or the agent's non-slot folders as an orphan, and still finds a stray slot beside them", () => {
    const ws = reachedWorld();
    // `clossys retire --slot` moves a slot to agents/<agent>/_retired/<slot>; retired/ and _evidence are not slots either.
    const retired = agents(ws.root, "designer", "_retired", "assets.app-icon", "slot.json");
    mkdirSync(dirname(retired), { recursive: true });
    cpSync(join(CONSUMER, "clossys/agents/designer/assets.app-icon/slot.json"), retired);
    mkdirSync(agents(ws.root, "writer", "retired"), { recursive: true });
    mkdirSync(agents(ws.root, "director", "_evidence"), { recursive: true });
    expect(runIaOrphans(ws.root)).toEqual({ check: IA_ORPHANS, status: "pass", findings: [] });
    mkdirSync(agents(ws.root, "writer", "strings.stray"), { recursive: true });
    expect(runIaOrphans(ws.root).findings).toEqual([{ subject: "writer/strings.stray", detail: expect.stringMatching(/no slot.json/) }]);
  });

  it("takes a placed publisher/publication.<pub> slot and its release slot as roots, as the ia verb takes the publication to exist", () => {
    // The publication form `clossys ia publisher/publication.<pub>` writes: a slot placed in publisher ia.json nodes, no
    // `publications` map. Its release slot (release.<pub>) is a root as well, so its pinned manifest is walked.
    const ws = tallyhouseWorld();
    const iaFile = agents(ws.root, "publisher", "ia.json");
    const ia = JSON.parse(readFileSync(iaFile, "utf8")) as Record<string, unknown>;
    delete ia.publications;
    const place = (slots: string[]) => writeFileSync(iaFile, JSON.stringify({ ...ia, nodes: [{ id: "site", label: "Site", children: [{ id: "site.pages", label: "Pages", slots }] }] }));
    place(["publication.site"]);
    mkdirSync(agents(ws.root, "publisher", "publication.site"));
    const slotFile = agents(ws.root, "publisher", "publication.site", "slot.json");
    writeFileSync(slotFile, JSON.stringify({ status: "live" }));
    expect(publicationRoots(ws.root).roots).toEqual(["publisher/publication.site", "publisher/release.site"]);
    expect(runIaOrphans(ws.root).findings).toEqual([{ subject: "designer/assets.lockup", detail: expect.stringMatching(/no slot.json/) }]);
    // Not placed, or retired: no publication exists, so nothing is reached and every folder is an orphan.
    place([]);
    expect(publicationRoots(ws.root).roots).toEqual([]);
    expect(runIaOrphans(ws.root).findings.map(finding => finding.subject)).toContain("publisher/page.home");
    place(["publication.site"]);
    writeFileSync(slotFile, JSON.stringify({ status: "retired" }));
    expect(publicationRoots(ws.root).roots).toEqual([]);
  });

  it("reaches the legal narrative only through the pinned release candidate", () => {
    const ws = reachedWorld();
    rmSync(agents(ws.root, "publisher", "release.site", "pin.json"));
    expect(runIaOrphans(ws.root).findings.map(finding => finding.subject)).toEqual(["director/capability.team.structure", "writer/narratives.legal-document"]);
  });

  it("exempts a Producer seat slot producer/ia.json places, and finds a seat folder it does not place", () => {
    // `clossys seat <step>` writes producer/seat.<step> with no refs and places it in producer/ia.json: no publication
    // consumes a seat, so its placement is its tie to the IA.
    const ws = reachedWorld();
    const iaFile = agents(ws.root, "producer", "ia.json");
    const place = (slots: string[]) => writeFileSync(iaFile, JSON.stringify({ schema: "clossys.ia/1", source: "@clossys/producer#pipeline/seats.json", extensions: [], nodes: [{ id: "design", label: "design", children: [{ id: "design.make", label: "design.make", slots }] }] }));
    mkdirSync(agents(ws.root, "producer", "seat.designer.candidates"));
    writeFileSync(agents(ws.root, "producer", "seat.designer.candidates", "slot.json"), JSON.stringify({ schema: "clossys.slot/2", id: "seat.designer.candidates", agent: "producer", kind: "seat", refs: [] }));
    place(["seat.designer.candidates"]);
    expect(runIaOrphans(ws.root)).toEqual({ check: IA_ORPHANS, status: "pass", findings: [] });
    place([]);
    expect(runIaOrphans(ws.root).findings).toEqual([{ subject: "producer/seat.designer.candidates", detail: "seat slot folder producer/ia.json does not place" }]);
    // A placed id that is not a seat id is no exemption: only seat.<step> slots are exempt by placement.
    mkdirSync(agents(ws.root, "producer", "check.stray"));
    place(["seat.designer.candidates", "check.stray"]);
    expect(runIaOrphans(ws.root).findings.map(finding => finding.subject)).toEqual(["producer/check.stray"]);
  });

  it("exempts Producer loop slots and fails a missing publisher/ia.json", () => {
    const ws = reachedWorld();
    rmSync(agents(ws.root, "publisher", "ia.json"));
    const findings = runIaOrphans(ws.root).findings;
    expect(findings[0]).toEqual({ subject: "publisher/ia.json", detail: "missing: no publication roots" });
    expect(findings.map(finding => finding.subject)).not.toContain("producer/loop.refine");
    expect(findings.length).toBeGreaterThan(1);
  });
});
