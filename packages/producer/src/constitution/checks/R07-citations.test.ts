import { describe, expect, it } from "vitest";
import { cleanSpec, contextOf, expectCatches, slotDoc, validPin, type WorkspaceSpec } from "../__fixtures__/workspace.js";
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

  it("keeps R07.5 (cascade) pending", () => {
    expect(R07.checks["R07.5"]!(clean())).toEqual([expect.objectContaining({ pending: true })]);
  });
});
