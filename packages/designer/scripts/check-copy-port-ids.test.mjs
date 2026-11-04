import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { COPY_PORT_ID_RE, COPY_PORT_SOURCES, checkCopyPortIds } from "./check-copy-port-ids.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(here, "../../..");
const script = path.join(here, "check-copy-port-ids.mjs");

function fixture(mutate) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "copy-port-ids-"));
  for (const source of COPY_PORT_SOURCES) {
    const target = path.join(root, source.path);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(repository, source.path), target);
  }
  mutate?.(root);
  return root;
}

test("every section and passage contract in the repository declares lowercase copy ports", () => {
  assert.deepEqual(checkCopyPortIds(repository), []);
  const run = spawnSync(process.execPath, [script, "--root", repository], { encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
});

test("the id rule accepts kebab segments with array markers and rejects capitals", () => {
  for (const key of ["page.label", "plans[].price-by-interval[].price-text", "pagination.total-text", "labels.show-all-variants", "items[]"]) assert.match(key, COPY_PORT_ID_RE);
  for (const key of ["page.previousLabel", "Page.label", "page..label", "page.label-", "page_label", ""]) assert.doesNotMatch(key, COPY_PORT_ID_RE);
});

test("a camelCase port in any covered source is a finding and exits 1", () => {
  const root = fixture(root => {
    const file = path.join(root, "packages/designer/src/catalog/slots/sections.json");
    fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace('"key": "page.previous-label"', '"key": "page.previousLabel"'));
    const passages = path.join(root, "packages/writer/src/slot-contracts/contracts/passages.json");
    fs.writeFileSync(passages, fs.readFileSync(passages, "utf8").replaceAll('"page.next-label"', '"page.nextLabel"'));
  });
  const findings = checkCopyPortIds(root);
  assert.ok(findings.some(finding => finding.file.endsWith("designer/src/catalog/slots/sections.json") && finding.key === "page.previousLabel"));
  assert.ok(findings.some(finding => finding.file.endsWith("contracts/passages.json") && finding.key === "page.nextLabel" && /limits\.fields/.test(finding.message)));
  assert.ok(findings.some(finding => finding.file.endsWith("contracts/passages.json") && finding.key === "page.nextLabel" && /exemplars/.test(finding.message)));
  const run = spawnSync(process.execPath, [script, "--root", root], { encoding: "utf8" });
  assert.equal(run.status, 1);
  assert.match(run.stderr, /page\.previousLabel/);
});

test("a missing source cannot run and exits 2", () => {
  const root = fixture(root => fs.rmSync(path.join(root, COPY_PORT_SOURCES[0].path)));
  const run = spawnSync(process.execPath, [script, "--root", root], { encoding: "utf8" });
  assert.equal(run.status, 2);
});
