import { describe, expect, it } from "vitest";
import { parseAssetRecord, validateAssetRecordShape } from "./schema.js";

const validImageEntry = {
  id: "marketing.hero-banner",
  type: "image",
  src: "/images/hero-banner.png",
  width: 1600,
  height: 900,
  alt: "Illustration of a laptop showing a dashboard",
};

const validVideoEntry = {
  id: "marketing.hero-video",
  type: "video",
  sources: [{ src: "/videos/hero.mp4", mimeType: "video/mp4" }],
  width: 1920,
  height: 1080,
  alt: "A product demo video",
  transcript: "A full transcript of the video.",
  reducedMotion: "no-autoplay",
};

const validRecord = { id: "acme-app", entries: [validImageEntry] };

describe("validateAssetRecordShape — clean input", () => {
  it("reports zero findings for a well-formed image record", () => {
    expect(validateAssetRecordShape(validRecord)).toEqual([]);
  });

  it("reports zero findings for a well-formed video record", () => {
    expect(validateAssetRecordShape({ id: "acme-app", entries: [validVideoEntry] })).toEqual([]);
  });

  it("reports zero findings for a record mixing image and video entries", () => {
    expect(validateAssetRecordShape({ id: "acme-app", entries: [validImageEntry, validVideoEntry] })).toEqual([]);
  });

  it("accepts optional mimeType/licence/credit when present and well-formed", () => {
    const findings = validateAssetRecordShape({
      id: "acme-app",
      entries: [{ ...validImageEntry, mimeType: "image/png", licence: "CC-BY-4.0", credit: "Photo by Jane Doe" }],
    });
    expect(findings).toEqual([]);
  });

  it("a zero-entry record is well-formed as far as this function is concerned", () => {
    expect(validateAssetRecordShape({ id: "acme-app", entries: [] })).toEqual([]);
  });
});

describe("validateAssetRecordShape — record-level shape", () => {
  it("rejects a non-object value", () => {
    const findings = validateAssetRecordShape("not an object");
    expect(findings).toHaveLength(1);
    expect(findings[0]?.rule).toBe("record-present");
  });

  it("rejects null", () => {
    expect(validateAssetRecordShape(null)[0]?.rule).toBe("record-present");
  });

  it("flags a missing/empty id", () => {
    const findings = validateAssetRecordShape({ id: "", entries: [] });
    expect(findings.some((f) => f.rule === "id-shape")).toBe(true);
  });

  it("flags entries not being an array", () => {
    const findings = validateAssetRecordShape({ id: "acme", entries: "nope" });
    expect(findings.some((f) => f.rule === "entries-shape")).toBe(true);
  });
});

describe("validateAssetRecordShape — id uniqueness (FIXTURE: duplicate id)", () => {
  it("flags a duplicate entry id", () => {
    const findings = validateAssetRecordShape({
      id: "acme-app",
      entries: [validImageEntry, { ...validImageEntry }],
    });
    const dup = findings.find((f) => f.rule === "id-unique");
    expect(dup).toBeDefined();
    expect(dup?.message).toMatch(/duplicates/);
  });

  it("does not flag two entries whose ids merely fail id-shape separately (no double-reporting of the same root cause)", () => {
    const findings = validateAssetRecordShape({
      id: "acme-app",
      entries: [
        { ...validImageEntry, id: "" },
        { ...validImageEntry, id: "" },
      ],
    });
    expect(findings.some((f) => f.rule === "id-unique")).toBe(false);
  });
});

