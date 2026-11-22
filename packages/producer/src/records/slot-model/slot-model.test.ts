import { describe, expect, it } from "vitest";
import { deriveRefs, parseFrontmatter, serializeFrontmatter, toSlotId, validateCandidate, validateIa, validatePin, validateSlotDoc } from "./index.js";

const codes = (issues: readonly { code: string }[]) => issues.map(issue => issue.code);
const ia = { schema: "clossys.ia/1", source: "@clossys/designer#leaf-freeze", extensions: [], nodes: [{ id: "components", label: "Components", children: [{ id: "actions", label: "Actions", slots: ["components.button"] }] }] };
const slot = { schema: "clossys.slot/1", id: "components.button", agent: "designer", ia: { l1: "components", l2: "actions", order: 0 }, kind: "element", contract: {}, inputs: [], uses: [] };
const pin = { candidate: "button-v1.json", sha256: "a".repeat(64), decidedBy: "migrated", basis: "bulk", at: "2026-10-31T00:00:00Z" };
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

  it("accepts a Writer provenance.voice that cites a Director slot and refuses any other provenance shape (U-VOICE-PROV)", () => {
    const body = '## en\n### greeting\n<!-- {"id":"greeting","bindings":[]} -->\nHello\n';
    const fields = { slot: 'strings.common', locales: ['en'], source: { kind: 'derived', ref: ['director:advantage.proposition.promise'] } };
    expect(validateCandidate('strings', 'strings.common', 'copy-v1.md', serializeFrontmatter({ ...fields, provenance: { voice: 'director:identity.verbal.voice' } }, body))).toEqual([]);
    for (const provenance of [{}, 'director:identity.verbal.voice', { voice: 'identity.verbal.voice' }, { voice: 'writer:lexicon.mood' }, { voice: 7 }, { voice: 'director:identity.verbal.voice', inputs: [] }]) {
      const issues = validateCandidate('strings', 'strings.common', 'copy-v1.md', serializeFrontmatter({ ...fields, provenance }, body));
      expect(codes(issues), JSON.stringify(provenance)).toEqual(['candidate-invalid']);
      expect(issues[0]!.message, JSON.stringify(provenance)).toMatch(/^provenance/);
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

describe("interactive backdrop on the code candidate of a backdrop-declaring surface (foundry-build-0048 A4, U23)", () => {
  const code = [{ path: "hero.tsx", type: "registry:block", content: "export function Hero() { return null; }" }];
  const item = (meta: Record<string, unknown> = {}, over: Record<string, unknown> = {}) => JSON.stringify({
    $schema: "https://ui.shadcn.com/schema/registry-item.json", name: "hero", type: "registry:block", files: code,
    meta: { slot: "sections.hero", source: { kind: "original", ref: [], license: "MIT" }, backdrop: { component: "gradient-mesh", params: { intensity: 0.5 } }, ...meta },
    ...over,
  });
  const check = (bytes: string, slot = "sections.hero") => validateCandidate("element", slot, "hero-v1.json", bytes);
  const messages = (bytes: string, slot?: string) => check(bytes, slot).map(issue => issue.message).join("; ");

  it("accepts a hero code candidate carrying a valid descriptor, of any source kind", () => {
    expect(check(item())).toEqual([]);
    expect(check(item({ source: { kind: "registry", ref: ["shadcn/hero@1.0.0"] } }))).toEqual([]);
  });

  it("refuses an invalid descriptor, one on another slot and one on a non-element candidate", () => {
    expect(messages(item({ backdrop: { component: "gradient-mesh", params: { intensity: 7 } } }))).toMatch(/outside 0\.1\.\.1/);
    expect(messages(item({ backdrop: { component: "gradient-mesh", params: { from: "url(https://example.com/x.png)" } } }))).toMatch(/not one of the token colours/);
    expect(messages(item({ backdrop: { component: "particles", params: {}, module: "./backdrop.js" } }))).toMatch(/carries "module"/);
    expect(messages(item({ backdrop: "flickering-grid" }))).toMatch(/not an object \{component, params\}/);
    expect(codes(check(item({ backdrop: { component: "three-scene", params: {} } })))).toEqual(["candidate-source"]);
    expect(messages(item({ backdrop: { component: "grid-glow", params: { cell: 32 } } }))).toMatch(/"grid-glow", not one of the adopted backdrop components particles, flickering-grid, grid-pattern, gradient-mesh/);
    // Surface opt-in comes from the catalog contract: only a surface declaring a backdrop-placed slot accepts one.
    for (const slot of ["sections.call-to-action", "sections.media", "frames.site-shell", "components.button"]) {
      expect(messages(item({ slot }), slot), slot).toMatch(new RegExp(`meta\\.backdrop rides only on the code candidate of a surface whose contract declares a backdrop-placed slot; the ${slot.replace(".", "\\.")} contract declares none`));
    }
    const page = { schema: "clossys.page/1", path: "/", title: "Home", frame: null, sections: [], copy: {}, meta: { source: { kind: "original", ref: [] }, backdrop: { component: "flickering-grid", params: {} } } };
    expect(validateCandidate("page", "page.home", "page-v1.json", JSON.stringify(page)).map(issue => issue.message).join("; ")).toMatch(/meta\.backdrop rides only on a Designer element code candidate, not on a page candidate/);
  });

  it("refuses an interactive backdrop in preview props on any slot: meta.backdrop is the only channel", () => {
    const interactive = { kind: "interactive", backdrop: { component: "particles", params: { quantity: 160, staticity: 40 } } };
    // A CTA whose code renders Hero, with no meta.backdrop, carrying the descriptor in its preview props.
    const cta = item({ slot: "sections.call-to-action", backdrop: undefined, preview: { fixtures: { file: "hero.tsx", export: "Hero", props: { backdrop: interactive } } } });
    expect(check(cta, "sections.call-to-action")).toEqual([{ code: "candidate-source", path: "hero-v1.json", message: "meta.preview.fixtures.props.backdrop is an interactive backdrop in preview props; it rides only as meta.backdrop on the code candidate of a surface whose contract declares a backdrop-placed slot" }]);
    // A hero shipping an out-of-range descriptor through flat preview fixtures, beside a valid meta.backdrop.
    expect(messages(item({ preview: { fixtures: { backdrop: { kind: "interactive", backdrop: { component: "flickering-grid", params: { squareSize: 1 } } } } } })))
      .toBe("meta.preview.fixtures.backdrop is an interactive backdrop in preview props; it rides only as meta.backdrop on the code candidate of a surface whose contract declares a backdrop-placed slot");
    // A still backdrop in preview props stays a preview prop.
    expect(check(item({ preview: { fixtures: { backdrop: { kind: "none" } } } }))).toEqual([]);
  });

  it("refuses a code candidate whose preview fills a figure without its alt, against the catalog contract (U23 review N1)", () => {
    const figure = (media: unknown) => item({ backdrop: undefined, preview: { fixtures: { file: "hero.tsx", export: "Hero", props: { media } } } });
    expect(check(figure({ kind: "mark", title: { $copy: "home.hero.media" } }))).toEqual([]);
    expect(check(figure({ kind: "mark", title: "Clossys mark" }))).toEqual([]);
    expect(check(figure({ kind: "mark" }))).toEqual([{ code: "candidate-invalid", path: "hero-v1.json", message: "sections.hero figure media is filled, but its text alternative media.title is absent or blank; a present figure ships with its alt" }]);
    expect(messages(figure({ kind: "mark", title: "  " }))).toMatch(/media\.title is absent or blank/);
    // An absent optional figure needs nothing.
    expect(check(item({ backdrop: undefined, preview: { fixtures: { file: "hero.tsx", export: "Hero", props: {} } } }))).toEqual([]);
  });

  it("refuses the retired interactive-backdrop source kind", () => {
    expect(messages(item({ source: { kind: "interactive-backdrop", ref: [] } }))).toMatch(/source\.kind must be registry, derived, original, composition, npm or package-default/);
  });
});
