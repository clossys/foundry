import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Regression test for #749. `cx.ts` used to `import { extendTailwindMerge
 * } from "tailwind-merge"` STATICALLY, at the top of the module. A static
 * import is resolved before any of the module's own code runs and throws
 * immediately if the package cannot be found — and `cx` is transitively
 * reachable from every atom, including through the server-safe barrels
 * (`atoms/server.ts`, `blocks/server.ts`). A consumer who correctly did
 * NOT install `tailwind-merge` — it is declared `optional: true` in this
 * package's own `peerDependenciesMeta` — got
 * `Cannot find package 'tailwind-merge' imported from
 * .../designer/dist/atoms/internal/cx.js` the moment any server-safe
 * import touched `cx`, even though nothing they imported was documented
 * as needing it. See `cx.ts`'s own header for the fix.
 *
 * `vi.mock` below makes THIS test file's own resolution of
 * `"tailwind-merge"` throw, the same shape of failure Node's real
 * resolver produces for a package that genuinely is not installed —
 * simulating the exact consumer-side condition #749 was filed against,
 * without needing an actually-uninstalled peer in this repository's own
 * node_modules (every OTHER test in this package legitimately depends on
 * `tailwind-merge` being present). `vi.mock` factories are hoisted above
 * this file's own imports, so it is in effect before `cx.ts`'s top-level
 * `await import("tailwind-merge")` ever runs, below. The mock registration
 * itself survives `vi.resetModules()` (used below); only the module
 * instance cache is cleared, so each reset gives `cx.ts` a genuinely
 * fresh `warnedAbsent` too.
 */
vi.mock("tailwind-merge", () => {
  throw new Error("Cannot find package 'tailwind-merge' imported from <mocked, simulating an absent optional peer>");
});

afterEach(() => {
  vi.resetModules();
});

describe("cx when tailwind-merge (an optional peer) is not installed (#749)", () => {
  it("does not throw merely importing cx — the module (and therefore every atom, and the server-safe barrels) loads cleanly", async () => {
    await expect(import("./cx.js")).resolves.toBeDefined();
  });

  it("still joins fragments and drops falsy ones, degrading to a plain join with none of tailwind-merge's conflict resolution", async () => {
    const { cx } = await import("./cx.js");
    expect(cx("a", false, undefined, null, "b")).toBe("a b");
    // Without tailwind-merge there is no conflict resolution at all: BOTH
    // fragments survive, in argument order — unlike the "last one wins"
    // behavior `cx.test.ts` pins for the tailwind-merge-PRESENT case
    // (compare its "resolves a conflicting standard Tailwind utility"
    // test, which asserts `cx("p-4", "p-8")` collapses to `"p-8"`).
    expect(cx("p-4", "p-8")).toBe("p-4 p-8");
  });

  it("does not warn merely from importing — only a real call degrades, and only a real call should say so", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      await import("./cx.js");
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it("warns once, naming tailwind-merge, on the first call that actually degrades", async () => {
    // This repository's stated principle is that an indeterminate outcome
    // must never read as clean: a plain join is not an error, but it IS
    // wrong-relative-to-intent output (two conflicting classes both
    // survive instead of the later one winning), so cx() must not be
    // silent about producing it.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const { cx } = await import("./cx.js");
      cx("p-4", "p-8");
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0]?.[0]).toMatch(/tailwind-merge/);
      expect(warn.mock.calls[0]?.[0]).toMatch(/once per process/);
    } finally {
      warn.mockRestore();
    }
  });

  it("does not warn again on later calls in the same module instance (once per process, not once per call)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const { cx } = await import("./cx.js");
      cx("a", "b");
      warn.mockClear(); // discard the first-call warning; only later calls matter here
      cx("c", "d");
      cx("e", "f");
      cx("p-4", "p-8");
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});
