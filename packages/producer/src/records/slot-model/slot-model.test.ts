import { describe, expect, it } from "vitest";
import { deriveRefs, parseFrontmatter, serializeFrontmatter, toSlotId, validateCandidate, validateIa, validatePin, validateSlotDoc } from "./index.js";

const codes = (issues: readonly { code: string }[]) => issues.map(issue => issue.code);
const ia = { schema: "clossys.ia/1", source: "@clossys/designer#leaf-freeze", extensions: [], nodes: [{ id: "components", label: "Components", children: [{ id: "actions", label: "Actions", slots: ["components.button"] }] }] };
const slot = { schema: "clossys.slot/1", id: "components.button", agent: "designer", ia: { l1: "components", l2: "actions", order: 0 }, kind: "element", contract: {}, inputs: [], uses: [] };
const pin = { candidate: "button-v1.json", sha256: "a".repeat(64), decidedBy: "migrated", at: "2026-10-31T00:00:00Z" };
const page = { schema: "clossys.page/1", path: "/", title: "Home", frame: null, sections: [], copy: {}, meta: { source: { kind: "original", ref: [] } } };

describe("slot model schema (F1)", () => {
  it("accepts Writer CRLF structural lines without changing raw body or relaxing provenance", () => {
    const body = '## en\r\n### greeting\r\n<!-- {"id":"greeting","bindings":[]} -->\r\n  Exact text  \r\n';
    const fields = { slot: 'strings.common', locales: ['en'], source: { kind: 'original', ref: [] } };
    const bytes = serializeFrontmatter(fields, body);
    expect(validateCandidate('strings', 'strings.common', 'copy-v1.md', bytes)).toEqual([]);
    const parsed = parseFrontmatter(bytes);
    expect(parsed.ok && parsed.value.body).toBe(`\n${body}`);
    const { source: _source, ...missingSource } = fields;
    for (const invalid of [missingSource, { ...fields, lineage: {} }, { ...fields, unknown: true }, { ...fields, status: 'active' }]) {
      expect(validateCandidate('strings', 'strings.common', 'copy-v1.md', serializeFrontmatter(invalid, body)).length).toBeGreaterThan(0);
    }
  });

  it("accepts a well-formed ia.json, slot.json and pin.json", () => {
    expect(validateIa(ia)).toEqual([]);
    expect(validateSlotDoc(slot)).toEqual([]);
    expect(validatePin(pin)).toEqual([]);
  });

  it("rejects a slot placed twice, a stored usedBy and a pin without a hash", () => {
    const twice = { ...ia, nodes: [{ ...ia.nodes[0], children: [{ id: "actions", label: "Actions", slots: ["components.button", "components.button"] }] }] };
    expect(codes(validateIa(twice))).toContain("ia-invalid");
    expect(validateSlotDoc({ ...slot, usedBy: [] }).map(issue => issue.message).join()).toMatch(/usedBy is computed/);
    expect(codes(validatePin({ ...pin, sha256: "nope" }))).toEqual(["pin-invalid"]);
    expect(codes(validatePin({ ...pin, decidedBy: "someone" }))).toEqual(["pin-invalid"]);
  });

  it("accepts display layers that cover every L1 once and rejects unknown, repeated or missing nodes", () => {
    const l1 = ia.nodes[0]!.id, l2 = ia.nodes[0]!.children[0]!.id;
    expect(validateIa({ ...ia, layers: [{ id: "all", label: "All", nodes: [l1] }] })).toEqual([]);
    expect(validateIa({ ...ia, layers: [{ id: "all", label: "All", nodes: [`${l1}/${l2}`] }] })).toEqual([]);
    for (const nodes of [["nope"], [l1, l1], [l1, `${l1}/${l2}`]]) expect(codes(validateIa({ ...ia, layers: [{ id: "all", label: "All", nodes }] }))).toContain("ia-invalid");
    expect(codes(validateIa({ ...ia, layers: [] }))).toContain("ia-invalid");
  });

  it("refuses pin state and legacy provenance on a candidate", () => {
    expect(validateCandidate("page", "page.home", "page-v1.json", JSON.stringify(page))).toEqual([]);
    expect(codes(validateCandidate("page", "page.home", "page-v1.json", JSON.stringify({ ...page, status: "active" })))).toContain("candidate-status");
    expect(codes(validateCandidate("page", "page.home", "page-v1.md", "{}"))).toEqual(["candidate-name"]);
    expect(codes(validateCandidate("page", "page.home", "page.json", "{}"))).toEqual(["candidate-name"]);
  });

  it.each([null, "frames.studio-shell"])("accepts page slot references with frame %j", frame => {
    const candidate = { ...page, frame, sections: ["sections.studio.home", "sections.studio.agent-gallery"], copy: { "home.link": "patterns.inline-link#home.link" },
      bindings: { "sections.studio.home#2": { copy: { "home.link": "patterns.inline-link#second-link" } } } };
    expect(validateCandidate("page", "page.home", "page-v1.json", JSON.stringify(candidate))).toEqual([]);
  });

  it("accepts well-formed page references without requiring their targets to exist", () => {
    const candidate = { ...page, frame: "frames.not-in-ia", sections: ["sections.not-in-ia"], copy: { heading: "custom.future.copy.target#heading" } };
    expect(validateCandidate("page", "page.home", "page-v1.json", JSON.stringify(candidate))).toEqual([]);
  });

  it.each(["", "frames", "../frames.studio-shell", "frames.studio-shell/extra", "frames..shell", "writer:patterns.inline-link", "frames.shell@1", "frames.studio.shell.extra.nested"])("rejects malformed page target %j in each reference field", target => {
    for (const fields of [{ frame: target }, { sections: ["sections.studio.home", target] }, { copy: { link: "patterns.inline-link#link", heading: `${target}#heading` } }]) {
      expect(codes(validateCandidate("page", "page.home", "page-v1.json", JSON.stringify({ ...page, ...fields })))).toEqual(["candidate-invalid"]);
    }
  });

  it.each([
    { frame: undefined }, { frame: false }, { frame: 1 }, { frame: {} }, { frame: [] },
    { sections: undefined }, { sections: null }, { sections: "sections.studio.home" }, { sections: {} },
    { sections: ["sections.studio.home", null] }, { sections: [1] },
    { copy: undefined }, { copy: null }, { copy: [] }, { copy: "patterns.inline-link" },
    { copy: { link: null } }, { copy: { link: 1 } }, { copy: { link: false } }, { copy: { link: {} } }, { copy: { link: [] } },
    // One direction only: copy slot to `<writer slot>#<key>`, never Writer key to Writer slot.
    { copy: { link: "patterns.inline-link" } }, { copy: { "patterns.inline-link": "link" } },
    { bindings: [] }, { bindings: { "sections.studio.home#0": { copy: {} } } }, { bindings: { "sections.studio.home": { copy: { link: "patterns.inline-link" } } } },
  ])("rejects incorrectly typed page references %j", fields => {
    expect(codes(validateCandidate("page", "page.home", "page-v1.json", JSON.stringify({ ...page, ...fields })))).toEqual(["candidate-invalid"]);
  });
});

