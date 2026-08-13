import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")) as {
  exports: Record<string, unknown>;
  dependencies?: Record<string, string>;
  peerDependencies: Record<string, string>;
  peerDependenciesMeta: Record<string, { optional?: boolean }>;
};

const SUBPATHS = [".", "./resend", "./inbound"] as const;

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

/**
 * `./inbound` is wired exactly like `./resend`: a real subpath with its own
 * `types`/`import` conditions in `exports`, not a folder a consumer has to
 * reach into by relative path. Unlike `./resend`, it declares no peer of
 * its own — the admission decision is pure and dependency-free, and the
 * host implements `InboundEventLedger` itself.
 */
describe("public contract — subpaths", () => {
  it("exposes exactly the root, ./resend and ./inbound, each with types+import conditions", () => {
    expect(Object.keys(packageJson.exports)).toEqual([...SUBPATHS]);
    for (const subpath of SUBPATHS) {
      const entry = packageJson.exports[subpath] as { types?: string; import?: string };
      expect(entry.types, `${subpath} needs public types`).toMatch(/^\.\/dist\/.+\.d\.ts$/);
      expect(entry.import, `${subpath} needs an ESM entry`).toMatch(/^\.\/dist\/.+\.js$/);
    }
  });
});
