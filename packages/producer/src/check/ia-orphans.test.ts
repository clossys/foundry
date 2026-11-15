import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Ref } from "../records/types.js";
import { baseSlot, slot2Workspace } from "../records/__fixtures__/slot2-workspace.js";
import { IA_ORPHANS, publicationRoots, runIaOrphans } from "./ia-orphans.js";

const ref = (to: string, rel: Ref["rel"]): Ref => ({ to: to as Ref["to"], rel });

/** page.home places a Writer slot that takes a Director input; a Designer section consumed by the page. */
function world() {
  const ws = slot2Workspace();
  ws.publications(["page.home"], ["chrome.header"], "release.site");
  ws.consumer("publisher", "page.home", baseSlot("publisher", "page.home", { refs: [ref("writer/sections.hero.copy", "places")] }));
  ws.consumer("publisher", "chrome.header", baseSlot("publisher", "chrome.header", { kind: "chrome" }));
  ws.consumer("publisher", "release.site", baseSlot("publisher", "release.site", { kind: "release" }));
  ws.consumer("writer", "sections.hero.copy", baseSlot("writer", "sections.hero.copy", { brief: { ...baseSlot("writer", "x.y").brief, inputs: [ref("director/identity.naming.name", "input")] } }));
  ws.consumer("director", "identity.naming.name", baseSlot("director", "identity.naming.name"));
  ws.consumer("designer", "sections.hero", baseSlot("designer", "sections.hero", { refs: [ref("publisher/page.home", "consumedBy")] }));
  return ws;
}

describe(IA_ORPHANS, () => {
  it("passes when every folder is reached from a publication", () => {
    const ws = world();
    expect(publicationRoots(ws.root).roots).toEqual(["publisher/page.home", "publisher/chrome.header", "publisher/release.site"]);
    expect(runIaOrphans(ws.root)).toEqual({ check: IA_ORPHANS, status: "pass", findings: [] });
  });

  it("fails a consumer slot folder with no path to a publication", () => {
    const ws = world();
    ws.consumer("writer", "strings.lonely.label", baseSlot("writer", "strings.lonely.label", { refs: [ref("director/identity.naming.name", "input")] }));
    mkdirSync(join(ws.root, "clossys", "agents", "designer", "assets.empty"), { recursive: true });
    const result = runIaOrphans(ws.root);
    expect(result.status).toBe("fail");
    expect(result.findings).toEqual([
      { subject: "designer/assets.empty", detail: expect.stringMatching(/no slot.json/) },
      { subject: "writer/strings.lonely.label", detail: expect.stringMatching(/no consumedBy path ends at a publication/) },
    ]);
  });

  it("walks the pinned JSON candidate's header refs and content", () => {
    const ws = world();
    ws.consumer("designer", "components.button", baseSlot("designer", "components.button"));
    ws.consumer("designer", "themes.color", baseSlot("designer", "themes.color", { kind: "element/token" }));
    const dir = join(ws.root, "clossys", "agents", "designer", "sections.hero");
    mkdirSync(join(dir, "candidates"), { recursive: true });
    writeFileSync(join(dir, "pin.json"), JSON.stringify({ candidate: "v1.json" }));
    writeFileSync(join(dir, "candidates", "v1.json"), JSON.stringify({ clossys: { refs: [ref("designer/components.button", "uses")] }, content: { tokens: ["designer/themes.color#primary"] } }));
    expect(runIaOrphans(ws.root).status).toBe("pass");
    rmSync(join(dir, "pin.json"));
    expect(runIaOrphans(ws.root).findings.map(finding => finding.subject)).toEqual(["designer/components.button", "designer/themes.color"]);
  });

  it("exempts Producer loop slots and fails a missing publisher/ia.json", () => {
    const ws = world();
    ws.consumer("producer", "loop.fill.step", baseSlot("producer", "loop.fill.step"));
    expect(runIaOrphans(ws.root).status).toBe("pass");
    rmSync(join(ws.root, "clossys", "agents", "publisher", "ia.json"));
    const findings = runIaOrphans(ws.root).findings;
    expect(findings[0]).toEqual({ subject: "publisher/ia.json", detail: "missing: no publication roots" });
    expect(findings.length).toBeGreaterThan(1);
  });
});
