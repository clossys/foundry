import { describe, expect, it } from "vitest";
import type { ComposeDocument } from "@vespeneventures/compose";
import { renderSlidesDeck } from "./renderSlidesDeck.js";
import type { SlidesDeckInput } from "./types.js";
import { RenderError } from "../internal/errors.js";

function slide(id: string, aspect: "16:9" | "4:3" = "16:9", overrides: Partial<ComposeDocument> = {}): ComposeDocument {
  return {
    id,
    channel: "slides",
    template: "title-slide",
    meta: { channel: "slides", aspect },
    layout: {
      slots: [{ key: "title", element: "heading", frame: { x: 0.1, y: 0.4, w: 0.8, h: 0.2 }, required: true }],
    },
    bindings: [{ slot: "title", value: `Slide ${id}` }],
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Order is explicit — array index, never inferred
// ─────────────────────────────────────────────────────────────────────────

describe("deck order", () => {
  it("RenderedSlide.index and array position match SlidesDeckInput.slides order, even when ids sort the other way", () => {
    const deck: SlidesDeckInput = { id: "deck-1", slides: [slide("z-last"), slide("a-first")] };
    const result = renderSlidesDeck(deck);
    expect(result.slides.map((s) => s.id)).toEqual(["z-last", "a-first"]);
    expect(result.slides.map((s) => s.index)).toEqual([0, 1]);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Canvas size from aspect
// ─────────────────────────────────────────────────────────────────────────

describe("canvas size from aspect", () => {
  it("16:9 -> 1920x1080", () => {
    const result = renderSlidesDeck({ id: "d", slides: [slide("s1", "16:9")] });
    expect(result.width).toBe(1920);
    expect(result.height).toBe(1080);
    expect(result.aspect).toBe("16:9");
  });

  it("4:3 -> 1024x768", () => {
    const result = renderSlidesDeck({ id: "d", slides: [slide("s1", "4:3")] });
    expect(result.width).toBe(1024);
    expect(result.height).toBe(768);
    expect(result.aspect).toBe("4:3");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Notes — deck-level, keyed by slide id, unknown keys reported not dropped
// ─────────────────────────────────────────────────────────────────────────

describe("notes", () => {
  it("carries a note through to the matching slide's own result", () => {
    const deck: SlidesDeckInput = {
      id: "d",
      slides: [slide("intro"), slide("outro")],
      notes: { intro: "Say hello warmly.", outro: "Thank the audience." },
    };
    const result = renderSlidesDeck(deck);
    expect(result.slides[0]!.notes).toBe("Say hello warmly.");
    expect(result.slides[1]!.notes).toBe("Thank the audience.");
    expect(result.unknownNoteKeys).toEqual([]);
  });

  it("leaves `notes` absent (not an empty string) on a slide with no matching note", () => {
    const deck: SlidesDeckInput = { id: "d", slides: [slide("only")] };
    const result = renderSlidesDeck(deck);
    expect(result.slides[0]!.notes).toBeUndefined();
    expect("notes" in result.slides[0]!).toBe(false);
  });

  it("REFUSAL-ADJACENT: a notes key naming no slide is reported in unknownNoteKeys, never dropped, and never throws", () => {
    const deck: SlidesDeckInput = {
      id: "d",
      slides: [slide("real-slide")],
      notes: { "real-slide": "kept", "renamed-slide-old-id": "orphaned note" },
    };
    const result = renderSlidesDeck(deck);
    expect(result.unknownNoteKeys).toEqual(["renamed-slide-old-id"]);
    expect(result.slides).toHaveLength(1); // did not throw; rendered fine
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Refusal paths
// ─────────────────────────────────────────────────────────────────────────

describe("refusal paths", () => {
  it("wrong channel: a slide document with channel !== 'slides'", () => {
    const badSlide = slide("bad", "16:9", { channel: "image" as ComposeDocument["channel"] });
    const deck: SlidesDeckInput = { id: "d", slides: [slide("good"), badSlide] };
    try {
      renderSlidesDeck(deck);
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(RenderError);
      expect((error as RenderError).reason).toBe("wrong-channel");
      expect((error as RenderError).message).toContain("slide 1");
      expect((error as RenderError).message).toContain('id="bad"');
    }
  });

  it("empty deck: zero slides", () => {
    const deck: SlidesDeckInput = { id: "empty-deck", slides: [] };
    try {
      renderSlidesDeck(deck);
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(RenderError);
      expect((error as RenderError).reason).toBe("resolution-failed");
      expect((error as RenderError).message).toContain("zero slides");
    }
  });

  it("inconsistent aspect across slides", () => {
    const deck: SlidesDeckInput = { id: "d", slides: [slide("s1", "16:9"), slide("s2", "4:3")] };
    try {
      renderSlidesDeck(deck);
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(RenderError);
      expect((error as RenderError).reason).toBe("inconsistent-deck-aspect");
      expect((error as RenderError).message).toContain('slide 1 (id="s2")');
    }
  });

  it("failed resolution on one slide fails the whole deck, naming the slide", () => {
    const badSlide = slide("bad", "16:9", { bindings: [] });
    const deck: SlidesDeckInput = { id: "d", slides: [slide("good"), badSlide] };
    try {
      renderSlidesDeck(deck);
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(RenderError);
      expect((error as RenderError).reason).toBe("resolution-failed");
      expect((error as RenderError).message).toContain('slide 1 (id="bad")');
    }
  });

  it("empty output: a required slot's copyId never resolves", () => {
    const badSlide = slide("bad", "16:9", { bindings: [{ slot: "title", copyId: "unresolvable.copy.id" }] });
    const deck: SlidesDeckInput = { id: "d", slides: [badSlide] };
    try {
      renderSlidesDeck(deck);
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(RenderError);
      expect((error as RenderError).reason).toBe("empty-output");
    }
  });

  it("missing layout on a slide", () => {
    const badSlide = slide("bad", "16:9", { layout: undefined });
    const deck: SlidesDeckInput = { id: "d", slides: [badSlide] };
    try {
      renderSlidesDeck(deck);
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(RenderError);
      expect((error as RenderError).reason).toBe("resolution-failed");
      expect((error as RenderError).message).toContain("requires a layout");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Warnings roll up per slide, prefixed with the slide id
// ─────────────────────────────────────────────────────────────────────────

describe("warning rollup", () => {
  it("aggregates each slide's own warnings, prefixed with its id", () => {
    const cramped = slide("cramped-slide", "16:9", {
      layout: { slots: [{ key: "title", element: "heading", frame: { x: 0.1, y: 0.1, w: 0.1, h: 0.05 }, required: true }] },
      bindings: [{ slot: "title", value: "This heading is far too long for such a tiny frame and must overflow" }],
    });
    const deck: SlidesDeckInput = { id: "d", slides: [cramped] };
    const result = renderSlidesDeck(deck);
    expect(result.warnings.some((w) => w.startsWith('slide "cramped-slide": ') && w.includes("overflowed"))).toBe(true);
    expect(result.slides[0]!.warnings.some((w) => w.includes("overflowed"))).toBe(true);
  });
});
