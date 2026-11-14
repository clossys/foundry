import { describe, expect, it } from "vitest";
import { candidateReason, directorCites, directorTraceProblem, owesDirectorTrace } from "../../records/director-trace.js";
import { cleanSpec, contextOf, expectCatches, slotDoc, type WorkspaceSpec } from "../__fixtures__/workspace.js";
import { R20, designerTrace, writerTrace } from "./R20-director-derived.js";

/** A Designer theme/asset candidate whose meta.element.reason is `reason` (omitted when undefined). */
const element = (name: string, reason?: string) => ({
  name, type: "registry:theme", files: [],
  meta: { source: { kind: "derived", ref: ["shadcn/neutral@4.23.0"] }, element: { id: name, ...(reason === undefined ? {} : { reason }) } },
});
/** A Writer candidate with the given frontmatter reason (omitted when undefined). */
const copy = (reason?: string) => `---\nslot: "home.hero"\nlocales: ["en"]\nsource: {"kind":"derived","ref":["director:brand.voice"]}\n${reason === undefined ? "" : `reason: ${JSON.stringify(reason)}\n`}---\n\n## en\n`;

/** cleanSpec plus one pinned theme and one pinned asset, each tracing to the pinned brand.voice. */
function tracedSpec(): WorkspaceSpec {
  const spec = cleanSpec();
  spec.designer!["themes.primary"] = { slot: slotDoc("designer", "themes.primary", { inputs: ["brand.voice"] }), candidates: { "primary-v1.json": element("primary", "Realises director:brand.voice: one calm primary.") } };
  spec.designer!["assets.mark"] = { slot: slotDoc("designer", "assets.mark", { inputs: ["brand.voice"] }), candidates: { "mark-v1.json": element("mark", "default:shadcn/neutral@4.23.0 kept: director:brand.voice#tone asks for no ornament.") } };
  spec.writer!["home.hero"]!.candidates = { "hero-v1.md": copy("Realises director:brand.voice (calm and plain).") };
  // An unpinned Director slot: citing it alone is not a trace.
  spec.director!["brand.tone"] = { pin: false, candidates: { "tone-v1.md": "---\nsource: {\"kind\":\"original\",\"ref\":[]}\n---\nWarm.\n" } };
  return spec;
}
const clean = () => contextOf(tracedSpec());
const broken = (edit: (spec: WorkspaceSpec) => void) => { const spec = tracedSpec(); edit(spec); return contextOf(spec); };
const reasons = (rows: { slot: string; reason: string }[]) => rows.map(row => `${row.slot}: ${row.reason}`).sort();

describe("R20 Director-derived: the trace predicate", () => {
  it("owes a trace for Designer themes.* and assets.* and every Writer slot, nothing else", () => {
    expect(owesDirectorTrace("designer", "themes.primary")).toBe(true);
    expect(owesDirectorTrace("designer", "assets.logo")).toBe(true);
    expect(owesDirectorTrace("writer", "lexicon.avoid-patterns")).toBe(true);
    expect(owesDirectorTrace("designer", "components.button")).toBe(false);
    expect(owesDirectorTrace("designer", "sections.hero")).toBe(false);
    expect(owesDirectorTrace("publisher", "pages.home")).toBe(false);
  });

  it("reads meta.element.reason from .json and the frontmatter reason from .md", () => {
    expect(candidateReason("primary-v1.json", JSON.stringify(element("primary", "director:brand.voice")))).toBe("director:brand.voice");
    expect(candidateReason("primary-v1.json", JSON.stringify(element("primary")))).toBeUndefined();
    expect(candidateReason("primary-v1.json", "{not json")).toBeUndefined();
    expect(candidateReason("hero-v1.md", copy("director:brand.voice"))).toBe("director:brand.voice");
    expect(candidateReason("hero-v1.md", copy())).toBeUndefined();
  });

  it("parses director:<slot-id>[#key] citations, not lookalikes", () => {
    expect(directorCites("Realises director:identity.visual.style. Also director:brand.voice#tone, director:brand.voice")).toEqual(["identity.visual.style", "brand.voice"]);
    expect(directorCites("designer:themes.primary and xdirector:brand.voice and director:Brand")).toEqual([]);
  });

  it("passes a pinned Director cite and default:<ref> with one; fails everything else", () => {
    const pinned = new Set(["brand.voice"]);
    expect(directorTraceProblem("a-v1.json", "Realises director:brand.voice.", pinned)).toBeUndefined();
    expect(directorTraceProblem("a-v1.json", "default:shadcn/neutral@4.23.0 kept per director:brand.voice", pinned)).toBeUndefined();
    expect(directorTraceProblem("a-v1.json", undefined, pinned)).toMatch(/^meta\.element\.reason is missing/);
    expect(directorTraceProblem("a-v1.md", "  ", pinned)).toMatch(/^frontmatter reason is missing/);
    expect(directorTraceProblem("a-v1.json", "shadcn neutral mapped to the brand value.", pinned)).toMatch(/cites no Director slot/);
    expect(directorTraceProblem("a-v1.json", "default:shadcn/neutral@4.23.0 kept.", pinned)).toMatch(/cites no Director slot/);
    expect(directorTraceProblem("a-v1.json", "default: kept per director:brand.voice", pinned)).toMatch(/default: without naming/);
    expect(directorTraceProblem("a-v1.json", "Realises director:brand.tone.", pinned)).toMatch(/director:brand\.tone, which is not a pinned Director slot/);
  });
});

