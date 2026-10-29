import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

type Layer = "lexicon" | "strings" | "patterns" | "narratives";
type Group = { id: string; label: string; leaves: string[] };
type IA = { layer: Layer; nodes: { id: string; label: string; children: Group[] }[] };
type Part = { id: string; required: boolean; maxChars: number; maxWords: number };
type Slot = {
  id: string; layer: Layer; requires: string[]; status: string;
  contract: { kind: string; source: string; recordKind?: string; valueType?: string; icu?: boolean; maxChars?: number;
    maxWords?: number; assetRef?: unknown; parts?: { mode: string; items: Part[] } };
};

const expected = {
  lexicon: {
    voice: {
      tone: "formality warmth energy", "person-and-mood": "person mood",
      rhythm: "sentence-length reading-level",
    },
    terminology: {
      "brand-names": "brand-names", glossary: "preferred-terms",
      "avoid-list": "avoid-terms avoid-patterns", spelling: "spelling-variant",
      pronunciation: "pronunciation",
    },
    claims: {
      "product-facts": "product-claims", metrics: "metric-claims",
      "legal-and-compliance": "compliance-statements", comparisons: "comparison-claims",
    },
    formats: {
      "numbers-and-plurals": "number-format plural-rules", "dates-and-times": "date-format time-format",
      "currency-and-units": "currency-format unit-format",
      "punctuation-and-capitalization": "capitalization punctuation",
      "direction-and-expansion": "direction expansion-budget",
    },
  },
  strings: {
    interface: { actions: "actions", navigation: "navigation", "field-labels": "field-labels common", statuses: "statuses", counters: "counters" },
    feedback: { errors: "errors", warnings: "warnings", confirmations: "confirmations", empty: "empty", loading: "loading" },
    identity: { names: "names", taglines: "taglines", "legal-lines": "legal-lines" },
    "media-text": { "alt-text": "alt-text", captions: "captions", transcripts: "transcripts" },
    metadata: { "page-titles": "page-titles", descriptions: "descriptions", "share-text": "share-text", "email-subject-and-preheader": "email-subjects email-preheaders" },
  },
  patterns: {
    headings: { headlines: "headline headline-subhead eyebrow-headline", "section-titles": "section-title" },
    actions: { "calls-to-action": "primary-action secondary-action", links: "inline-link" },
    messages: { problems: "error-message warning-message", outcomes: "confirmation", states: "empty-state", help: "hint tooltip" },
    forms: { fields: "form-field", consent: "consent-line" },
    "data-and-lists": { items: "feature-bullet stat pricing-item", tables: "table-header table-caption" },
    attribution: { quotes: "quote testimonial", figures: "figure-caption" },
    identity: { "messaging-kit": "messaging-kit" },
  },
  narratives: {
    web: { "site-and-demo": "page-story", "app-and-admin": "screen", chrome: "site-chrome app-chrome" },
    documents: { docs: "article guide release-notes legal-document", slides: "deck-script" },
    communications: { messages: "email notification", videos: "video-script" },
  },
} satisfies Record<Layer, Record<string, Record<string, string>>>;

const expectedParts: Record<string, string> = {
  headline: "headline", "headline-subhead": "headline subhead", "eyebrow-headline": "eyebrow headline",
  "section-title": "title description?", "primary-action": "verb object", "secondary-action": "verb object",
  "inline-link": "label accessible-name?", "error-message": "what why next", "warning-message": "what consequence",
  confirmation: "what-happened undo?", "empty-state": "title body action?", hint: "text", tooltip: "text",
  "form-field": "label help? error? placeholder?", "consent-line": "statement policy-link",
  "feature-bullet": "title body", stat: "value label", "pricing-item": "name price interval note?",
  "table-header": "label description?", "table-caption": "caption", quote: "quote attribution",
  testimonial: "quote person role company", "figure-caption": "caption credit?",
  "messaging-kit": "pitch-one-liner pitch-elevator pitch-paragraph boilerplate-short boilerplate-medium boilerplate-long",
};

function read<T>(path: string): T {
  return JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8")) as T;
}
function expectedIds(layer: Layer): string[] {
  return Object.values(expected[layer]).flatMap((groups) => Object.values(groups)
    .flatMap((ids) => ids.split(" ").map((id) => `${layer}.${id}`))).sort();
}

