// This package handles secret NAMES, OWNERS, AGES, STORES, ROTATION
// POLICIES, REVOCATION RECORDS, and DIGESTS — never a secret VALUE. This
// test is the two-part proof that every verb module (custody, rotation,
// revocation, distribution, credential, controlled-key-rate, and any
// future addition) cannot leak one:
//
//   1. STATIC — none of the verb modules (see NEW_VERB_MODULES below for
//      how that set is derived) imports anything capable of reading a
//      real secret (the resolution client/adapters, the Infisical
//      subpath, `process.env`) or performing I/O (`fetch`, `readFileSync`,
//      `console.*`). A module that never imports a way to read a value
//      cannot leak one, no matter what its functions do with their
//      inputs.
//
//   2. RUNTIME — every record these modules produce has a closed, exact set
//      of fields. A decoy value-shaped string is passed through every free-
//      text field (`notes`, `reason`, a rotation `digest`) precisely because
//      those fields legitimately accept caller-supplied opaque text; the
//      assertion is that nothing ELSE appears alongside them — no field
//      this package didn't declare, and in particular no field on the
//      rotation *evaluation* carrying the *input* digest through, which
//      would be a real (if quiet) escape path for caller-supplied opaque
//      data into a structure this package hands back out.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { custodyOf, defineKeyCustody } from "./custody.js";
import { defineDistributionManifest } from "./distribution.js";
import { evaluateCredential } from "./credential.js";
import { recordRevocation } from "./revocation.js";
import { evaluateRotation } from "./rotation.js";
import { evaluateProviderCustody } from "./provider-custody.js";

const here = dirname(fileURLToPath(import.meta.url));

// DERIVED from index.ts's own export statements, not hand-listed (#907): a
// hand-written array here silently stops covering "every verb module" the
// moment a new one is added — which is exactly what happened before this
// fix, when controlled-key-rate.ts shipped as a sixth verb module and was
// never added to the list, so this test never actually checked it.
//
// index.ts's barrel re-exports both the small resolution/infra layer
// (client.ts resolves a value; adapters.ts wraps env/test resolution;
// catalog.ts wires them together; errors.ts and types.ts are pure
// declarations) and every verb module (custody, rotation, revocation,
// distribution, credential, controlled-key-rate, ...). The infra layer
// legitimately needs the I/O this test forbids, so it's excluded by name;
// everything else index.ts exports is a verb module and is checked here
// automatically, without anyone updating a list.
const INFRA_MODULES = new Set(["client", "adapters", "catalog", "errors", "types"]);

const indexSource = readFileSync(join(here, "index.ts"), "utf8");
const NEW_VERB_MODULES = Array.from(new Set(Array.from(indexSource.matchAll(/from\s+"\.\/([a-zA-Z0-9-]+)\.js"/g), (match) => match[1])))
  .filter((name) => !INFRA_MODULES.has(name))
  .map((name) => `${name}.ts`);

