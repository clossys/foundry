import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")) as {
  dependencies?: Record<string, string>;
  peerDependencies: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
  foundry?: { singularAuthority?: string };
};

/**
 * Guards a real reported defect, not a hypothetical: `typescript` — needed
 * only by the source-aware secret-surface checks (specifically
 * `packages/controller/src/gates/secret-gates.ts`, the sole importer) — was
 * declared as an unconditional `dependencies` entry. `npm install
 * @vespeneventures/governance` (this package's former name) pulled in a
 * whole compiler for every consumer, including the five compatibility shims
 * that depend on it, regardless of whether they ever import anything past
 * the root lifecycle and scaffold planning entry point. The root entry,
 * `./catalog`, `./gates`, `./release`, `./repository`, `./review`, and
 * `./review/github` never touch TypeScript at all — only `./gates/secrets`
 * does, and only for that one file it carries.
 *
 * `dependencies` must be empty. The one runtime dependency this package
 * used to declare, `@vespeneventures/policy`, is no longer an external
 * package at all — its source now lives inside this package as the
 * `./policy` subpath (see issue #282), so there is nothing left to declare.
 *
 * HISTORY (#411, then this PR — CI failure on #419, closing the
 * consequence of #411, not reopening it): `typescript` was briefly
 * declared a REQUIRED peer, dropping the `peerDependenciesMeta: {
 * optional: true }` flag this test now asserts again. #411 was real: this
 * file's `secret-gates.ts` imports `typescript` unconditionally, at module
 * scope, and the `optional` flag was a live lie for a consumer who
 * believed it — but at the time, `secret-gates.ts` was reachable through
 * the SHARED `./gates` barrel, so "honest declaration" and "every other
 * `./gates` consumer forced to install a compiler" were the same choice.
 * `installed-bin.test.ts` is what showed that choice was itself a defect:
 * with `typescript` required, an offline install of the published tarball
 * failed outright, because npm had to resolve the peer and a clean install
 * has no cache. This PR fixes the actual problem instead of trading it for
 * a different one: `secret-gates.ts` moved off the shared barrel onto its
 * own subpath, `./gates/secrets` (see `gates/secrets.ts` and
 * `secret-gates.ts`'s own header), so `typescript` can go back to being
 * genuinely optional — a consumer of `./gates` (or anything else) never
 * reaches it, and a consumer who deliberately imports `./gates/secrets`
 * still gets the same unconditional import, same `ERR_MODULE_NOT_FOUND` if
 * they skip installing the peer, matching `@vespeneventures/auth`'s own
 * shape for its genuinely optional peers such as `svix`.
 */
describe("public contract — dependency boundary", () => {
  it("declares Controller as a singular authority for caller-supplied consumer graph checks", () => {
    expect(packageJson.foundry?.singularAuthority).toBe("controller");
  });

  it("declares zero unconditional runtime dependencies", () => {
    expect(packageJson.dependencies ?? {}).toEqual({});
  });

  it("declares typescript as an optional peer, not a hard dependency (#419, restoring the flag #411 removed — see this file's own header for why both changes were each correct for their own moment)", () => {
    expect(packageJson.peerDependencies.typescript).toBeDefined();
    expect(packageJson.peerDependenciesMeta?.typescript?.optional).toBe(true);
  });

  it("declares every peer as optional — installing this package alone must never fail on a missing peer", () => {
    for (const [name, meta] of Object.entries(packageJson.peerDependenciesMeta ?? {})) {
      expect(meta.optional, `${name} should be optional`).toBe(true);
    }
    // Every declared peer has a matching meta entry — an un-declared-optional
    // peer would silently default to required, defeating the point of the
    // loop above checking only the ones that happen to have meta.
    for (const name of Object.keys(packageJson.peerDependencies)) {
      expect(packageJson.peerDependenciesMeta?.[name], `${name} has no peerDependenciesMeta entry`).toBeDefined();
    }
  });
});
