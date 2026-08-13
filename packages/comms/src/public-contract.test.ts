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
 * Guards a real reported defect, not a hypothetical: `resend` — needed only
 * by the `./resend` provider subpath — was declared as an unconditional
 * `dependencies` entry. `npm install @vespeneventures/comms` pulled in the
 * Resend SDK for every consumer regardless of whether they ever import
 * anything past the provider-neutral root contracts.
 *
 * `dependencies` must be entirely absent, matching `@vespeneventures/auth`'s
 * own public-contract test for the same shape of guarantee: this package has
 * zero hard runtime dependencies of its own, only an optional peer a
 * consumer opts into by using the `./resend` subpath.
 */
describe("public contract — dependency boundary", () => {
  it("has no unconditional runtime dependency — resend is an optional peer", () => {
    expect(packageJson.dependencies).toBeUndefined();
  });

  it("declares resend as an optional peer, not a hard dependency", () => {
    expect(packageJson.peerDependencies.resend).toBeDefined();
    expect(packageJson.peerDependenciesMeta.resend?.optional).toBe(true);
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
