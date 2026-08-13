import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")) as {
  dependencies?: Record<string, string>;
  peerDependencies: Record<string, string>;
  peerDependenciesMeta: Record<string, { optional?: boolean }>;
};

/**
 * Guards a real reported defect, not a hypothetical: `typescript` — needed
 * only by `./gates`'s source-aware secret-surface checks (specifically
 * `packages/governance/src/gates/secret-gates.ts`, the sole importer) — was
 * declared as an unconditional `dependencies` entry. `npm install
 * @vespeneventures/governance` pulled in a whole compiler for every
 * consumer, including the five compatibility shims that depend on this
 * package, regardless of whether they ever import anything past the root
 * lifecycle and scaffold planning entry point. The root entry, `./catalog`,
 * `./release`, `./repository`, `./review`, and `./review/github` never touch
 * TypeScript at all — only `./gates` does, and only for that one file.
 *
 * `dependencies` must contain only `@vespeneventures/policy`, matching
 * `@vespeneventures/auth`'s own public-contract test for the same shape of
 * guarantee: every other runtime input this package needs is an optional
 * peer a consumer opts into by using the subpath that needs it.
 */
describe("public contract — dependency boundary", () => {
  it("declares exactly one unconditional runtime dependency: @vespeneventures/policy", () => {
    expect(packageJson.dependencies).toEqual({ "@vespeneventures/policy": "^0.1.0" });
  });

  it("declares typescript as an optional peer, not a hard dependency", () => {
    expect(packageJson.peerDependencies.typescript).toBeDefined();
    expect(packageJson.peerDependenciesMeta.typescript?.optional).toBe(true);
  });

  it("declares every peer as optional — installing this package alone must never fail on a missing peer", () => {
    for (const [name, meta] of Object.entries(packageJson.peerDependenciesMeta)) {
      expect(meta.optional, `${name} should be optional`).toBe(true);
    }
    // Every declared peer has a matching meta entry — an un-declared-optional
    // peer would silently default to required, defeating the point of the
    // loop above checking only the ones that happen to have meta.
    for (const name of Object.keys(packageJson.peerDependencies)) {
      expect(packageJson.peerDependenciesMeta[name], `${name} has no peerDependenciesMeta entry`).toBeDefined();
    }
  });
});
