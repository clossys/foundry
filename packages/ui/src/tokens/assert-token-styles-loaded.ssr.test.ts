// @vitest-environment node
//
// A dedicated node-environment file — not a jsdom test that merely deletes
// `document` — so this genuinely exercises "no DOM at all", the real SSR
// shape (a server render, or an edge runtime with no `document` global),
// rather than approximating it inside a browser-like environment.
import { describe, expect, it } from "vitest";
import { assertTokenStylesLoaded } from "./assert-token-styles-loaded.js";

describe("assertTokenStylesLoaded — SSR", () => {
  it("is a no-op with no document/window global, and never touches document", () => {
    expect(typeof document).toBe("undefined");
    expect(typeof window).toBe("undefined");

    expect(() => assertTokenStylesLoaded()).not.toThrow();

    const onMissing = () => {
      throw new Error("onMissing must never run during SSR — there is nothing to check");
    };
    expect(() => assertTokenStylesLoaded({ onMissing })).not.toThrow();
  });
});
