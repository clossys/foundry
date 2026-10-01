import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./scan.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./scan.js")>();
  return {
    ...actual,
    scanSiteConformance: () => {
      throw new TypeError("unexpected internal failure with source text const a = '#a1b2c3'");
    },
  };
});

const { main } = await import("./cli.js");

afterEach(() => vi.restoreAllMocks());

describe("an unexpected failure is still 'could not run'", () => {
  it("exits 2 without throwing and without echoing the internal message", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(main(["/some/root"])).toBe(2);
    const text = error.mock.calls.join("\n");
    expect(text).toContain("site-conformance-check:");
    expect(text).not.toContain("a1b2c3");
  });
});