describe.each(Object.keys(expected) as Layer[])("Writer %s catalog data", (layer) => {
  it("preserves the exact permanent membership and two-level grouping", () => {
    const ia = read<IA>(`./${layer}.json`);
    expect(ia.layer).toBe(layer);
    expect(ia.nodes.map((node) => node.id)).toEqual(Object.keys(expected[layer]));
    const found: string[] = [];
    const nodeIds: string[] = [];
    for (const node of ia.nodes) {
      nodeIds.push(node.id);
      expect(node.label.trim()).not.toBe("");
      const groups = (expected as Record<Layer, Record<string, Record<string, string>>>)[layer][node.id];
      expect(node.children.map((child) => child.id)).toEqual(Object.keys(groups).map((id) => `${node.id}-${id}`));
      for (const child of node.children) {
        nodeIds.push(child.id);
        expect(child.label.trim()).not.toBe("");
        const key = child.id.slice(node.id.length + 1);
        expect(child.leaves).toEqual(groups[key].split(" ").map((id) => `${layer}.${id}`));
        found.push(...child.leaves);
      }
    }
    expect(nodeIds.every((id) => /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(id))).toBe(true);
    expect(new Set(nodeIds).size).toBe(nodeIds.length);
    expect(found.sort()).toEqual(expectedIds(layer));
    expect(found).toHaveLength({ lexicon: 27, strings: 22, patterns: 24, narratives: 12 }[layer]);
    expect(new Set(found).size).toBe(found.length);
  });

  it("provides draft contracts without consumer copy for every permanent ID", () => {
    const slots = read<Slot[]>(`../slots/${layer}.json`);
    expect(slots.map((slot) => slot.id).sort()).toEqual(expectedIds(layer));
    for (const slot of slots) {
      expect(slot.layer).toBe(layer);
      expect(slot.requires).toEqual([]);
      expect(slot.status).toBe("draft");
      expect(slot.contract.source).toBe("writer");
      expect(slot.contract.kind).toBe({ lexicon: "lexicon", strings: "string", patterns: "pattern", narratives: "narrative" }[layer]);
      expect(slot).not.toHaveProperty("text");
      expect(slot).not.toHaveProperty("value");
      expect(slot.contract).not.toHaveProperty("text");
      expect(slot.contract).not.toHaveProperty("value");
    }
  });
});

describe("Writer frozen membership baselines", () => {
  it.each(["lexicon", "strings", "patterns"] as const)("keeps %s owner-signed and membership-only", (layer) => {
    expect(read(`./${layer}.leaf-freeze.json`)).toEqual({
      schemaVersion: 1, layer, scope: "leaf-membership-only", signedHead: "0b06a262bc9447787b9e79393125f1369bfb3470", ownerSignoffComment: "clossys/workspace#45 comment 6460620037",
      policy: "Proposed membership awaiting owner signature; regrouping not membership", leafIds: expectedIds(layer).filter(id => id !== "strings.common"),
    });
  });
  it("does not freeze the still-open narratives layer", () => {
    expect(existsSync(new URL("./narratives.leaf-freeze.json", import.meta.url))).toBe(false);
  });
});

describe("Writer copy contract constraints", () => {
  it("classifies lexicon records without supplying consumer values", () => {
    const recordKinds: Record<string, string> = {
      "brand-names": "term", "preferred-terms": "term", "avoid-terms": "term",
      "avoid-patterns": "pattern-rule", "spelling-variant": "term", pronunciation: "term",
      "product-claims": "claim", "metric-claims": "claim", "compliance-statements": "claim", "comparison-claims": "claim",
    };
    for (const slot of read<Slot[]>("../slots/lexicon.json")) {
      const leaf = slot.id.slice("lexicon.".length);
      const expectedKind = recordKinds[leaf] ?? (Object.values(expected.lexicon.formats)
        .some((ids) => ids.split(" ").includes(leaf)) ? "format" : "voice-rule");
      expect(slot.contract.recordKind).toBe(expectedKind);
      expect(slot.contract.valueType).toMatch(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/);
    }
  });

  it("allows ICU and bounds string length, linking media text to an asset", () => {
    for (const slot of read<Slot[]>("../slots/strings.json")) {
      expect(slot.contract.icu).toBe(true);
      expect(Number.isInteger(slot.contract.maxChars)).toBe(true);
      expect(Number.isInteger(slot.contract.maxWords)).toBe(true);
      expect(slot.contract.maxChars).toBeGreaterThan(0);
      expect(slot.contract.maxWords).toBeGreaterThan(0);
      if (["strings.alt-text", "strings.captions", "strings.transcripts"].includes(slot.id)) {
        expect(slot.contract.assetRef).toEqual({ layer: "assets", required: true });
      } else {
        expect(slot.contract.assetRef).toBeUndefined();
      }
    }
  });

  it("declares each closed pattern part, optionality and draft limits", () => {
    for (const slot of read<Slot[]>("../slots/patterns.json")) {
      expect(slot.contract.icu).toBe(true);
      expect(slot.contract.parts?.mode).toBe("closed");
      const expected = expectedParts[slot.id.slice("patterns.".length)].split(" ");
      expect(slot.contract.parts?.items.map(({ id, required }) => ({ id, required }))).toEqual(
        expected.map((part) => ({ id: part.replace(/\?$/, ""), required: !part.endsWith("?") })),
      );
      for (const part of slot.contract.parts!.items) {
        expect(Number.isInteger(part.maxChars)).toBe(true);
        expect(Number.isInteger(part.maxWords)).toBe(true);
        expect(part.maxChars).toBeGreaterThan(0);
        expect(part.maxWords).toBeGreaterThan(0);
      }
    }
  });
});
