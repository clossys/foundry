import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildContext } from "../context.js";
import { NEEDS_REFRESH, pinChecks } from "../cascade.js";
import { cleanSpec, contextOf, expectCatches, FIXTURE_SKILL_SHAS, NO_FOUNDRY_LEAVES, NO_HISTORY, slotDoc, validPin, type WorkspaceSpec } from "../__fixtures__/workspace.js";
import { R07, acyclicUpstream, cycles, recitedPins, undeclaredCitations, versionCitations } from "./R07-citations.js";

const clean = () => contextOf(cleanSpec());
const broken = (edit: (spec: WorkspaceSpec) => void) => { const spec = cleanSpec(); edit(spec); return contextOf(spec); };

describe("R07 citations", () => {
  it("passes the clean workspace (page sections and copy, @/ imports all declared)", () => {
    const ctx = clean();
    for (const check of [undeclaredCitations, versionCitations, recitedPins, acyclicUpstream]) expect(check(ctx)).toEqual([]);
  });

  it("R07.1 flags an undeclared page section and an undeclared @/ import", () => {
    const rows = expectCatches(undeclaredCitations, clean(), broken(spec => {
      spec.designer!["ui.card"]!.slot = slotDoc("designer", "ui.card");
      spec.publisher!["site.home"]!.candidates = { "home-v1.json": { schema: "clossys.page/1", sections: ["ui.card", "ui.button"], copy: { title: "home.hero#title" } } };
    }));
    expect(rows.map(row => `${row.slot}: ${row.reason}`).sort()).toEqual([
      "site.home: cites 1 slot not in slot.json inputs/uses: ui.button (sections)",
      "ui.card: cites 1 slot not in slot.json inputs/uses: ui.button (@/ import)",
    ]);
  });

  it("R07.1 flags an undeclared version cite in candidate text", () => {
    const rows = expectCatches(undeclaredCitations, clean(), broken(spec => {
      spec.writer!["home.hero"]!.candidates = { "hero-v1.md": "---\nsource:\n  kind: original\n---\nAs ui.button@1 says.\n" };
    }));
    expect(rows).toEqual([expect.objectContaining({ slot: "home.hero", reason: expect.stringContaining("ui.button (version cite)") })]);
  });

  it("R07.2 flags a versioned citation of another slot", () => {
    const rows = expectCatches(versionCitations, clean(), broken(spec => {
      spec.writer!["home.hero"]!.candidates = { "hero-v1.md": "---\nsource:\n  kind: original\n---\nVoice per director:brand.voice@v3.\n" };
    }));
    expect(rows).toEqual([expect.objectContaining({ check: "R07.2", reason: "1 version citation: director:brand.voice@v3" })]);
  });

  it("R07.3 flags a pin carrying recited", () => {
    const rows = expectCatches(recitedPins, clean(), broken(spec => {
      const text = `${JSON.stringify(spec.designer!["ui.button"]!.candidates!["button-v1.json"], null, 2)}\n`;
      spec.designer!["ui.button"]!.pin = { ...validPin("button-v1.json", text), recited: { "ui.card": 1 } };
    }));
    expect(rows).toEqual([expect.objectContaining({ check: "R07.3", slot: "ui.button" })]);
  });

  it("R07.4 flags a dependency cycle and a downstream dependency", () => {
    const rows = expectCatches(acyclicUpstream, clean(), broken(spec => {
      spec.designer!["ui.button"]!.slot = slotDoc("designer", "ui.button", { uses: ["ui.card"] });
      spec.writer!["home.footer"] = { candidates: { "footer-v1.md": "Footer.\n" } };
      spec.director!["brand.voice"]!.slot = slotDoc("director", "brand.voice", { inputs: ["home.footer"] });
    }));
    expect(rows.map(row => `${row.slot}: ${row.reason}`).sort()).toEqual([
      "brand.voice: depends downstream on writer:home.footer",
      "ui.button: dependency cycle: ui.button, ui.card",
      "ui.card: dependency cycle: ui.button, ui.card",
    ]);
  });

  it("cycles() finds self-loops and multi-node components, and nothing in a DAG", () => {
    expect(cycles(new Map([["a", ["b"]], ["b", ["c"]], ["c", []]]))).toEqual([]);
    expect(cycles(new Map([["a", ["a"]]]))).toEqual([["a"]]);
    expect(cycles(new Map([["a", ["b"]], ["b", ["c"]], ["c", ["a"]], ["d", ["a"]]]))).toEqual([["a", "b", "c"]]);
  });

  it("R07.5 (cascade): a pin judged on another pinSet is stale until re-verdicted or marked needs-refresh; a legacy pin is not reported", () => {
    const ctx = clean();
    // Every pin of the clean workspace is legacy (no recorded pinSet): nothing to report.
    expect(R07.checks["R07.5"]!(ctx)).toEqual([]);
    const page = pinChecks(ctx).find(check => check.slot.agent === "publisher" && check.slot.id === "site.home")!;
    expect(page.state).toBe("legacy");
    const scorecard = (pinSet: string, certified = true) => {
      const dir = join(ctx.root, "clossys", ".state", "checks", "publisher", "site.home");
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "scorecard.json"), JSON.stringify({ schema: "clossys.scorecard/1", slot: "publisher/site.home", candidates: [{ rank: 1, candidate: page.candidate.name, sha256: page.candidate.sha256, submitted: true, certified, verdict: "certify", reasons: [], pinSet }] }));
    };
    scorecard(page.current);
    expect(R07.checks["R07.5"]!(ctx)).toEqual([]);
    scorecard("0".repeat(64));
    expect(R07.checks["R07.5"]!(ctx).map(row => `${row.slot}: ${row.reason}`)).toEqual([expect.stringMatching(/^site\.home: pinned \S+ was judged on pinSet 000000000000, not the pinSet now [0-9a-f]{12}: a repin upstream was not re-verdicted/)]);
    scorecard(page.current, false);
    expect(R07.checks["R07.5"]!(ctx).map(row => row.reason)).toEqual([expect.stringMatching(/fails its re-verdict on the pinSet now, but the slot is not marked needs-refresh/)]);
    // Marked needs-refresh: the cascade ran and flagged it (release refuses it instead).
    const slotFile = join(ctx.root, page.slot.dir, "slot.json");
    writeFileSync(slotFile, JSON.stringify({ ...(page.slot.slot!.value as object), status: NEEDS_REFRESH }, null, 2));
    expect(R07.checks["R07.5"]!(buildContext(ctx.root, ctx.consumer, { history: () => NO_HISTORY, foundryLeaves: NO_FOUNDRY_LEAVES, skillShas: FIXTURE_SKILL_SHAS }))).toEqual([]);
  });
});
