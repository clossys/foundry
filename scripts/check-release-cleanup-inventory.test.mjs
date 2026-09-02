import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  INVENTORY_PATH,
  METADATA_CANONICALIZATION,
  OBSERVED_BASE_COMMIT,
  canonicalMetadataJson,
  canonicalMetadataSha256,
  validateReleaseCleanupInventory,
} from "./check-release-cleanup-inventory.mjs";
import { loadTransitionPolicy } from "./lib/package-identity-transition.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const inventory = JSON.parse(readFileSync(join(root, INVENTORY_PATH), "utf8"));
const transition = loadTransitionPolicy(join(root, "governance/package-identity-transition.json"));

function validFindings(value = inventory) {
  return validateReleaseCleanupInventory({ root, inventory: value, transition });
}

// The replacement floor pins asserted by the manifest-mismatch loop under
// test. Hardcoded here (rather than imported) because REPLACEMENTS is
// intentionally not exported — these tests must not be able to make the
// production floor move by editing a shared fixture.
const REPLACEMENT_FLOORS = [
  ["@clossys/advisor", "0.1.6"],
  ["@clossys/starter", "0.1.5"],
  ["@clossys/controller", "0.8.24"],
  ["@clossys/strategist", "0.1.2"],
];

// Builds a scratch `packages/<slug>/package.json` tree so the manifest loop
// can be exercised without touching the real, currently-sealed manifests.
// Every replacement package gets a manifest at its exact sealed floor unless
// overridden, so only the package under test varies.
function withReplacementManifests(overrides, fn) {
  const tempRoot = mkdtempSync(join(tmpdir(), "release-cleanup-inventory-"));
  try {
    for (const [name, version] of REPLACEMENT_FLOORS) {
      const slug = name.slice(name.indexOf("/") + 1);
      const dir = join(tempRoot, "packages", slug);
      mkdirSync(dir, { recursive: true });
      const manifest = overrides[name] ?? { name, version };
      writeFileSync(join(dir, "package.json"), JSON.stringify(manifest));
    }
    return fn(tempRoot);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

test("the checked-in cleanup inventory is a sealed valid observation", () => {
  assert.deepEqual(validFindings(), []);
  assert.equal(inventory.baseCommit, OBSERVED_BASE_COMMIT);
  assert.deepEqual(inventory.metadataCanonicalization, METADATA_CANONICALIZATION);
});

test("the inventory validator is blocking in the aggregate and CI", () => {
  const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  assert.match(manifest.scripts.check, /npm run check:release-cleanup-inventory/);
  assert.match(manifest.scripts["check:gates"], /scripts\/check-release-cleanup-inventory\.test\.mjs/);

  const workflow = readFileSync(join(root, ".github/workflows/ci.yml"), "utf8");
  assert.match(workflow, /- run: npm run check:release-cleanup-inventory/);
  assert.match(
    workflow,
    /scope:\n[\s\S]*?actions\/checkout@[^\n]+\n\s+with:\n[\s\S]*?fetch-depth: 0[\s\S]*?npm run check:release-cleanup-inventory/,
  );
});

test("a same-shape metadata or tarball substitution is rejected", () => {
  for (const [index] of inventory.rows.entries()) {
    const metadata = structuredClone(inventory);
    metadata.rows[index].metadataSha256 = "0".repeat(64);
    assert.match(validFindings(metadata).join("\n"), /sealed observed tuple mismatch/);

    const tarball = structuredClone(inventory);
    tarball.rows[index].tarball.sha256 = "f".repeat(64);
    assert.match(validFindings(tarball).join("\n"), /sealed observed tuple mismatch/);
  }
});

test("a different resolvable commit cannot replace the sealed observation basis", () => {
  const value = structuredClone(inventory);
  value.baseCommit = "7ebe831cc3536a4a18e265b63fe1767b6396f67f";
  assert.match(validFindings(value).join("\n"), /sealed observation basis/);
});

test("the exact sealed base must be an ancestor of the checked head", () => {
  assert.match(
    validateReleaseCleanupInventory({
      root,
      inventory,
      transition,
      head: "088d38952850af2c825e69333ed5243bb62cedc7",
    }).join("\n"),
    /ancestor of the checked head/,
  );
});

test("coordinated inventory and transition substitutions cannot create a new observation", () => {
  const value = structuredClone(inventory);
  const policy = structuredClone(transition);
  value.rows[0].version = "0.1.4";
  policy.historicalRepositoryVersions[0].version = "0.1.4";
  assert.match(
    validateReleaseCleanupInventory({ root, inventory: value, transition: policy }).join("\n"),
    /not one of the seven sealed observed tuples/,
  );
});

test("a manifest at exactly the sealed replacement version passes", () => {
  withReplacementManifests({}, (tempRoot) => {
    const findings = validateReleaseCleanupInventory({ root: tempRoot, inventory, transition }).join("\n");
    assert.doesNotMatch(findings, /replacement manifest/);
  });
});

test("a manifest above the sealed replacement version passes (the floor may advance)", () => {
  withReplacementManifests({ "@clossys/advisor": { name: "@clossys/advisor", version: "0.2.0" } }, (tempRoot) => {
    const findings = validateReleaseCleanupInventory({ root: tempRoot, inventory, transition }).join("\n");
    assert.doesNotMatch(findings, /replacement manifest/);
  });

  // Two-digit minor versions must be compared numerically, not lexically —
  // "0.10.0" < "0.9.0" as strings, which would be a new bug here.
  withReplacementManifests({ "@clossys/advisor": { name: "@clossys/advisor", version: "0.10.0" } }, (tempRoot) => {
    const findings = validateReleaseCleanupInventory({ root: tempRoot, inventory, transition }).join("\n");
    assert.doesNotMatch(findings, /replacement manifest/);
  });

  // This pair is the one that actually distinguishes numeric from lexical
  // comparison against a real sealed floor: "0.10.0" < "0.8.24" as strings
  // (comparing the "1" and "8" byte), which would wrongly fail a package
  // that has correctly advanced from 0.8.24 into its second double-digit
  // minor release.
  withReplacementManifests({ "@clossys/controller": { name: "@clossys/controller", version: "0.10.0" } }, (tempRoot) => {
    const findings = validateReleaseCleanupInventory({ root: tempRoot, inventory, transition }).join("\n");
    assert.doesNotMatch(findings, /replacement manifest/);
  });
});

test("a manifest below the sealed replacement version still fails", () => {
  withReplacementManifests({ "@clossys/advisor": { name: "@clossys/advisor", version: "0.1.5" } }, (tempRoot) => {
    const findings = validateReleaseCleanupInventory({ root: tempRoot, inventory, transition }).join("\n");
    assert.match(findings, /replacement manifest mismatch for @clossys\/advisor/);
  });
});

test("a manifest with a mismatched name still fails even at the sealed version", () => {
  withReplacementManifests(
    { "@clossys/advisor": { name: "@clossys/not-advisor", version: "0.1.6" } },
    (tempRoot) => {
      const findings = validateReleaseCleanupInventory({ root: tempRoot, inventory, transition }).join("\n");
      assert.match(findings, /replacement manifest mismatch for @clossys\/advisor/);
    },
  );
});

test("metadata canonicalization recursively sorts keys and preserves array order", () => {
  const value = { z: 1, a: { d: 2, c: 3 }, arr: [{ b: 2, a: 1 }] };
  const canonical = '{"a":{"c":3,"d":2},"arr":[{"a":1,"b":2}],"z":1}';
  assert.equal(canonicalMetadataJson(value), canonical);
  assert.equal(canonicalMetadataSha256(value), createHash("sha256").update(canonical).digest("hex"));
});