describe("validateAssetRecordShape — entry id well-formedness", () => {
  it("rejects an empty id", () => {
    const findings = validateAssetRecordShape({ id: "acme", entries: [{ ...validImageEntry, id: "" }] });
    expect(findings.some((f) => f.rule === "id-shape")).toBe(true);
  });

  it("rejects a bare, unnamespaced id (no dot)", () => {
    const findings = validateAssetRecordShape({ id: "acme", entries: [{ ...validImageEntry, id: "hero" }] });
    expect(findings.some((f) => f.rule === "id-well-formed")).toBe(true);
  });

  it("rejects an uppercase id", () => {
    const findings = validateAssetRecordShape({ id: "acme", entries: [{ ...validImageEntry, id: "Marketing.Hero" }] });
    expect(findings.some((f) => f.rule === "id-well-formed")).toBe(true);
  });

  it("accepts a well-formed multi-segment id", () => {
    const findings = validateAssetRecordShape({
      id: "acme",
      entries: [{ ...validImageEntry, id: "onboarding.step-2.illustration" }],
    });
    expect(findings).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// type — the v2 discriminator
// ---------------------------------------------------------------------------

describe("validateAssetRecordShape — type (issue #177 — the v2 discriminator)", () => {
  it("rejects an entry with no type at all — the v1-shaped fixture, unmigrated", () => {
    const { type: _drop, ...v1Shaped } = validImageEntry;
    const findings = validateAssetRecordShape({ id: "acme", entries: [v1Shaped] });
    const finding = findings.find((f) => f.rule === "type-shape");
    expect(finding).toBeDefined();
    expect(finding?.message).toMatch(/must be one of image, video/);
  });

  it("rejects an unknown type value", () => {
    const findings = validateAssetRecordShape({ id: "acme", entries: [{ ...validImageEntry, type: "audio" }] });
    expect(findings.some((f) => f.rule === "type-shape")).toBe(true);
  });

  it("a type-shape failure short-circuits — no other per-field findings pile on for the same malformed entry", () => {
    const findings = validateAssetRecordShape({ id: "acme", entries: [{ type: "bogus" }] });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.rule).toBe("type-shape");
  });
});

// ---------------------------------------------------------------------------
// image-specific
// ---------------------------------------------------------------------------

describe("validateAssetRecordShape — image src", () => {
  it("rejects a missing src", () => {
    const { src: _drop, ...rest } = validImageEntry;
    const findings = validateAssetRecordShape({ id: "acme", entries: [rest] });
    expect(findings.some((f) => f.rule === "src-shape")).toBe(true);
  });

  it("rejects a whitespace-only src", () => {
    const findings = validateAssetRecordShape({ id: "acme", entries: [{ ...validImageEntry, src: "   " }] });
    expect(findings.some((f) => f.rule === "src-shape")).toBe(true);
  });
});

describe("validateAssetRecordShape — image dimensions (FIXTURE: non-positive dimension)", () => {
  it("rejects a zero width", () => {
    const findings = validateAssetRecordShape({ id: "acme", entries: [{ ...validImageEntry, width: 0 }] });
    expect(findings.find((f) => f.rule === "width-positive")).toBeDefined();
  });

  it("rejects a negative height", () => {
    const findings = validateAssetRecordShape({ id: "acme", entries: [{ ...validImageEntry, height: -10 }] });
    expect(findings.find((f) => f.rule === "height-positive")).toBeDefined();
  });

  it("rejects a non-finite width (NaN)", () => {
    const findings = validateAssetRecordShape({ id: "acme", entries: [{ ...validImageEntry, width: NaN }] });
    expect(findings.some((f) => f.rule === "width-positive")).toBe(true);
  });

  it("rejects a non-numeric height", () => {
    const findings = validateAssetRecordShape({ id: "acme", entries: [{ ...validImageEntry, height: "900" }] });
    expect(findings.some((f) => f.rule === "height-positive")).toBe(true);
  });
});

describe("validateAssetRecordShape — image sources (responsive images, issue #177)", () => {
  it("accepts a well-formed sources array", () => {
    const findings = validateAssetRecordShape({
      id: "acme",
      entries: [
        {
          ...validImageEntry,
          sources: [
            { src: "/images/hero-banner.avif", width: 1600, format: "image/avif" },
            { src: "/images/hero-banner-800.png", width: 800 },
          ],
        },
      ],
    });
    expect(findings).toEqual([]);
  });

  it("omitting sources entirely is valid — degrades to v1 single-<img> behavior", () => {
    expect(validateAssetRecordShape({ id: "acme", entries: [validImageEntry] })).toEqual([]);
  });

  it("rejects sources that is not an array", () => {
    const findings = validateAssetRecordShape({ id: "acme", entries: [{ ...validImageEntry, sources: "nope" }] });
    expect(findings.some((f) => f.rule === "image-sources-shape")).toBe(true);
  });

  it("rejects a source with no src", () => {
    const findings = validateAssetRecordShape({ id: "acme", entries: [{ ...validImageEntry, sources: [{ width: 800 }] }] });
    expect(findings.some((f) => f.rule === "image-source-src-shape")).toBe(true);
  });

  it("rejects a source with a non-positive width", () => {
    const findings = validateAssetRecordShape({
      id: "acme",
      entries: [{ ...validImageEntry, sources: [{ src: "/x.png", width: 0 }] }],
    });
    expect(findings.some((f) => f.rule === "image-source-width-positive")).toBe(true);
  });

  it("rejects a source with an empty format when present", () => {
    const findings = validateAssetRecordShape({
      id: "acme",
      entries: [{ ...validImageEntry, sources: [{ src: "/x.png", width: 800, format: "" }] }],
    });
    expect(findings.some((f) => f.rule === "image-source-format-shape")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// video-specific (issue #177)
// ---------------------------------------------------------------------------

describe("validateAssetRecordShape — video dimensions", () => {
  it("rejects a zero width", () => {
    const findings = validateAssetRecordShape({ id: "acme", entries: [{ ...validVideoEntry, width: 0 }] });
    expect(findings.some((f) => f.rule === "width-positive")).toBe(true);
  });

  it("rejects a non-positive height", () => {
    const findings = validateAssetRecordShape({ id: "acme", entries: [{ ...validVideoEntry, height: -1 }] });
    expect(findings.some((f) => f.rule === "height-positive")).toBe(true);
  });
});

describe("validateAssetRecordShape — video-sources-non-empty", () => {
  it("rejects a missing sources field", () => {
    const { sources: _drop, ...rest } = validVideoEntry;
    const findings = validateAssetRecordShape({ id: "acme", entries: [rest] });
    expect(findings.some((f) => f.rule === "video-sources-shape")).toBe(true);
  });

  it("rejects an empty sources array — a video with zero playable sources", () => {
    const findings = validateAssetRecordShape({ id: "acme", entries: [{ ...validVideoEntry, sources: [] }] });
    const finding = findings.find((f) => f.rule === "video-sources-non-empty");
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("error");
  });

  it("rejects a source with no mimeType — a <source> needs a real type", () => {
    const findings = validateAssetRecordShape({
      id: "acme",
      entries: [{ ...validVideoEntry, sources: [{ src: "/videos/hero.mp4" }] }],
    });
    expect(findings.some((f) => f.rule === "video-source-mime-type-shape")).toBe(true);
  });

  it("rejects a source with no src", () => {
    const findings = validateAssetRecordShape({
      id: "acme",
      entries: [{ ...validVideoEntry, sources: [{ mimeType: "video/mp4" }] }],
    });
    expect(findings.some((f) => f.rule === "video-source-src-shape")).toBe(true);
  });

  it("accepts more than one source (multiple formats)", () => {
    const findings = validateAssetRecordShape({
      id: "acme",
      entries: [{ ...validVideoEntry, sources: [{ src: "/hero.mp4", mimeType: "video/mp4" }, { src: "/hero.webm", mimeType: "video/webm" }] }],
    });
    expect(findings).toEqual([]);
  });
});

describe("validateAssetRecordShape — video-caption-or-transcript-required", () => {
  it("rejects an entry with neither captions nor transcript", () => {
    const { transcript: _drop, ...rest } = validVideoEntry;
    const findings = validateAssetRecordShape({ id: "acme", entries: [rest] });
    const finding = findings.find((f) => f.rule === "video-caption-or-transcript-required");
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("error");
  });

  it("accepts transcript alone", () => {
    const findings = validateAssetRecordShape({ id: "acme", entries: [validVideoEntry] });
    expect(findings).toEqual([]);
  });

  it("accepts captions alone", () => {
    const { transcript: _drop, ...rest } = validVideoEntry;
    const findings = validateAssetRecordShape({
      id: "acme",
      entries: [{ ...rest, captions: [{ src: "/captions/en.vtt", srclang: "en", label: "English" }] }],
    });
    expect(findings).toEqual([]);
  });

  it("accepts both captions and transcript together", () => {
    const findings = validateAssetRecordShape({
      id: "acme",
      entries: [{ ...validVideoEntry, captions: [{ src: "/captions/en.vtt", srclang: "en", label: "English" }] }],
    });
    expect(findings).toEqual([]);
  });

  it("a whitespace-only transcript does NOT satisfy the requirement — malformed is never treated as present", () => {
    const findings = validateAssetRecordShape({ id: "acme", entries: [{ ...validVideoEntry, transcript: "   " }] });
    expect(findings.some((f) => f.rule === "video-transcript-shape")).toBe(true);
    expect(findings.some((f) => f.rule === "video-caption-or-transcript-required")).toBe(true);
  });

  it("an empty captions array does NOT satisfy the requirement", () => {
    const { transcript: _drop, ...rest } = validVideoEntry;
    const findings = validateAssetRecordShape({ id: "acme", entries: [{ ...rest, captions: [] }] });
    expect(findings.some((f) => f.rule === "video-caption-or-transcript-required")).toBe(true);
  });

  it("a malformed caption entry does NOT count toward satisfying the requirement", () => {
    const { transcript: _drop, ...rest } = validVideoEntry;
    const findings = validateAssetRecordShape({ id: "acme", entries: [{ ...rest, captions: [{ src: "/x.vtt" }] }] });
    expect(findings.some((f) => f.rule === "video-caption-or-transcript-required")).toBe(true);
    expect(findings.some((f) => f.rule === "video-caption-srclang-shape")).toBe(true);
  });

  it("rejects a caption missing srclang/label", () => {
    const findings = validateAssetRecordShape({
      id: "acme",
      entries: [{ ...validVideoEntry, captions: [{ src: "/x.vtt", srclang: "", label: "" }] }],
    });
    expect(findings.some((f) => f.rule === "video-caption-srclang-shape")).toBe(true);
    expect(findings.some((f) => f.rule === "video-caption-label-shape")).toBe(true);
  });
});

describe("validateAssetRecordShape — video-reduced-motion-required", () => {
  it("rejects a missing reducedMotion", () => {
    const { reducedMotion: _drop, ...rest } = validVideoEntry;
    const findings = validateAssetRecordShape({ id: "acme", entries: [rest] });
    const finding = findings.find((f) => f.rule === "video-reduced-motion-required");
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("error");
  });

  it("rejects an unknown reducedMotion value", () => {
    const findings = validateAssetRecordShape({ id: "acme", entries: [{ ...validVideoEntry, reducedMotion: "sometimes" }] });
    expect(findings.some((f) => f.rule === "video-reduced-motion-required")).toBe(true);
  });

  it.each(["pause", "no-autoplay"] as const)("accepts reducedMotion %s with no poster", (value) => {
    const findings = validateAssetRecordShape({ id: "acme", entries: [{ ...validVideoEntry, reducedMotion: value }] });
    expect(findings).toEqual([]);
  });
});

describe("validateAssetRecordShape — video-static-poster-requires-poster", () => {
  it("rejects reducedMotion: static-poster with no poster", () => {
    const findings = validateAssetRecordShape({ id: "acme", entries: [{ ...validVideoEntry, reducedMotion: "static-poster" }] });
    const finding = findings.find((f) => f.rule === "video-static-poster-requires-poster");
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("error");
  });

  it("accepts reducedMotion: static-poster WITH a poster", () => {
    const findings = validateAssetRecordShape({
      id: "acme",
      entries: [{ ...validVideoEntry, reducedMotion: "static-poster", poster: "/images/hero-poster.png" }],
    });
    expect(findings).toEqual([]);
  });

  it("rejects a whitespace-only poster", () => {
    const findings = validateAssetRecordShape({
      id: "acme",
      entries: [{ ...validVideoEntry, reducedMotion: "static-poster", poster: "   " }],
    });
    expect(findings.some((f) => f.rule === "video-poster-shape")).toBe(true);
  });
});

describe("validateAssetRecordShape — video autoplay/loop/muted shape", () => {
  it("accepts booleans", () => {
    const findings = validateAssetRecordShape({ id: "acme", entries: [{ ...validVideoEntry, autoplay: true, loop: false, muted: true }] });
    expect(findings).toEqual([]);
  });

  it("rejects a non-boolean autoplay", () => {
    const findings = validateAssetRecordShape({ id: "acme", entries: [{ ...validVideoEntry, autoplay: "yes" }] });
    expect(findings.some((f) => f.rule === "video-autoplay-shape")).toBe(true);
  });

  it("rejects a non-boolean loop", () => {
    const findings = validateAssetRecordShape({ id: "acme", entries: [{ ...validVideoEntry, loop: "yes" }] });
    expect(findings.some((f) => f.rule === "video-loop-shape")).toBe(true);
  });

  it("rejects a non-boolean muted", () => {
    const findings = validateAssetRecordShape({ id: "acme", entries: [{ ...validVideoEntry, muted: "yes" }] });
    expect(findings.some((f) => f.rule === "video-muted-shape")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// shared base fields — alt, mimeType, licence, credit
// ---------------------------------------------------------------------------

describe("validateAssetRecordShape — alt (FIXTURE: whitespace-only alt)", () => {
  it("rejects a missing alt on an image entry", () => {
    const { alt: _drop, ...rest } = validImageEntry;
    const findings = validateAssetRecordShape({ id: "acme", entries: [rest] });
    expect(findings.some((f) => f.rule === "alt-shape")).toBe(true);
  });

  it("rejects an empty-string alt", () => {
    const findings = validateAssetRecordShape({ id: "acme", entries: [{ ...validImageEntry, alt: "" }] });
    expect(findings.some((f) => f.rule === "alt-shape")).toBe(true);
  });

  it("rejects a whitespace-only alt distinctly from empty-string (alt-not-whitespace-only)", () => {
    const findings = validateAssetRecordShape({ id: "acme", entries: [{ ...validImageEntry, alt: "   " }] });
    const f = findings.find((x) => x.rule === "alt-not-whitespace-only");
    expect(f).toBeDefined();
    expect(f?.message).toMatch(/whitespace-only/);
    // and NOT double-reported as alt-shape too
    expect(findings.some((x) => x.rule === "alt-shape")).toBe(false);
  });

  it("rejects a tab/newline-only alt", () => {
    const findings = validateAssetRecordShape({ id: "acme", entries: [{ ...validImageEntry, alt: "\n\t " }] });
    expect(findings.some((f) => f.rule === "alt-not-whitespace-only")).toBe(true);
  });

  it("rejects a missing alt on a video entry too — the base check applies to both types", () => {
    const { alt: _drop, ...rest } = validVideoEntry;
    const findings = validateAssetRecordShape({ id: "acme", entries: [rest] });
    expect(findings.some((f) => f.rule === "alt-shape")).toBe(true);
  });
});

describe("validateAssetRecordShape — optional fields (shared across image and video)", () => {
  it("rejects an empty mimeType when present", () => {
    const findings = validateAssetRecordShape({ id: "acme", entries: [{ ...validImageEntry, mimeType: "" }] });
    expect(findings.some((f) => f.rule === "mime-type-shape")).toBe(true);
  });

  it("rejects an empty licence when present", () => {
    const findings = validateAssetRecordShape({ id: "acme", entries: [{ ...validImageEntry, licence: "" }] });
    expect(findings.some((f) => f.rule === "licence-shape")).toBe(true);
  });

  it("rejects an empty credit when present", () => {
    const findings = validateAssetRecordShape({ id: "acme", entries: [{ ...validImageEntry, credit: "" }] });
    expect(findings.some((f) => f.rule === "credit-shape")).toBe(true);
  });

  it("licence stays OPTIONAL — an entry with no licence at all is still schema-valid (see coverage.ts's asset-missing-licence for where this is surfaced instead)", () => {
    expect(validateAssetRecordShape({ id: "acme", entries: [validImageEntry] })).toEqual([]);
  });
});

describe("parseAssetRecord", () => {
  it("returns a fully-typed AssetRecord for valid image input", () => {
    const record = parseAssetRecord(validRecord);
    expect(record.id).toBe("acme-app");
    expect(record.entries).toHaveLength(1);
    expect(record.entries[0]?.alt).toBe(validImageEntry.alt);
    expect(record.entries[0]?.type).toBe("image");
  });

  it("returns a fully-typed AssetRecord for valid video input, preserving video-only fields", () => {
    const record = parseAssetRecord({ id: "acme-app", entries: [validVideoEntry] });
    const entry = record.entries[0];
    expect(entry?.type).toBe("video");
    if (entry?.type === "video") {
      expect(entry.sources).toEqual(validVideoEntry.sources);
      expect(entry.reducedMotion).toBe("no-autoplay");
    }
  });

  it("throws a plain Error listing every issue for invalid input", () => {
    expect(() => parseAssetRecord({ id: "acme", entries: [{ ...validImageEntry, alt: "   " }] })).toThrow(
      /alt-not-whitespace-only|whitespace-only/,
    );
  });

  it("throws for a v1-shaped entry with no type at all — the required v1-to-v2 migration", () => {
    const { type: _drop, ...v1Shaped } = validImageEntry;
    expect(() => parseAssetRecord({ id: "acme", entries: [v1Shaped] })).toThrow(/type-shape|type must be one of/);
  });

  it("never throws for a merely-malformed top-level value — it throws a descriptive Error, not an unrelated exception", () => {
    expect(() => parseAssetRecord(null)).toThrow(/AssetRecord/);
  });
});
