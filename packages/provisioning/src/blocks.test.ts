import { describe, expect, it } from "vitest";
import {
  composeManagedBlock,
  hasExactlyOneBlock,
  renderManagedBlock,
  withoutManagedBlock,
} from "./blocks.js";

const start = "# >>> managed >>>";
const end = "# <<< managed <<<";

describe("withoutManagedBlock", () => {
  it("returns content untouched when no markers are present", () => {
    expect(withoutManagedBlock("alias mine=x", start, end)).toBe("alias mine=x");
  });

  it("removes the block and collapses the gap it leaves", () => {
    const contents = `before\n\n${start}\nbody\n${end}\n\nafter`;
    expect(withoutManagedBlock(contents, start, end)).toBe("before\n\nafter");
  });

  // Guessing here means picking one of two blocks to overwrite and silently
  // discarding whatever sat between them, in a file the engine does not own.
  it("refuses duplicated markers", () => {
    const contents = `${start}\na\n${end}\n${start}\nb\n${end}`;
    expect(() => withoutManagedBlock(contents, start, end)).toThrow(/Duplicate/);
  });

  it("refuses markers in the wrong order or half-present", () => {
    expect(() => withoutManagedBlock(`${end}\nbody\n${start}`, start, end)).toThrow(/Malformed/);
    expect(() => withoutManagedBlock(`${start}\nbody`, start, end)).toThrow(/Malformed/);
  });
});

describe("composeManagedBlock", () => {
  it("appends the block below the operator's own content", () => {
    expect(composeManagedBlock("alias mine=x", "body", start, end)).toBe(
      `alias mine=x\n\n${start}\nbody\n${end}\n`,
    );
  });

  it("replaces an existing block rather than adding a second", () => {
    const existing = `alias mine=x\n\n${start}\nold\n${end}\n`;
    expect(composeManagedBlock(existing, "new", start, end)).toBe(
      `alias mine=x\n\n${start}\nnew\n${end}\n`,
    );
  });

  // The migration this engine keeps meeting: a destination that was once the
  // whole source file, before markers existed. Preserved as "the operator's
  // own", it would duplicate every line.
  it("recognizes a pre-marker wholesale copy and replaces it exactly once", () => {
    expect(composeManagedBlock("body\n", "body", start, end, "body")).toBe(
      `${start}\nbody\n${end}\n`,
    );
  });

  it("produces a file containing only the block when the destination was empty", () => {
    expect(composeManagedBlock("", "body", start, end)).toBe(`${start}\nbody\n${end}\n`);
  });
});

describe("hasExactlyOneBlock", () => {
  it("accepts exactly one well-formed block", () => {
    expect(hasExactlyOneBlock(renderManagedBlock("body", start, end), "body", start, end)).toBe(true);
  });

  it("rejects the same correct block appearing twice", () => {
    const one = renderManagedBlock("body", start, end);
    expect(hasExactlyOneBlock(`${one}\n${one}`, "body", start, end)).toBe(false);
  });

  it("rejects a drifted body", () => {
    expect(hasExactlyOneBlock(renderManagedBlock("old", start, end), "new", start, end)).toBe(false);
  });
});
