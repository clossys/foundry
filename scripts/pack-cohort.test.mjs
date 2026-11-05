// Tests for scripts/pack-cohort.mjs and the cohort set in overlay-manifest.mjs.
// Rules, each with a mutation that must fail a test here:
//   1. A cohort manifest names exactly the six packages; the overlay's
//      two-package default still refuses it, and the cohort set refuses a
//      two-package manifest.
//   2. --check passes a complete pack and refuses an extra or missing file,
//      a changed tarball, a wrong expected sha and a producer.tgz without
//      the Studio standalone manifest.
//   3. assert-public --cohort fails closed on a private cohort package.
//   4. --check reports a DRAFT Studio from producer.tgz, treats a Studio
//      without `preview` as a release pack, and refuses a preview that is not
//      DRAFT or claims release qualification. A DRAFT Studio map's bindings
//      reproduce its own bindingDigest; the committed map is the pinned
//      build (generate-studio-map with no preview, since c29e70e05), so
//      committedDraftBindings refuses it and a DRAFT pack must pass
//      --preview-bindings.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { COHORT_PACKAGES, OVERLAY_PACKAGES, buildOverlayManifest, validateOverlayManifest } from "./overlay-manifest.mjs";
import { STUDIO_MANIFEST_ENTRY, checkCohort, committedDraftBindings } from "./pack-cohort.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const COMMIT = "b".repeat(40);