describe("R20.1 pinned Designer themes.* and assets.* cite a pinned Director slot", () => {
  it("passes traced themes and assets, and ignores other layers and unpinned slots", () => {
    expect(designerTrace(clean())).toEqual([]);
    const ctx = broken(spec => {
      // components/ui slots owe no trace; an unpinned theme has no pinned candidate to hold.
      spec.designer!["ui.button"]!.candidates = { "button-v1.json": { ...element("button"), type: "registry:ui" } };
      spec.designer!["themes.accent"] = { pin: false, candidates: { "accent-v1.json": element("accent") } };
    });
    expect(designerTrace(ctx)).toEqual([]);
  });

  it("flags a missing reason, a reason with no Director cite, an unpinned cite and a default: without a ref", () => {
    const rows = expectCatches(designerTrace, clean(), broken(spec => {
      spec.designer!["themes.primary"]!.candidates = { "primary-v1.json": element("primary") };
      spec.designer!["assets.mark"]!.candidates = { "mark-v1.json": element("mark", "shadcn neutral --primary mapped to the Foundry default brand value.") };
      spec.designer!["themes.radius"] = { candidates: { "radius-v1.json": element("radius", "Realises director:brand.tone.") } };
      spec.designer!["assets.logo"] = { candidates: { "logo-v1.json": element("logo", "default: kept, director:brand.voice") } };
    }));
    expect(rows.every(row => row.rule === "R20" && row.check === "R20.1")).toBe(true);
    expect(reasons(rows)).toEqual([
      expect.stringMatching(/^assets\.logo: pinned logo-v1\.json: meta\.element\.reason uses default: without naming/),
      expect.stringMatching(/^assets\.mark: pinned mark-v1\.json: meta\.element\.reason cites no Director slot/),
      expect.stringMatching(/^themes\.primary: pinned primary-v1\.json: meta\.element\.reason is missing/),
      expect.stringMatching(/^themes\.radius: pinned radius-v1\.json: meta\.element\.reason cites director:brand\.tone, which is not a pinned Director slot/),
    ]);
  });

  it("holds the pinned candidate, not a newer unpinned one", () => {
    const ctx = broken(spec => {
      spec.designer!["themes.primary"]!.candidates = { "primary-v1.json": element("primary"), "primary-v2.json": element("primary", "director:brand.voice") };
    });
    expect(designerTrace(ctx)).toEqual([expect.objectContaining({ slot: "themes.primary", candidate: "primary-v1.json" })]);
  });
});

describe("R20.2 pinned Writer candidates cite a pinned Director slot in their frontmatter reason", () => {
  it("passes a traced hero", () => {
    expect(writerTrace(clean())).toEqual([]);
  });

  it("flags a hero whose only trace is source.ref, and one citing an unpinned Director slot", () => {
    const rows = expectCatches(writerTrace, clean(), broken(spec => {
      spec.writer!["home.hero"]!.candidates = { "hero-v1.md": copy() };
      spec.writer!["home.lede"] = { slot: slotDoc("writer", "home.lede", { inputs: ["brand.voice"] }), candidates: { "lede-v1.md": copy("Realises director:brand.tone.").replace('"home.hero"', '"home.lede"') } };
    }));
    expect(reasons(rows)).toEqual([
      expect.stringMatching(/^home\.hero: pinned hero-v1\.md: frontmatter reason is missing/),
      expect.stringMatching(/^home\.lede: pinned lede-v1\.md: frontmatter reason cites director:brand\.tone/),
    ]);
  });
});

describe("R20 mutation proof", () => {
  it("a disabled R20 check (() => []) is silent on the broken workspace, so its test fails", () => {
    const brokenCtx = broken(spec => {
      spec.designer!["themes.primary"]!.candidates = { "primary-v1.json": element("primary") };
      spec.writer!["home.hero"]!.candidates = { "hero-v1.md": copy() };
    });
    expect(Object.keys(R20.checks)).toEqual(["R20.1", "R20.2"]);
    for (const check of Object.values(R20.checks)) {
      expect(expectCatches(check, clean(), brokenCtx).length).toBeGreaterThan(0);
      expect(() => expectCatches(() => [], clean(), brokenCtx)).toThrow(/silent on the broken workspace/);
    }
  });
});
