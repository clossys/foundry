import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")) as {
  dependencies?: Record<string, string>;
  peerDependencies: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
};

/**
 * Guards a real reported defect, not a hypothetical: `typescript` — needed
 * only by `./gates`'s source-aware secret-surface checks (specifically
 * `packages/controller/src/gates/secret-gates.ts`, the sole importer) — was
 * declared as an unconditional `dependencies` entry. `npm install
 * @vespeneventures/governance` (this package's former name) pulled in a
 * whole compiler for every consumer, including the five compatibility shims
 * that depend on it, regardless of whether they ever import anything past
 * the root lifecycle and scaffold planning entry point. The root entry,
 * `./catalog`, `./release`, `./repository`, `./review`, and
 * `./review/github` never touch TypeScript at all — only `./gates` does,
 * and only for that one file.
 *
 * `dependencies` must be empty. The one runtime dependency this package
 * used to declare, `@vespeneventures/policy`, is no longer an external
 * package at all — its source now lives inside this package as the
 * `./policy` subpath (see issue #282), so there is nothing left to declare.
 *
 * UPDATE (#411): `typescript` used to ALSO carry `peerDependenciesMeta:
 * { optional: true }`, matching `@vespeneventures/auth`'s svix peer and
 * this file's own former "every peer is optional" test below. That flag
 * was a live lie, not a harmless default: `./gates`'s `secret-gates.ts`
 * imports `typescript` unconditionally, at module scope, with nothing to
 * catch a resolution failure — a consumer who believed "optional" and
 * skipped installing it got `ERR_MODULE_NOT_FOUND` the instant anything
 * reached `./gates`, not a degraded gate. `peerDependencies` is declared
 * at the PACKAGE level, not per subpath, so there is no way to keep
 * `typescript` optional for the root (which never touches it — the test
 * right below still proves that) while making it required for `./gates`
 * (which always does, unconditionally, by design — see `governance.ts`'s
 * and `secret-gates.ts`'s own header comments for why that split exists at
 * all). Given that constraint, this package now declares `typescript` a
 * required peer: honest about what `./gates` has always actually
 * demanded, and — because npm 7+ auto-installs or warns on an unmet peer
 * rather than hard-failing the install outright — a consumer who never
 * touches `./gates` still installs and uses the root entry point without
 * incident. This deliberately makes controller's dependency-boundary
 * contract narrower than `@vespeneventures/auth`'s: auth's `svix` genuinely
 * has no such unconditional-import hazard (verified separately), so its
 * "every peer optional" invariant still holds there.
 */
describe("public contract — dependency boundary", () => {
  it("declares zero unconditional runtime dependencies", () => {
    expect(packageJson.dependencies ?? {}).toEqual({});
  });

  it("declares typescript as a REQUIRED peer, not optional (#411) — ./gates imports it unconditionally, at module scope, with nothing to catch a resolution failure", () => {
    expect(packageJson.peerDependencies.typescript).toBeDefined();
    expect(packageJson.peerDependenciesMeta?.typescript).toBeUndefined();
  });
});