// Anything that could put a real secret value in reach: reading the
// environment, importing the resolution client/adapters or the Infisical
// subpath, making a network call, reading a file, or printing. None of the
// verb modules need any of these — custody, rotation, revocation,
// distribution, credential, controlled-key-rate, and any future addition
// are metadata operations end to end.
const FORBIDDEN_PATTERNS: readonly RegExp[] = [
  /process\.env/,
  /from\s+["']\.\/client\.js["']/,
  /from\s+["']\.\/adapters\.js["']/,
  /from\s+["'][^"']*infisical[^"']*["']/i,
  /\bimport\s*\(\s*["'][^"']*infisical/i,
  /\bfetch\s*\(/,
  /\brequire\(/,
  /readFileSync/,
  /console\./,
];

describe("static: no verb module imports anything capable of resolving a value", () => {
  it("the derived verb-module set is non-empty", () => {
    // A derivation that quietly resolved to [] would make every test below
    // vacuously pass without checking a single file — see #907.
    expect(NEW_VERB_MODULES.length).toBeGreaterThan(0);
  });

  for (const file of NEW_VERB_MODULES) {
    it(`${file} imports no resolution/provider module and performs no I/O`, () => {
      const source = readFileSync(join(here, file), "utf8");
      for (const pattern of FORBIDDEN_PATTERNS) {
        expect(source).not.toMatch(pattern);
      }
    });
  }
});

describe("runtime: every produced record has a closed, exact field set", () => {
  const DECOY = "sk_live_should_never_appear_in_a_locksmith_record_0000000000";

  it("a custody record's decoy note stays an opaque field, alongside no unexpected field", () => {
    const manifest = defineKeyCustody([{ key: "K", owner: "team", store: "infisical", notes: DECOY }]);
    const record = custodyOf(manifest, "K");
    expect(record).toBeDefined();
    expect(new Set(Object.keys(record!))).toEqual(new Set(["key", "owner", "store", "notes"]));
    expect(record!.notes).toBe(DECOY);
  });

  it("a rotation evaluation never carries the input digest, or any field beyond key/state/ageDays", () => {
    const custody = defineKeyCustody([{ key: "K", owner: "team", store: "infisical" }]);
    const evaluation = evaluateRotation(
      { key: "K", lastRotatedAt: new Date().toISOString(), digest: DECOY },
      { key: "K", maxAgeDays: 90 },
      custody,
    );
    expect(new Set(Object.keys(evaluation))).toEqual(new Set(["key", "state", "ageDays"]));
    expect(JSON.stringify(evaluation)).not.toContain(DECOY);
  });

  it("a revocation record's decoy reason stays an opaque field, alongside no unexpected field", () => {
    const record = recordRevocation({
      key: "K",
      revokedAt: new Date().toISOString(),
      revokedBy: "team",
      reason: DECOY,
    });
    expect(new Set(Object.keys(record))).toEqual(new Set(["key", "revokedAt", "revokedBy", "reason"]));
    expect(record.reason).toBe(DECOY);
  });

  it("a distribution entry exposes only key/principals, even with a decoy-shaped principal", () => {
    const manifest = defineDistributionManifest([{ key: "K", principals: [DECOY] }]);
    const entry = manifest.entries[0];
    expect(entry).toBeDefined();
    expect(new Set(Object.keys(entry!))).toEqual(new Set(["key", "principals"]));
  });

  it("credential evaluation never echoes an injected value-shaped field", () => {
    const result = evaluateCredential({
      key: "GITHUB_TOKEN",
      credentialClass: "ephemeral-job",
      provider: "github-actions",
      scope: ["packages:read"],
      jobStartedAt: "2026-08-18T00:00:00.000Z",
      jobEndedAt: "2026-08-18T00:01:00.000Z",
      expiresAtJobEnd: true,
      scopedUseObserved: true,
      token: DECOY,
    });
    expect(result.verdict).toBe("indeterminate");
    expect(JSON.stringify(result)).not.toContain(DECOY);
    expect(new Set(Object.keys(result))).toEqual(new Set(["key", "credentialClass", "verdict", "exitCode", "reasons"]));
  });

  it("provider-custody evaluation never echoes an injected value-shaped field", () => {
    const result = evaluateProviderCustody({
      key: "CLOUDFLARE_API_TOKEN",
      provider: "cloudflare",
      rung: "scoped-environment-secret",
      owner: "team-platform",
      store: "github-environment:deploy-cloudflare",
      scope: ["zone:edit:example.com"],
      leastPrivilegeNote: "One zone only, Workers deploy, no account-wide access.",
      usedBy: [".github/workflows/deploy.yml#deploy-cloudflare"],
      rotationPolicy: { maxAgeDays: 90 },
      token: DECOY,
    });
    expect(result.verdict).toBe("indeterminate");
    expect(JSON.stringify(result)).not.toContain(DECOY);
    expect(new Set(Object.keys(result))).toEqual(new Set(["key", "provider", "rung", "verdict", "exitCode", "reasons"]));
  });
});
