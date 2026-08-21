import { afterEach, describe, expect, it, vi } from "vitest";
import { assertTailwindMergeVersion } from "./assert-tailwind-merge-version.js";

describe("assertTailwindMergeVersion", () => {
  afterEach(() => {
    vi.doUnmock("../internal/resolve-installed-peer-version.js");
    vi.resetModules();
  });

  it("stays silent when the real, installed tailwind-merge satisfies the declared range (prerequisite present, in range)", () => {
    // No mocking: this repository's own devDependency-installed
    // tailwind-merge is real, on disk, and within package.json's declared
    // "^3.0.0" range.
    expect(() => assertTailwindMergeVersion()).not.toThrow();
  });

  it("throws naming tailwind-merge when it cannot be resolved at all (absent)", async () => {
    vi.doMock("../internal/resolve-installed-peer-version.js", () => ({
      resolveInstalledPeerVersion: () => undefined,
    }));
    const { assertTailwindMergeVersion: assertWithMock } = await import("./assert-tailwind-merge-version.js");
    expect(() => assertWithMock()).toThrow(/tailwind-merge is required for this import but is not installed/);
  });

  it("throws a distinctly-worded error when tailwind-merge is installed but out of range", async () => {
    vi.doMock("../internal/resolve-installed-peer-version.js", () => ({
      resolveInstalledPeerVersion: () => "1.0.0",
    }));
    const { assertTailwindMergeVersion: assertWithMock } = await import("./assert-tailwind-merge-version.js");
    expect(() => assertWithMock()).toThrow(/tailwind-merge@1\.0\.0 is installed, but this package requires tailwind-merge@"\^3\.0\.0"/);
  });

  // Updated for #389: assertPeerVersion no longer throws when it merely
  // cannot PARSE an installed version (e.g. a prerelease identifier) —
  // that is now indeterminate, reported via a single console.warn, and
  // the caller proceeds. See ../internal/peer-version.ts's header.
  it("warns and proceeds, rather than throwing, when the installed version cannot be parsed (unresolvable)", async () => {
    vi.doMock("../internal/resolve-installed-peer-version.js", () => ({
      resolveInstalledPeerVersion: () => "3.0.0-canary.1",
    }));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const { assertTailwindMergeVersion: assertWithMock } = await import("./assert-tailwind-merge-version.js");
      expect(() => assertWithMock()).not.toThrow();
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0]?.[0]).toMatch(/prerelease identifier/);
    } finally {
      warn.mockRestore();
    }
  });

  it("throws a distinct, Node-only-context error rather than a false 'not installed' when called from a browser-like global scope", () => {
    const originalProcess = globalThis.process;
    // Simulate a bundled-for-browser runtime: `document` exists (real in
    // this vitest+jsdom environment already), `process.versions.node`
    // does not. Cast through `unknown` rather than suppressing a type
    // error — this is a deliberate, fully-typed substitution of the
    // global, not a type-level assertion this repository's `.check.ts(x)`
    // convention would apply to.
    globalThis.process = { ...originalProcess, versions: {} } as unknown as NodeJS.Process;
    try {
      expect(() => assertTailwindMergeVersion()).toThrow(/is Node-only/);
    } finally {
      globalThis.process = originalProcess;
    }
  });
});
