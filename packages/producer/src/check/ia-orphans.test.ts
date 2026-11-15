import { cpSync, mkdirSync, rmSync } from "node:fs";
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

  it("reaches the legal narrative only through the pinned release candidate", () => {
    const ws = reachedWorld();
    rmSync(agents(ws.root, "publisher", "release.site", "pin.json"));
    expect(runIaOrphans(ws.root).findings.map(finding => finding.subject)).toEqual(["director/capability.team.structure", "writer/narratives.legal-document"]);
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