describe("composition lineage (W6)", () => {
  const withSource = (source: unknown) => JSON.stringify({ ...page, meta: { source } });
  const part = { slot: "components.card", files: ["registry/aria-nova/ui/card.tsx"] };
  it("accepts a composition of declared parts and refuses one without parts", () => {
    expect(validateCandidate("page", "page.home", "page-v1.json", withSource({ kind: "composition", ref: [], parts: [part] }))).toEqual([]);
    for (const parts of [undefined, [], [{ slot: "components.card", files: [] }], [{ slot: "Card", files: ["card.tsx"] }], [part, part], [{ ...part, extra: true }]]) {
      expect(codes(validateCandidate("page", "page.home", "page-v1.json", withSource({ kind: "composition", ref: [], ...(parts ? { parts } : {}) }))), JSON.stringify(parts)).toEqual(["candidate-source"]);
    }
  });
  it("keeps parts to compositions and a ref on registry and derived lineage", () => {
    expect(codes(validateCandidate("page", "page.home", "page-v1.json", withSource({ kind: "registry", ref: ["shadcn-aria/card@4.23.0"], parts: [part] })))).toEqual(["candidate-source"]);
    expect(codes(validateCandidate("page", "page.home", "page-v1.json", withSource({ kind: "derived", ref: [] })))).toEqual(["candidate-source"]);
    expect(codes(validateCandidate("page", "page.home", "page-v1.json", withSource({ kind: "hand-drawn", ref: [] })))).toEqual(["candidate-source"]);
  });
  it("takes an npm source only as one exact npm/<package>@<version> ref", () => {
    expect(validateCandidate("page", "page.home", "page-v1.json", withSource({ kind: "npm", ref: ["npm/@xyflow/react@12.12.1"] }))).toEqual([]);
    for (const ref of [[], ["npm/@xyflow/react@^12.12.1"], ["npm/@xyflow/react"], ["@xyflow/react@12.12.1"], ["npm/@xyflow/react@12.12.1", "npm/react@19.0.0"]]) {
      expect(codes(validateCandidate("page", "page.home", "page-v1.json", withSource({ kind: "npm", ref }))), JSON.stringify(ref)).toEqual(["candidate-source"]);
    }
    expect(codes(validateCandidate("page", "page.home", "page-v1.json", withSource({ kind: "npm", ref: ["npm/@xyflow/react@12.12.1"], parts: [part] })))).toEqual(["candidate-source"]);
  });
});

describe("derived inputs and uses (F10)", () => {
  const known = new Set(["identity.brand.essence", "strings.common", "components.button", "sections.hero", "page.home"]);

  it("maps raw references to slot ids and drops unknown ones", () => {
    expect(toSlotId("writer:strings.common@2", known)).toBe("strings.common");
    expect(toSlotId("@acme/registry/components.button", known)).toBe("components.button");
    expect(toSlotId("button", known)).toBe("components.button");
    expect(toSlotId("nothing.here", known)).toBeUndefined();
  });

  it("gives a Writer slot its feeding briefs as inputs and a page inputs equal to uses", () => {
    const ctx = { known, feeds: new Map([["strings.common", ["identity.brand.essence"]]]) };
    expect(deriveRefs("writer", "strings", "strings.common", {}, ctx).inputs).toEqual(["identity.brand.essence"]);
    const page = deriveRefs("publisher", "page", "page.home", { uses: ["sections.hero", "writer:strings.common@1", "frames.gone"] }, ctx);
    expect(page.uses).toEqual(["sections.hero", "strings.common"]);
    expect(page.inputs).toEqual(page.uses);
    expect(page.dropped).toEqual(["frames.gone"]);
  });
});
