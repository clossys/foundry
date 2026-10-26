// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { initialStudioLayer, studioLayerFromSearch } from "./layer-navigation.js";

describe("studio layer deep link (?layer=)", () => {
  afterEach(() => { window.history.replaceState(null, "", "/"); });
  it("parses only known layers from a query string", () => {
    expect(studioLayerFromSearch("?layer=frames")).toBe("frames");
    expect(studioLayerFromSearch("?a=1&layer=sections")).toBe("sections");
    expect(studioLayerFromSearch("?layer=bogus")).toBeUndefined();
    expect(studioLayerFromSearch("")).toBeUndefined();
  });
  it("seeds the first-paint layer from ?layer= synchronously", () => {
    window.history.replaceState(null, "", "/?layer=frames");
    expect(initialStudioLayer()).toBe("frames");
    window.history.replaceState(null, "", "/?layer=sections");
    expect(initialStudioLayer()).toBe("sections");
  });
  it("keeps the #studio-layer fragment ahead of the query", () => {
    window.history.replaceState(null, "", "/?layer=sections#studio-layer=assets");
    expect(initialStudioLayer()).toBe("assets");
  });
});
