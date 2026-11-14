import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cleanSpec, contextOf, expectCatches, sha } from "../__fixtures__/workspace.js";
import type { ConstitutionContext } from "../types.js";
import { COMPILE_LOCK, compilePureRows, lockRows, pinSet, pinSetHash, R12 } from "./r12.js";

/** A fixture context whose root also holds a Producer package and a compile lock. */
function withLock(ctx: ConstitutionContext, lock: unknown): ConstitutionContext {
  mkdirSync(join(ctx.root, "packages/producer/studio"), { recursive: true });
  writeFileSync(join(ctx.root, "packages/producer/package.json"), "{}\n");
  if (lock !== undefined) writeFileSync(join(ctx.root, COMPILE_LOCK), `${JSON.stringify(lock)}\n`);
  return ctx;
}

describe("pin-set hash", () => {
  it("is the sha256 of sorted `<slot> <sha256>` lines over live pinned slots", () => {
    const ctx = contextOf(cleanSpec());
    const set = pinSet(ctx);
    // Every live pinned slot of all five agents (the Producer seat `seat.director` included), sorted.
    expect(set.map(entry => entry.slot)).toEqual(["brand.voice", "home.hero", "seat.director", "site.home", "ui.button", "ui.card"]);
    const lines = set.map(entry => `${entry.slot} ${entry.sha256}\n`).join("");
    expect(pinSetHash(set)).toBe(createHash("sha256").update(lines).digest("hex"));
    expect(pinSetHash([])).toBe(sha(""));
    expect(pinSetHash([...set].reverse())).not.toBe(pinSetHash(set));
  });

  it("changes when a pin changes, and leaves out unplaced and unpinned slots", () => {
    const base = pinSetHash(pinSet(contextOf(cleanSpec())));
    const repinned = cleanSpec();
    repinned.writer!["home.hero"]!.candidates = { "hero-v1.md": "---\nsource:\n  kind: authored\n---\nHello.\n" };
    expect(pinSetHash(pinSet(contextOf(repinned)))).not.toBe(base);
    const unplaced = cleanSpec();
    unplaced.designer!["ui.extra"] = { live: false, candidates: { "extra-v1.json": { name: "extra" } } };
    unplaced.designer!["ui.unpinned"] = { pin: false, candidates: { "unpinned-v1.json": { name: "unpinned" } } };
    expect(pinSetHash(pinSet(contextOf(unplaced)))).toBe(base);
  });
});

describe("R12.1 the lock records the current pin set", () => {
  it("reports a missing lock, a lock without a hash and a stale hash; passes a current one", () => {
    expect(lockRows({ present: false }, "a")[0]!.reason).toMatch(/missing/);
    expect(lockRows({ present: true, error: "bad json" }, "a")[0]!.reason).toMatch(/unreadable/);
    expect(lockRows({ present: true, doc: { schema: "clossys.compile-lock/1" } }, "a")[0]!.reason).toMatch(/records no pinSetHash/);
    expect(lockRows({ present: true, doc: { pinSetHash: "b".repeat(64) } }, "a".repeat(64))[0]!.reason).toMatch(/built from pin set bbbbbbbbbbbb, the current pin set is aaaaaaaaaaaa/);
    expect(lockRows({ present: true, doc: { pinSetHash: "a" } }, "a")).toEqual([]);
  });

  it("failing-first: a re-pin after the compile makes the lock stale", () => {
    const clean = contextOf(cleanSpec());
    withLock(clean, { schema: "clossys.compile-lock/1", pinSetHash: pinSetHash(pinSet(clean)) });
    const spec = cleanSpec();
    spec.writer!["home.hero"]!.candidates = { "hero-v1.md": "---\nsource:\n  kind: authored\n---\nHello.\n" };
    const broken = withLock(contextOf(spec), { schema: "clossys.compile-lock/1", pinSetHash: pinSetHash(pinSet(clean)) });
    expect(expectCatches(R12.checks["R12.1"]!, clean, broken)).toEqual([expect.objectContaining({ rule: "R12", check: "R12.1", path: COMPILE_LOCK })]);
    expect(R12.checks["R12.1"]!(withLock(contextOf(cleanSpec()), undefined))).toHaveLength(1);
  });

  it("a code-free root (the fixture) gives no R12.1 or R12.2 row", () => {
    const ctx = contextOf(cleanSpec());
    expect([...R12.checks["R12.1"]!(ctx), ...R12.checks["R12.2"]!(ctx)]).toEqual([]);
  });
});

describe("R12.2 the compile is pure", () => {
  it("maps check-compile-pure findings to rows; a crash is one no-verdict row", () => {
    expect(compilePureRows({ status: 0, stdout: "check-compile-pure: clean\n", stderr: "" })).toEqual([]);
    const rows = compilePureRows({ status: 1, stdout: "", stderr: "check-compile-pure: 2 findings\n  purity: dist/x.js imports openai\n  determinism: two compiles differ in a.json\n" });
    expect(rows.map(row => row.reason)).toEqual(["compile is not pure (purity): dist/x.js imports openai", "compile is not pure (determinism): two compiles differ in a.json"]);
    expect(compilePureRows({ status: 2, stdout: "", stderr: "check-compile-pure: --root needs a directory\n" })).toEqual([expect.objectContaining({ check: "R12.2", reason: expect.stringMatching(/gave no verdict \(exit 2\)/) })]);
  });

  it("an unbuilt Producer CLI is a row, not a pass", () => {
    const rows = R12.checks["R12.2"]!(withLock(contextOf(cleanSpec()), undefined));
    expect(rows).toEqual([expect.objectContaining({ check: "R12.2", reason: expect.stringMatching(/not built/) })]);
  });
});