function scratch(t) {
  const root = mkdtempSync(join(tmpdir(), "pack-cohort-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function cohort(t, { studio = true, preview } = {}) {
  const root = scratch(t);
  const out = join(root, "out");
  mkdirSync(out);
  for (const key of COHORT_PACKAGES) {
    const tree = join(root, "tree", key);
    const files = { "package.json": JSON.stringify({ name: `@clossys/${key}`, version: "0.1.0" }), "dist/index.js": `export const k = "${key}";\n` };
    if (key === "producer" && studio) files[STUDIO_MANIFEST_ENTRY.replace(/^package\//, "")] = `${JSON.stringify({ schemaVersion: 1, serverEntry: "server.js", ...(preview ? { preview } : {}) })}\n`;
    for (const [rel, content] of Object.entries(files)) {
      mkdirSync(dirname(join(tree, "package", rel)), { recursive: true });
      writeFileSync(join(tree, "package", rel), content);
    }
    execFileSync("tar", ["-czf", join(out, `${key}.tgz`), "-C", tree, "package"]);
  }
  const changesets = join(root, ".changesets");
  mkdirSync(changesets);
  const manifest = buildOverlayManifest({ packedDir: out, changesetsDir: changesets, commit: COMMIT, committedAt: "2026-11-02T00:00:00Z", packages: COHORT_PACKAGES });
  writeFileSync(join(out, "overlay-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return { out, manifest };
}

test("rule 1: the cohort manifest is exactly the six packages and the sets do not cross", (t) => {
  assert.deepEqual([...COHORT_PACKAGES], ["producer", "director", "designer", "writer", "publisher", "controller"]);
  const { manifest } = cohort(t);
  assert.deepEqual(Object.keys(manifest.packages), [...COHORT_PACKAGES]);
  assert.doesNotThrow(() => validateOverlayManifest(manifest, COHORT_PACKAGES));
  assert.throws(() => validateOverlayManifest(manifest), /unexpected package producer/);
  const two = { ...manifest, packages: Object.fromEntries(OVERLAY_PACKAGES.map((key) => [key, manifest.packages[key]])) };
  assert.throws(() => validateOverlayManifest(two, COHORT_PACKAGES), /missing package producer/);
});

test("rule 2: --check passes a complete pack and refuses each defect", (t) => {
  const { out } = cohort(t);
  const checked = checkCohort(out, { expectedSha: COMMIT });
  assert.equal(checked.manifest.commit, COMMIT);
  assert.equal(checked.draft, null);
  assert.throws(() => checkCohort(out, { expectedSha: "c".repeat(40) }), /not the expected/);
  const cli = spawnSync(process.execPath, [join(here, "pack-cohort.mjs"), "--check", out, "--expected-sha", COMMIT], { encoding: "utf8" });
  assert.equal(cli.status, 0, cli.stderr);

  writeFileSync(join(out, "extra.txt"), "x");
  assert.throws(() => checkCohort(out), /must hold exactly/);
  rmSync(join(out, "extra.txt"));
  appendFileSync(join(out, "writer.tgz"), "x");
  assert.throws(() => checkCohort(out), /writer: integrity mismatch/);
  rmSync(join(out, "writer.tgz"));
  assert.throws(() => checkCohort(out), /must hold exactly/);
  const refused = spawnSync(process.execPath, [join(here, "pack-cohort.mjs"), "--check", out], { encoding: "utf8" });
  assert.equal(refused.status, 1);

  const { out: bare } = cohort(t, { studio: false });
  assert.throws(() => checkCohort(bare), /Studio standalone build is missing/);
});

test("rule 3: assert-public --cohort refuses a private cohort package", (t) => {
  const root = scratch(t);
  for (const key of COHORT_PACKAGES) {
    mkdirSync(join(root, key));
    writeFileSync(join(root, key, "package.json"), JSON.stringify({ name: `@clossys/${key}`, version: "0.1.0", ...(key === "controller" ? { private: true } : {}) }));
  }
  const script = join(here, "overlay-manifest.mjs");
  const two = spawnSync(process.execPath, [script, "assert-public", "--packages-root", root], { encoding: "utf8" });
  assert.equal(two.status, 0, two.stderr);
  const six = spawnSync(process.execPath, [script, "assert-public", "--cohort", "--packages-root", root], { encoding: "utf8" });
  assert.equal(six.status, 1);
  assert.match(six.stderr, /controller.*private/);
});

test("rule 4: DRAFT Studio is reported, and a mislabelled preview is refused", (t) => {
  const draft = { target: "preview", status: "DRAFT", approved: false, referenceQualified: false, releaseQualified: false, bindingDigest: "d".repeat(64) };
  assert.deepEqual(checkCohort(cohort(t, { preview: draft }).out).draft, draft);
  const cli = spawnSync(process.execPath, [join(here, "pack-cohort.mjs"), "--check", cohort(t, { preview: draft }).out], { encoding: "utf8" });
  assert.equal(cli.status, 0, cli.stderr);
  assert.match(cli.stdout, /DRAFT pack, approved false, release-qualified false/);
  assert.throws(() => checkCohort(cohort(t, { preview: { ...draft, releaseQualified: true } }).out), /must be DRAFT and not release-qualified/);
  assert.throws(() => checkCohort(cohort(t, { preview: { ...draft, status: "FINAL" } }).out), /must be DRAFT/);
  // The committed map is the pinned (release) projection: no DRAFT assembly, so it is refused.
  const committed = JSON.parse(readFileSync(join(here, "..", "packages/producer/studio/generated/studio-map.json"), "utf8"));
  assert.notEqual(committed.assembly?.status, "DRAFT");
  assert.throws(() => committedDraftBindings(), /not a DRAFT preview with items; pass --preview-bindings/);
  // A DRAFT map's bindings are derived from its items and must reproduce its bindingDigest.
  const root = scratch(t);
  const items = [
    { slot: "sections.hero", element: "Hero", version: 2, previewEvidence: { record: { sha256: "a".repeat(64) } } },
    { slot: "frames.site-shell", element: "SiteShell", version: 1, previewEvidence: { record: { sha256: "b".repeat(64) } } },
  ];
  const expected = [
    { slot: "frames.site-shell", element: "SiteShell", version: 1, hash: `sha256:${"b".repeat(64)}` },
    { slot: "sections.hero", element: "Hero", version: 2, hash: `sha256:${"a".repeat(64)}` },
  ];
  const digest = createHash("sha256").update(JSON.stringify(expected)).digest("hex");
  const write = (map) => { const path = join(root, `map-${Math.random().toString(36).slice(2)}.json`); writeFileSync(path, JSON.stringify(map)); return path; };
  const draftMap = { assembly: { ...draft, bindingDigest: digest }, items };
  assert.deepEqual(committedDraftBindings(write(draftMap)), expected);
  assert.throws(() => committedDraftBindings(write({ ...draftMap, assembly: { ...draftMap.assembly, bindingDigest: "e".repeat(64) } })), /digest to [a-f0-9]{64}, not its bindingDigest/);
  assert.throws(() => committedDraftBindings(write({ ...draftMap, items: [{ ...items[0], previewEvidence: undefined }] })), /records no candidate sha256/);
  assert.throws(() => committedDraftBindings(write({ ...draftMap, assembly: { ...draftMap.assembly, status: "PINNED" } })), /not a DRAFT preview/);
});
