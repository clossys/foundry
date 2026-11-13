import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { approvedDesignReference, designSourceProvenance, loadApprovedDesignSources } from "./approved-design-sources.mjs";

const registry = "adopted-fixture";
const owner = "widgetco";
const unrelatedScope = `@${["unrelated", "account"].join("-")}`;
const repository = [owner, "design-source"].join("/");
const url = "https://registry.example.test/{name}.json";
const hash = `sha256:${"a".repeat(64)}`;
const provenanceFile = "references/manifest.json";
const item = { registry, name: "button", version: "1.0.0", hash };
const policy = { schemaVersion: 1, sources: [{ registry, name: "Adopted design fixture", url, provenanceFile }] };
const manifest = { registries: { [registry]: { namespace: `@${owner}`, source: url, upstream: `github.com/${repository}${"@"}abc1234` } }, items: [item] };
const write = (root, path, contents) => {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), typeof contents === "string" ? contents : JSON.stringify(contents));
};
function fixture(overrides = {}) {
  const root = mkdtempSync(join(tmpdir(), "approved-design-sources-"));
  write(root, "governance/approved-design-sources.json", overrides.policy ?? policy);
  write(root, provenanceFile, overrides.manifest ?? manifest);
  return root;
}
function withSources(fn) {
  const root = fixture();
  try { fn(loadApprovedDesignSources(root)); } finally { rmSync(root, { recursive: true, force: true }); }
}

test("admission derives only the exact adopted namespace and repository", () => withSources(sources => {
  assert.equal(sources[0].scope, owner);
  assert.equal(sources[0].repository, repository);
  assert.equal(sources[0].provenanceFile, provenanceFile);
}));

test("an absent policy grants no design source admission", () => {
  const root = mkdtempSync(join(tmpdir(), "no-design-sources-"));
  try { assert.deepEqual(loadApprovedDesignSources(root), []); } finally { rmSync(root, { recursive: true, force: true }); }
});

test("research without an adopted item fails closed", () => {
  const root = fixture({ manifest: { ...manifest, items: [] } });
  try { assert.throws(() => loadApprovedDesignSources(root), /no matching adopted/); } finally { rmSync(root, { recursive: true, force: true }); }
});

test("a changed source endpoint cannot inherit an approval", () => {
  const root = fixture({ manifest: { ...manifest, registries: { [registry]: { ...manifest.registries[registry], source: "https://other.example.test/{name}.json" } } } });
  try { assert.throws(() => loadApprovedDesignSources(root), /no matching adopted/); } finally { rmSync(root, { recursive: true, force: true }); }
});

test("wildcard, absolute, and traversal provenance paths are refused", () => {
  for (const path of ["references/*.json", "../manifest.json", "/manifest.json", "references/./manifest.json"]) {
    const root = fixture({ policy: { ...policy, sources: [{ ...policy.sources[0], provenanceFile: path }] } });
    try { assert.throws(() => loadApprovedDesignSources(root), /exact repository-relative/); } finally { rmSync(root, { recursive: true, force: true }); }
  }
});

test("a shadcn-looking unprovenanced source stays a finding", () => withSources(sources => {
  const contents = `export const reference = "https://github.com/${repository}";`;
  const carried = designSourceProvenance(contents, sources);
  assert.equal(carried.size, 0);
  assert.equal(approvedDesignReference("forge-slug", repository, carried, sources), false);
}));

test("pinned source records and exact lineage carry source-specific provenance", () => withSources(sources => {
  for (const document of [
    { lineage: { mode: "verbatim", source: { ...item, item: item.name } } },
    { pin: { url: `https://github.com/${repository}`, commit: "abc1234", sha256: "a".repeat(64) } },
    manifest,
    policy,
  ]) {
    const carried = designSourceProvenance(JSON.stringify(document), sources);
    assert.equal(approvedDesignReference("forge-slug", repository, carried, sources), true);
    assert.equal(approvedDesignReference("npm-scope", `@${owner}`, carried, sources), true);
    assert.equal(approvedDesignReference("forge-slug", `${owner}/another-repository`, carried, sources), false);
    assert.equal(approvedDesignReference("npm-scope", unrelatedScope, carried, sources), false);
  }
}));

test("an ordinary mention or changed lineage hash is not provenance", () => withSources(sources => {
  for (const contents of [
    JSON.stringify({ description: `https://github.com/${repository}` }),
    JSON.stringify({ lineage: { source: { ...item, hash: `sha256:${"b".repeat(64)}` } } }),
    `// Example: https://github.com/${repository}`,
  ]) assert.equal(designSourceProvenance(contents, sources).size, 0);
}));

test("explicit source comments carry provenance without clearing adjacent accounts", () => withSources(sources => {
  const carried = designSourceProvenance(`// Provenance: https://github.com/${repository}\nexport const peer = "${unrelatedScope}";`, sources);
  assert.equal(approvedDesignReference("forge-slug", repository, carried, sources), true);
  assert.equal(approvedDesignReference("bare-scope", unrelatedScope, carried, sources), false);
}));

test("lookalike hosts and unapproved registry endpoints carry no provenance", () => withSources(sources => {
  for (const value of [`https://github.com.evil.test/${repository}`, "https://registry.example.test.evil.test/button.json", "https://registry.example.test/../other/button.json"]) {
    const contents = `// Provenance: ${value}`;
    assert.equal(designSourceProvenance(contents, sources).size, 0);
  }
}));


test("explicit source names carry provenance only for that named approved source", () => withSources(sources => {
  for (const name of [registry, repository, `@${owner}`, sources[0].name]) {
    const carried = designSourceProvenance(`/** Source: ${name} */`, sources);
    assert.equal(approvedDesignReference("forge-slug", repository, carried, sources), true);
    assert.equal(approvedDesignReference("bare-scope", unrelatedScope, carried, sources), false);
  }
}));
