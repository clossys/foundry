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
 * Guards a real reported defect, not a hypothetical: `svix` — needed only by
 * `./providers/clerk`'s webhook verification — was declared as an
 * unconditional `dependencies` entry. `npm install @vespeneventures/bouncer`
 * pulled it in for every consumer regardless of whether they ever import
 * anything past the pure root primitives, which the README already claimed
 * (incorrectly, until this fix) had "no framework or provider runtime
 * dependency". Verified empirically at the time of the fix, from a location
 * with no ambient `node_modules` above it to falsely satisfy resolution:
 * the compiled root entry loads successfully with zero `svix` package
 * present anywhere on disk, and `./providers/clerk` correctly FAILS to load
 * under the same condition — proving `svix` is genuinely still required
 * there, not accidentally removed.
 *
 * `dependencies` must be entirely absent, matching `@vespeneventures/ui`'s
 * own public-contract test for the same shape of guarantee: this package
 * has ZERO hard runtime dependencies of its own, only optional peers a
 * consumer opts into by using the subpath that needs them.
 */
describe("public contract — dependency boundary", () => {
  it("has no unconditional runtime dependency — svix (and everything else) is an optional peer", () => {
    expect(packageJson.dependencies).toBeUndefined();
  });

  it("declares svix as an optional peer, not a hard dependency", () => {
    expect(packageJson.peerDependencies.svix).toBeDefined();
    expect(packageJson.peerDependenciesMeta.svix?.optional).toBe(true);
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
