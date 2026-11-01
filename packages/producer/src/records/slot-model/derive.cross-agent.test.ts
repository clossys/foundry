import { describe, expect, it } from "vitest";
import { deriveRefs, feedsIndex, toSlotId } from "./derive.js";

// Synthetic F9/F10 wiring only: these fixtures do not demonstrate readiness,
// pins, rendering, production catalog completeness, or owner approval.
const ids = {
  brief: "identity.synthetic.brief",
  source: "identity.synthetic.source",
  requiredCopy: "lexicon.synthetic",
  copy: "strings.synthetic",
  theme: "themes.synthetic",
  button: "components.synthetic-button",
  section: "sections.synthetic",
  frame: "frames.synthetic",
  page: "page.synthetic",
  publication: "publication.synthetic",
} as const;

function fixture() {
  const known = new Set<string>(Object.values(ids));
  const director = {
    inputs: [ids.source, `director:${ids.source}@1`],
    feeds: [
      `writer:${ids.copy}@2`, ids.copy,
      `designer:${ids.section}@1`, ids.section,
      "writer:strings.absent@1",
    ],
  };
  const feeds = feedsIndex([
    [ids.brief, director.feeds],
    [ids.brief, director.feeds],
  ], known);
  return { known, feeds, director };
}

describe("synthetic cross-agent composition (F9/F10)", () => {
  it("inverts one Director brief into exactly the Writer and Designer feeds", () => {
    const ctx = fixture();
    expect([...ctx.feeds.keys()].sort()).toEqual([ids.section, ids.copy]);
    expect(ctx.feeds.get(ids.copy)).toEqual([ids.brief]);
    expect(ctx.feeds.get(ids.section)).toEqual([ids.brief]);
    expect(deriveRefs("director", "brief", ids.brief, { inputs: ctx.director.inputs }, ctx))
      .toEqual({ inputs: [ids.source], uses: [], dropped: [] });
  });

  it("combines Writer requires with its Director feed and removes self references", () => {
    const ctx = fixture();
    const requires = [`writer:${ids.requiredCopy}@3`, ids.requiredCopy];
    expect(deriveRefs("writer", "strings", ids.copy, {
      inputs: [...requires, ids.brief, `writer:${ids.copy}@2`, ids.copy],
      uses: [`writer:${ids.copy}@1`, ids.copy],
    }, ctx)).toEqual({
      inputs: [ids.brief, ids.requiredCopy], uses: [], dropped: [],
    });
    // The feed must survive when it is absent from explicit inputs.
    expect(deriveRefs("writer", "strings", ids.copy, { inputs: requires }, ctx).inputs)
      .toEqual([ids.brief, ids.requiredCopy]);
  });

  it("maps Designer contract uses and retains its Director feed", () => {
    const ctx = fixture();
    const contract = {
      requires: [`designer:${ids.theme}@1`],
      composes: ["@synthetic/registry/synthetic-button", ids.button],
    };
    expect(deriveRefs("designer", "element", ids.section, {
      uses: [...contract.composes, ...contract.requires, ids.theme],
    }, ctx)).toEqual({
      inputs: [ids.brief], uses: [ids.button, ids.theme], dropped: [],
    });
  });

  it("composes Publisher page inputs from frame, sections and Writer copy, then publication", () => {
    const ctx = fixture();
    // Select the downstream slots using the same supported reference spellings.
    const copy = toSlotId(`writer:${ids.copy}@2`, ctx.known);
    const section = toSlotId(`@synthetic/registry/${ids.section}`, ctx.known);
    expect(copy).toBe(ids.copy);
    expect(section).toBe(ids.section);
    const page = deriveRefs("publisher", "page", ids.page, {
      uses: [copy!, section!, `designer:${ids.frame}@1`, `writer:${ids.copy}@2`, ids.section],
      inputs: [ids.brief],
    }, ctx);
    expect(page).toEqual({
      inputs: [ids.frame, ids.section, ids.copy],
      uses: [ids.frame, ids.section, ids.copy], dropped: [],
    });
    expect(deriveRefs("publisher", "publication", ids.publication, {
      uses: [`publisher:${ids.page}@1`, ids.page],
    }, ctx)).toEqual({ inputs: [ids.page], uses: [ids.page], dropped: [] });
  });

  it("drops unknown and absent targets in sorted deduplicated order across inputs and uses", () => {
    const ctx = fixture();
    expect(deriveRefs("writer", "strings", ids.copy, {
      inputs: ["writer:strings.absent@1", ids.requiredCopy, "missing.ref", "missing.ref"],
      uses: ["missing.ref", "designer:sections.absent@1", ids.button, "writer:strings.absent@1"],
    }, ctx)).toEqual({
      inputs: [ids.brief, ids.requiredCopy], uses: [ids.button],
      dropped: ["designer:sections.absent@1", "missing.ref", "writer:strings.absent@1"],
    });
    expect(ctx.known.has("strings.absent")).toBe(false);
    expect(ctx.feeds.has("strings.absent")).toBe(false);
  });

  it("leaves empty feeds and absent or empty raw refs empty for every agent", () => {
    const known = new Set<string>(Object.values(ids));
    const feeds = feedsIndex([], known);
    expect([...feeds]).toEqual([]);
    const ctx = { known, feeds };
    for (const raw of [{}, { inputs: [], uses: [] }]) {
      expect(deriveRefs("director", "brief", ids.brief, raw, ctx)).toEqual({ inputs: [], uses: [], dropped: [] });
      expect(deriveRefs("writer", "strings", ids.copy, raw, ctx)).toEqual({ inputs: [], uses: [], dropped: [] });
      expect(deriveRefs("designer", "element", ids.section, raw, ctx)).toEqual({ inputs: [], uses: [], dropped: [] });
      expect(deriveRefs("publisher", "page", ids.page, raw, ctx)).toEqual({ inputs: [], uses: [], dropped: [] });
      expect(deriveRefs("publisher", "publication", ids.publication, raw, ctx)).toEqual({ inputs: [], uses: [], dropped: [] });
    }
  });
});
