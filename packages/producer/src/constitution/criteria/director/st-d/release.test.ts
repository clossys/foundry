import { describe, expect, it } from "vitest";
import { DIRECTOR_CRITERIA } from "./index.js";
import { parseReleaseScope, releaseScope, releaseScopeParams, type ReleaseScopeParams } from "./release.js";

const PARAMS = { kinds: ["site", "docs", "slides", "video", "image set"], stages: ["launch", "mvp", "growth", "mature"], capStages: ["launch", "mvp"], pageCap: 8 };
const resolved = releaseScopeParams(PARAMS) as ReleaseScopeParams;

const brief = (scope: string, stage = "launch", refs = ["context.customer.need", "focus.reach.channel"]) => ({
  kind: "brief",
  text: [
    "", "## Direction", "- Release: claim export for the six insurers", `- Stage: ${stage}`, "- Target date: 2026-12-15", `- Scope: ${scope}`, "- Not in scope: slides, video, customer stories",
    "", "## Because", "- Founders lose a week a month to manual claims (context.customer.need)", "- Founders arrive from search (focus.reach.channel)",
    "", "## Watch", "- If signups < 20 by 2027-01-15, then review the launch site with the owner.", "",
  ].join("\n"),
  json: { slot: "execution.roadmap.release", source: JSON.stringify({ kind: "derived", ref: refs }) },
});

const GOOD = "site (home, pricing, contact): launch site that shows founders the claim export; docs (quickstart): launch guide so founders set up exports alone";

describe("brief.release-scope (CP1-PLAN)", () => {
  it("passes a stage-sized release with a use case per row and parses its rows", () => {
    expect(releaseScope(brief(GOOD), PARAMS)).toEqual([]);
    const parsed = parseReleaseScope(brief(GOOD).text, resolved);
    expect(parsed.stage).toBe("launch");
    expect(parsed.rows.map(row => [row.kind, row.pages])).toEqual([["site", ["home", "pricing", "contact"]], ["docs", ["quickstart"]]]);
    expect(parsed.notInScope).toEqual(["slides", "video", "customer stories"]);
  });

  it("release cell rejects a scope row with no use case", () => {
    const failures = releaseScope(brief("site (home, pricing, contact); docs (quickstart): launch guide so founders set up exports alone"), PARAMS);
    expect(failures).toEqual([expect.stringMatching(/^Scope row "site" has no use case/)]);
    expect(releaseScope(brief("site (home, pricing, contact): launch site"), PARAMS)).toEqual([expect.stringMatching(/^Scope row "site" has no use case/)]);
  });

  it("launch stage page cap refuses an oversize scope", () => {
    const big = "site (home, about, pricing, contact, site-page, terms, privacy): launch site that shows founders the claim export; docs (quickstart, setup): launch guide so founders set up exports alone";
    expect(releaseScope(brief(big), PARAMS)).toEqual(["Scope asks for 9 pages; a launch release holds at most 8"]);
    expect(releaseScope(brief(big.replace(/launch/g, "mvp"), "mvp"), PARAMS)).toEqual(["Scope asks for 9 pages; a mvp release holds at most 8"]);
    expect(releaseScope(brief(big.replace(/launch/g, "growth"), "growth"), PARAMS)).toEqual([]);
    expect(releaseScope(brief(big), { ...PARAMS, pageCap: 9 })).toEqual([]);
  });

  it("names the stage in every use case, a known kind, a Not-in-scope list and the customer need", () => {
    expect(releaseScope(brief("site (home): a site that shows founders the claim export"), PARAMS)).toEqual(['Scope row "site" use case does not name the stage "launch"']);
    expect(releaseScope(brief("podcast (one): launch show that tells founders the story"), PARAMS)[0]).toMatch(/is not "<kind> \(<page>, <page>\): <use case>"/);
    expect(releaseScope(brief(GOOD, "someday"), PARAMS)).toEqual(['Stage "someday" is not one of launch, mvp, growth, mature']);
    expect(releaseScope(brief(GOOD, "launch", ["focus.reach.channel"]), PARAMS)[0]).toMatch(/^source does not cite context.customer.need/);
    const none = brief(GOOD);
    expect(releaseScope({ ...none, text: none.text.replace("- Not in scope: slides, video, customer stories", "- Not in scope: none") }, PARAMS)[0]).toMatch(/no "- Not in scope: \.\.\." list/);
    expect(releaseScope(brief(GOOD), { ...PARAMS, pageCap: 0 })).toEqual(["params.pageCap must be a positive whole number"]);
  });

  it("meets the rest of the brief.list standard as written, so the contract adds one criterion and loosens none", () => {
    const subject = brief(GOOD);
    for (const id of ["brief.sections", "brief.derived-upstream", "brief.because-cited", "brief.watch-trigger", "brief.plain-direction"]) expect(DIRECTOR_CRITERIA[id]!(subject, {}), id).toEqual([]);
    expect(DIRECTOR_CRITERIA["brief.direction-values"]!(subject, { maxWords: 45, maxSentences: 2 })).toEqual([]);
    expect(DIRECTOR_CRITERIA["brief.keys"]!(subject, { keys: ["Release", "Stage", "Target date", "Scope", "Not in scope"] })).toEqual([]);
  });
});
