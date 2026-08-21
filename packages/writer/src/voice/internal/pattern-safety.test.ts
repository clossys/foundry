import { describe, expect, it } from "vitest";
import { checkPatternSafety, countPatternMatches, MAX_PATTERN_SOURCE_LENGTH, MAX_QUANTIFIER_BOUND } from "./pattern-safety.js";

describe("checkPatternSafety — accepts safe, useful patterns", () => {
  it("accepts a hard character ban (the em-dash example from the issue this feature closes)", () => {
    const result = checkPatternSafety({ source: "\\u2014" });
    expect(result.ok).toBe(true);
  });

  it("accepts alternation", () => {
    const result = checkPatternSafety({ source: "\\b(deep dive|dive deep)\\b" });
    expect(result.ok).toBe(true);
  });

  it("accepts an optional apostrophe", () => {
    const result = checkPatternSafety({ source: "\\bit'?s worth considering\\b" });
    expect(result.ok).toBe(true);
  });

  it("accepts the allowed flags i, u, s", () => {
    for (const flags of ["i", "u", "s", "iu", "ius"]) {
      expect(checkPatternSafety({ source: "abc", flags }).ok).toBe(true);
    }
  });

  it("accepts a bounded quantifier at or under the max", () => {
    expect(checkPatternSafety({ source: `a{${MAX_QUANTIFIER_BOUND}}` }).ok).toBe(true);
    expect(checkPatternSafety({ source: "a{2,5}" }).ok).toBe(true);
  });

  it("accepts a group with an inner unbounded quantifier wrapped as optional (0-1), not nested", () => {
    expect(checkPatternSafety({ source: "(a+)?" }).ok).toBe(true);
  });

  it("returns a real, usable RegExp on success", () => {
    const result = checkPatternSafety({ source: "\\bfoo\\b", flags: "i" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.regex).toBeInstanceOf(RegExp);
      expect(result.regex.test("a Foo b")).toBe(true);
    }
  });
});

describe("checkPatternSafety — rejects unsafe/invalid patterns, never silently", () => {
  it("rejects a missing/empty source", () => {
    expect(checkPatternSafety({}).ok).toBe(false);
    expect(checkPatternSafety({ source: "" }).ok).toBe(false);
    const result = checkPatternSafety({ source: 42 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issue).toBe("pattern-source-shape");
  });

  it("rejects a source longer than MAX_PATTERN_SOURCE_LENGTH", () => {
    const result = checkPatternSafety({ source: "a".repeat(MAX_PATTERN_SOURCE_LENGTH + 1) });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issue).toBe("pattern-too-long");
  });

  it("rejects a disallowed flag (g, y, m)", () => {
    for (const flags of ["g", "y", "m", "gi"]) {
      const result = checkPatternSafety({ source: "abc", flags });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.issue).toBe("pattern-flags-shape");
    }
  });

  it("rejects a non-string flags value", () => {
    const result = checkPatternSafety({ source: "abc", flags: 5 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issue).toBe("pattern-flags-shape");
  });

  it("rejects backreferences \\1 and \\k<name>", () => {
    for (const source of ["(a)\\1", "(?<x>a)\\k<x>"]) {
      const result = checkPatternSafety({ source });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.issue).toBe("pattern-backreference");
    }
  });

  it("rejects a bounded quantifier whose upper bound exceeds MAX_QUANTIFIER_BOUND", () => {
    const result = checkPatternSafety({ source: `a{${MAX_QUANTIFIER_BOUND + 1}}` });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issue).toBe("pattern-quantifier-bound-too-large");
  });

  it("rejects the classic nested-quantifier catastrophic-backtracking shapes", () => {
    for (const source of ["(a+)+", "(a*)*", "(a+)*", "(a*)+", "(.*)+", "(a+){2,3}"]) {
      const result = checkPatternSafety({ source });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.issue).toBe("pattern-nested-quantifier");
    }
  });

  it("rejects an unbalanced/invalid regex as pattern-does-not-compile", () => {
    for (const source of ["(unclosed", "closed)", "a**"]) {
      const result = checkPatternSafety({ source });
      expect(result.ok).toBe(false);
    }
  });

  it("does not treat a character class's own quantifier-shaped characters as structural", () => {
    // "[a+]" is a character class containing a literal "+" — not a
    // quantifier at all — and must not be misclassified as one.
    expect(checkPatternSafety({ source: "[a+*(){}]" }).ok).toBe(true);
  });

  it("never throws, for any input shape", () => {
    for (const input of [null, undefined, 5, "not an object", [], { source: null }, { source: {} }]) {
      expect(() => checkPatternSafety(input as never)).not.toThrow();
    }
  });
});

describe("countPatternMatches", () => {
  it("counts non-overlapping matches, adding 'g' internally without requiring the caller to", () => {
    const result = checkPatternSafety({ source: "\\u2014" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(countPatternMatches("a—b—c", result.regex)).toBe(2);
      expect(countPatternMatches("no dashes here", result.regex)).toBe(0);
    }
  });

  it("respects case-insensitivity when the 'i' flag was validated", () => {
    const result = checkPatternSafety({ source: "deep dive", flags: "i" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(countPatternMatches("a Deep Dive into the data", result.regex)).toBe(1);
    }
  });
});
