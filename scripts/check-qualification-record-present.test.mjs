import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { qualificationRecordPresence } from "./check-qualification-record-present.mjs";

// The gate reads the real policy to derive a record's path, so a fixture root
// borrows this repository's policy rather than inventing a second one that
// could drift from it.
function fixtureRoot(t) {
  const root = mkdtempSync(join(tmpdir(), "foundry-record-presence-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "governance"), { recursive: true });
  cpSync("governance/release-qualification-policy.json", join(root, "governance/release-qualification-policy.json"));
  mkdirSync(join(root, "governance/release-qualifications"), { recursive: true });
  return root;
}

function writeManifest(root, key, manifest) {
  mkdirSync(join(root, "packages", key), { recursive: true });
  writeFileSync(join(root, "packages", key, "package.json"), JSON.stringify(manifest));
}

test("reports present when the retained record exists for the manifest's exact version", (t) => {
  const root = fixtureRoot(t);
  writeManifest(root, "writer", { name: "@clossys/writer", version: "0.3.3" });
  writeFileSync(join(root, "governance/release-qualifications/clossys-writer-0.3.3.json"), "{}");
  const result = qualificationRecordPresence({ root, packageKey: "writer" });
  assert.equal(result.state, "present");
  assert.equal(result.path, "governance/release-qualifications/clossys-writer-0.3.3.json");
});

// The negative control. A presence check that passes regardless of whether the
// record is there would be worse than no check: it would hand back a green
// preflight and let the run spend an approval anyway, which is the exact
// failure #769 describes. These two cases are what make the green meaningful.
test("reports missing when no record exists for that version", (t) => {
  const root = fixtureRoot(t);
  writeManifest(root, "writer", { name: "@clossys/writer", version: "0.3.3" });
  const result = qualificationRecordPresence({ root, packageKey: "writer" });
  assert.equal(result.state, "missing");
  assert.equal(result.path, "governance/release-qualifications/clossys-writer-0.3.3.json");
});

test("reports missing when a record exists but for a different version", (t) => {
  const root = fixtureRoot(t);
  writeManifest(root, "writer", { name: "@clossys/writer", version: "0.3.3" });
  writeFileSync(join(root, "governance/release-qualifications/clossys-writer-0.3.2.json"), "{}");
  const result = qualificationRecordPresence({ root, packageKey: "writer" });
  assert.equal(result.state, "missing", "a record for a neighbouring version must not satisfy this version");
});

test("is indeterminate, never a pass, when the manifest cannot be read", (t) => {
  const root = fixtureRoot(t);
  const result = qualificationRecordPresence({ root, packageKey: "writer" });
  assert.equal(result.state, "indeterminate");
});

test("is indeterminate, never a pass, when the manifest declares no name/version", (t) => {
  const root = fixtureRoot(t);
  writeManifest(root, "writer", { private: true });
  const result = qualificationRecordPresence({ root, packageKey: "writer" });
  assert.equal(result.state, "indeterminate");
});

test("is indeterminate, never a pass, when no package key is given", () => {
  assert.equal(qualificationRecordPresence({}).state, "indeterminate");
});
