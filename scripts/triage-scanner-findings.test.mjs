import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { generateIgnore, groupFindings, nameForeignNeed, proveFingerprint, triage } from "./triage-scanner-findings.mjs";

const commit = "a".repeat(40), sourceTree = "b".repeat(40);
const file = "scripts/lib/designer-foundation.json";
const bytes = Buffer.from("export const fixture = true;\n");
const hash = createHash("sha256").update(bytes).digest("hex");
function fixture() {
  const contents = JSON.stringify({ schema: "designer-foundation/v1", sourceTree, files: { "src/tokens/fixture.ts": hash } }, null, 2);
  const line = contents.split("\n").findIndex(text => text.includes(hash)) + 1;
  const row = { commit, file, rule: "generic-api-key", line, endLine: line, fingerprint: `${commit}:${file}:generic-api-key:${line}` };
  const blobs = new Map([[`${commit}:${file}`, Buffer.from(contents)], [`${sourceTree}:packages/designer/src/tokens/fixture.ts`, bytes]]);
  return { row, blobs, read: (ref, path) => blobs.get(`${ref}:${path}`) ?? null };
}

test("a fingerprint requires a source digest recomputed from its immutable tree", () => {
  const { row, read, blobs } = fixture();
  assert.equal(proveFingerprint(row, read).status, "false-positive");
  blobs.set(`${sourceTree}:packages/designer/src/tokens/fixture.ts`, Buffer.from("changed bytes"));
  assert.equal(proveFingerprint(row, read).status, "BLOCKED-SECRET");
});

test("an unknown file stays blocked and is never opened", () => {
  const { row } = fixture();
  let reads = 0;
  const unknown = { ...row, file: "src/unknown.json", fingerprint: `${commit}:src/unknown.json:generic-api-key:${row.line}` };
  assert.equal(proveFingerprint(unknown, () => { reads++; }).status, "BLOCKED-SECRET");
  assert.equal(reads, 0);
});

test("a known file, rule or neighboring line grants no exception without the exact proof", () => {
  const { row, read } = fixture();
  for (const mutation of [{ rule: "other-rule" }, { line: row.line - 1 }, { endLine: row.endLine + 1 }, { fingerprint: row.fingerprint.replace(commit, sourceTree) }]) {
    assert.equal(proveFingerprint({ ...row, ...mutation }, read).status, "BLOCKED-SECRET");
  }
});

test("Writer aliases must resolve to a real record in the same envelope", () => {
  const path = "packages/writer/src/catalog/records/admin-pages.r1.en.json";
  const document = { version: 1, aliases: { "strings.admin.column.key": "st.fixture001" }, records: [{ id: "st.fixture001", text: "Key" }] };
  const make = () => JSON.stringify(document, null, 2);
  const line = make().split("\n").findIndex(text => text.includes("strings.admin.column.key")) + 1;
  const row = { commit, file: path, rule: "generic-api-key", line, endLine: line, fingerprint: `${commit}:${path}:generic-api-key:${line}` };
  assert.equal(proveFingerprint(row, () => Buffer.from(make())).status, "false-positive");
  document.records = [];
  assert.equal(proveFingerprint(row, () => Buffer.from(make())).status, "BLOCKED-SECRET");
  document.externalRecords = [{ recordId: "st.fixture001" }];
  assert.equal(proveFingerprint(row, () => Buffer.from(make())).status, "false-positive");
});

test("only proven individual fingerprints receive a reason and ignore entry", () => {
  const { row, read } = fixture();
  const proof = { fingerprint: row.fingerprint, ...proveFingerprint(row, read) };
  const text = generateIgnore([proof, proof, { fingerprint: "unproved", status: "BLOCKED-SECRET" }]);
  assert.equal(text.split("\n").filter(line => line === row.fingerprint).length, 1);
  assert.match(text, /# SHA-256 source-blob digest/);
  assert.equal(text.includes("unproved"), false);
  assert.throws(() => generateIgnore([{ ...proof, fingerprint: `${commit}:src/*:generic-api-key:1` }]), /Invalid fingerprint/);
  assert.throws(() => generateIgnore([{ ...proof, fingerprint: `${commit}:src/[ab]:generic-api-key:1` }]), /Invalid fingerprint/);
  assert.throws(() => generateIgnore([{ ...proof, reason: "reason\nunsafe" }]), /Invalid fingerprint/);
});

test("raw match or secret fields are rejected before any report inputs are opened", () => {
  assert.throws(() => triage("absent-fixture-root", [], [{ Secret: "fixture" }]), /Only metadata/);
  assert.throws(() => triage("absent-fixture-root", [{ text: "fixture" }], []), /Only metadata/);
});

test("findings are grouped by both rule and exact path", () => {
  const groups = groupFindings([{ file: "src/a.ts", kind: "scope" }, { file: "src/a.ts", kind: "forge" }, { file: "src/b.ts", kind: "scope" }, { file: "src/a.ts", kind: "scope" }], "kind");
  assert.equal(groups.length, 3);
  assert.equal(groups.find(group => group.file === "src/a.ts" && group.rule === "scope").findings.length, 2);
  assert.throws(() => groupFindings([{ file: "../escape", kind: "scope" }], "kind"), /Invalid metadata/);
});

test("each unresolved rule-path group receives a stable NEED with no admission", () => {
  const group = { file: "src/source.ts", rule: "npm-scope", count: 2, approvedSources: [] };
  const need = nameForeignNeed(group);
  assert.equal(need.status, "NEED");
  assert.match(need.id, /^NEED-FOREIGN-[a-f0-9]{16}$/);
  assert.equal(nameForeignNeed({ ...group, count: 3 }).id, need.id);
  assert.notEqual(nameForeignNeed({ ...group, rule: "forge-slug" }).id, need.id);
  assert.notEqual(nameForeignNeed({ ...group, file: "src/other.ts" }).id, need.id);
  assert.deepEqual(need.approvedSources, []);
});
