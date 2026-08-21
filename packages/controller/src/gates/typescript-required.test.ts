import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * #411. This file's own job is narrow, deliberately: prove that the
 * absent-peer path is REAL and OBSERVABLE, not just declared correctly on
 * paper. `secret-gates.test.ts`'s "TYPESCRIPT_DECLARED_RANGE" test already
 * asserts package.json no longer marks `typescript` optional — that is the
 * DECLARATION. This file exercises the actual import behavior the
 * declaration is supposed to describe: what really happens when
 * `typescript` cannot be resolved.
 *
 * `vi.mock` replaces module resolution for the bare specifier "typescript"
 * across this file's own module graph with a factory that throws — the
 * same shape of failure a real consumer hits when the package genuinely
 * isn't installed (Node's own resolver would raise `ERR_MODULE_NOT_FOUND`;
 * vitest's mock loader wraps a thrown factory error instead, but the
 * observable property under test — importing `./secret-gates.js` or the
 * `./gates` barrel REJECTS rather than silently resolving with a phantom
 * `ts` — is the same one a real absent peer produces). `vi.mock` calls are
 * hoisted above this file's own imports by vitest's transform, so nothing
 * in this file can import the real `secret-gates.js` at the top level —
 * every exercise of it below goes through a dynamic `import()` inside a
 * test body instead, each getting a fresh, isolated module registry via
 * `vi.resetModules()`.
 *
 * This is deliberately its OWN file, never merged into secret-gates.test.ts
 * or root-entry-boundary.test.ts: those two files need the REAL
 * `typescript` (one to exercise actual AST behavior, the other to prove the
 * real installed compiler doesn't break module load), and mixing a global
 * `typescript` mock into either would either mock away real coverage or
 * silently stop testing what it claims to.
 */

vi.mock("typescript", () => {
  throw new Error(
    "Cannot find package 'typescript' imported from @vespeneventures/controller/gates (simulated absent peer, #411)",
  );
});

describe("the ./gates subpath genuinely requires typescript (#411)", () => {
  beforeEachResetModules();

  it("importing secret-gates.ts directly rejects — not a silent success with a phantom compiler", async () => {
    await expect(import("./secret-gates.js")).rejects.toThrow();
  });

  it("the rejection names typescript as the cause, not an unrelated crash deep inside AST code", async () => {
    try {
      await import("./secret-gates.js");
      throw new Error("expected the import above to reject");
    } catch (err) {
      const cause = (err as { cause?: unknown } | undefined)?.cause;
      const causeMessage = cause instanceof Error ? cause.message : String(cause);
      expect(causeMessage).toMatch(/typescript/i);
    }
  });

  it("importing the public ./gates barrel (gates/index.ts) rejects the same way — the real subpath a consumer reaches, not just this one internal file", async () => {
    await expect(import("./index.js")).rejects.toThrow();
  });
});

function beforeEachResetModules(): void {
  // Declared as a named helper rather than inlined `beforeEach` at the
  // describe callsite so the intent reads before the test bodies: every
  // test in this file needs its own fresh module registry, because
  // dynamically importing a module that already threw once is cached as a
  // rejected promise by Node's ESM loader — without this, only the FIRST
  // test in the block would ever actually exercise the throw, and every
  // later one would just observe the cached rejection from before,
  // vacuously passing even if the guard under test were removed entirely.
  beforeEach(() => {
    vi.resetModules();
  });
}
