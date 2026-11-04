import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { fileFindings, isHistoryPath } from "./check-no-strategist.mjs";

const sha256 = (text) => createHash("sha256").update(text).digest("hex");

test("a live line naming the retired role is a finding, in any case", () => {
  const findings = fileFindings("packages/director/README.md", "# Director\nThe Strategist plans.\nSTRATEGIST\n");
  assert.deepEqual(findings.map((finding) => finding.line), [2, 3]);
});

test("a live path naming the retired role is a finding", () => {
  const findings = fileFindings("packages/strategist/package.json", "{}\n");
  assert.deepEqual(findings, [{ path: "packages/strategist/package.json", line: 0, text: "packages/strategist/package.json" }]);
});

test("dated history is left as written", () => {
  assert.equal(isHistoryPath("docs/changelogs/strategist.md"), true);
  assert.equal(isHistoryPath("governance/release-catalog.json"), true);
  assert.deepEqual(fileFindings("docs/changelogs/strategist.md", "## 0.6.0 strategist\n"), []);
  assert.equal(isHistoryPath("docs/LIFECYCLE.md"), false);
});

test("a line recorded by digest in identity history stays unchanged", () => {
  const line = "| `@vespeneventures/strategist` | retired |";
  assert.deepEqual(fileFindings("docs/LIFECYCLE.md", `${line}\n`, new Set([sha256(line)])), []);
  assert.equal(fileFindings("docs/LIFECYCLE.md", `${line} edited\n`, new Set([sha256(line)])).length, 1);
});

test("a link to a history record names it as it is spelled, and nothing else on the line is excused", () => {
  assert.deepEqual(fileFindings("packages/director/README.md", "See [changes](../../docs/changelogs/strategist.md).\n"), []);
  assert.equal(fileFindings("packages/director/README.md", "The strategist: see docs/changelogs/strategist.md\n").length, 1);
});

test("only the rename map and this check may spell the word", () => {
  assert.deepEqual(fileFindings("scripts/lib/package-renames.mjs", "publishedDirectory: \"strategist\"\n"), []);
  assert.equal(fileFindings("scripts/lib/other.mjs", "publishedDirectory: \"strategist\"\n").length, 1);
});

test("the check's own name is not a finding where it is wired, and nothing else on the line is excused", () => {
  assert.deepEqual(fileFindings("package.json", '    "check:no-strategist": "node --test scripts/check-no-strategist.test.mjs && node scripts/check-no-strategist.mjs",\n'), []);
  assert.equal(fileFindings("package.json", '    "check:no-strategist": "node scripts/strategist.mjs",\n').length, 1);
});

test("vendored upstream source is kept verbatim, and nothing beside it is excused", () => {
  const upstream = "packages/designer/references/tailark-oss/mist-team-1@8139698/mist/blocks/team/one.tsx";
  assert.deepEqual(fileFindings(upstream, "{ role: 'Content Strategist' },\n"), []);
  assert.equal(fileFindings("packages/designer/src/team.tsx", "{ role: 'Content Strategist' },\n").length, 1);
});
