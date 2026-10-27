/** Actual-source mutations run in memory; no repository source is rewritten. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { dirname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const directory = fileURLToPath(new URL("../", import.meta.url));
function loader(mutation) {
  const cache = new Map();
  function compile(name) {
    if (cache.has(name)) return cache.get(name);
    let source = readFileSync(join(directory, `${name}.ts`), "utf8");
    if (mutation?.module === name) {
      assert(source.includes(mutation.from), `Missing mutation anchor: ${mutation.name}`);
      source = source.replace(mutation.from, mutation.to);
    }
    let js = stripTypeScriptTypes(source);
    const builtins = new Set();
    js = js.replace(/from "([^\"]+)"/g, (match, specifier) => {
      if (specifier.startsWith("node:")) { builtins.add(specifier); return match; }
      if (!specifier.startsWith(".")) return match;
      const child = compile(normalize(join(dirname(name), specifier.slice(0, -3))));
      child.builtins.forEach(value => builtins.add(value));
      return `from ${JSON.stringify(child.url)}`;
    });
    const result = { url: "data:text/javascript;base64," + Buffer.from(js).toString("base64"), builtins };
    cache.set(name, result); return result;
  }
  return compile;
}
const checks = [];
const proof = (name, module, from, to, check) => checks.push({ name, module, from, to, check });
const rule = (findings, expected) => assert(findings.some(f => f.rule === expected), `Missing finding ${expected}`);
function libraryProof(name, from, mutate, expected) {
  proof(name, "library", from, "false", ({ core, fixtures }) => {
    const registry = structuredClone(fixtures.reviewFixture()); const libraries = fixtures.libraryFixture();
    mutate(registry, libraries);
    rule(core.checkContentLibraryReferences(registry, libraries), expected);
  });
}
libraryProof("exact library version", "snapshot.version === composition.libraryVersion", (_r, l) => { l[0].version = "2"; }, "unavailable-library-version");
// A permissive version mutant is necessary to prove that stale versions are refused.
checks.at(-1).to = "true";
libraryProof("consumer isolation", "snapshot.consumerId === registry.workspace.consumerId", (_r, l) => { l[0].consumerId = "foreign"; }, "unavailable-library-version");
checks.at(-1).to = "true";
libraryProof("frame registration", "!frame", (_r, l) => { l[0].frames = []; }, "unregistered-frame");
// Keep the downstream config branch safe so this mutant measures the registration refusal.
checks.at(-1).from = 'if (!frame) add(`${path}.composition.frame.frameId`, "unregistered-frame", `Unregistered frame: ${composition.frame.frameId}`);';
checks.at(-1).to = 'if (!frame) return;';
libraryProof("frame config ownership", "!frame.configIds.includes(composition.frame.configId)", (_r, l) => { l[0].frames[0].configIds = []; l[0].frames.push({ id: "other", configIds: ["default"] }); }, "unregistered-frame-config");
libraryProof("section registration", "!entry", (_r, l) => { l[0].sections = []; }, "unregistered-section");
checks.at(-1).from = 'if (!entry) add(`${path}.sectionId`, "unregistered-section", `Unregistered section: ${current.sectionId}`);';
checks.at(-1).to = 'if (!entry) return;';
libraryProof("section config ownership", "!entry.configIds.includes(current.configId)", (_r, l) => { l[0].sections[0].configIds = []; l[0].sections.push({ id: "other", configIds: ["default"] }); }, "unregistered-section-config");
libraryProof("asset registration", "!library.assetIds.includes(ref.assetId)", (_r, l) => { l[0].assetIds = []; }, "unregistered-asset");
libraryProof("asset version", "ref.libraryVersion !== library.version", r => { r.candidates[0].composition.sections[0].fields[0].assets[0].libraryVersion = "2"; }, "asset-library-version");
libraryProof("type settings assets", 'Object.hasOwn(value, "assetId")', r => { r.candidates[0].typeSettings.shareImage.assetId = "missing"; }, "unregistered-asset");
libraryProof("duplicate library identity", "versions.has(identity)", (_r, l) => { l.push(structuredClone(l[0])); }, "duplicate-library-version");
libraryProof("duplicate registrations", "ids.has(entry.id)", (_r, l) => { l[0].sections.push(structuredClone(l[0].sections[0])); }, "duplicate-library-id");
proof("pinned section resolution", "library", 'add(`${path}.ref`, "unresolved-section-reference", "Pinned candidate revision and section key must exist");', "", ({ core, fixtures }) => {
  const registry = structuredClone(fixtures.reviewFixture());
  registry.candidates[0].composition.sections[0].ref = { candidateId: "missing", sectionKey: "intro", revision: "r1" };
  rule(core.checkContentLibraryReferences(registry, fixtures.libraryFixture()), "unresolved-section-reference");
});
proof("pinned section cycle", "library", 'add(`${path}.ref`, "section-reference-cycle", "Pinned section reference is cyclic");', "", ({ core, fixtures }) => {
  const registry = structuredClone(fixtures.reviewFixture()); const ref = { candidateId: "sample", sectionKey: "intro", revision: "r1" };
  registry.candidates[0].composition.sections[0].ref = ref; registry.candidates[0].history[0].content.composition.sections[0].ref = ref;
  rule(core.checkContentLibraryReferences(registry, fixtures.libraryFixture()), "section-reference-cycle");
});
proof("single active candidate", "validate", 'if (active.length > 1) checks.add(p, "one-active-candidate");', "", ({ node, fixtures }) => {
  const registry = fixtures.reviewFixture(); registry.candidates.push({ ...registry.candidates[0], id: "other" });
  rule(node.checkContentActivation(registry), "one-active-candidate");
});
proof("active pointer", "validate", "slot.activeCandidateId !== active[0]?.id || active.length > 1", "false", ({ node, fixtures }) => {
  const registry = fixtures.reviewFixture(); registry.slots[0].activeCandidateId = "missing";
  rule(node.checkContentActivation(registry), "active-candidate-pointer");
});
for (const [name, from, mutate, expected] of [
  ["approval presence", 'add("approval-required", "Current revision requires recorded approval");', v => { delete v.approval; }, "approval-required"],
  ["approval revision", "approval.revision !== candidate.revision", v => { v.approval.revision = "r2"; }, "approval-revision"],
  ["approval digest", "approval.digest !== computeContentDigest(candidate)", v => { v.approval.digest = "forged"; }, "approval-digest"],
  ["owner-only Publish", 'approval.source !== "owner"', v => { v.approval.source = "imported-baseline"; }, "publish-owner-approval"],
  ["active-only Publish", 'candidate.state !== "active"', v => { v.state = "approved"; }, "publish-active-candidate"],
]) proof(name, "approval", from, from.endsWith(";") ? "" : "false", ({ node, fixtures }) => {
  const candidate = structuredClone(fixtures.reviewFixture().candidates[0]); mutate(candidate);
  rule(node.checkContentApproval(candidate, "publish"), expected);
});
proof("recomputed snapshot integrity", "approval", "[...validateContentRevisionIntegrity(value)]", "[]", ({ node, fixtures }) => {
  const registry = structuredClone(fixtures.reviewFixture());
  registry.candidates[0].history[0].digest = "forged";
  rule(node.checkContentActivation(registry), "revision-digest");
});
proof("activation invokes approval", "approval", 'if (candidate.state !== "active") return;', "return;", ({ node, fixtures }) => {
  const registry = fixtures.reviewFixture(); delete registry.candidates[0].approval;
  rule(node.checkContentActivation(registry), "approval-required");
});
proof("pinned snapshot bytes", "approval", "snapshot.digest !== computeContentDigest(snapshot.content)", "false", ({ node, fixtures }) => {
  const registry = structuredClone(fixtures.reviewFixture()); const candidate = registry.candidates[0];
  const source = structuredClone(candidate); source.id = "source"; source.state = "draft"; delete source.approval; registry.candidates.push(source);
  candidate.composition.sections[0].ref = { candidateId: "source", revision: "r1", sectionKey: "intro" };
  candidate.history = [node.createContentRevision(candidate, "r1", fixtures.at)]; candidate.approval.digest = candidate.history[0].digest;
  source.history[0].content.composition.sections[0].fields[0].text = "Tampered";
  rule(node.checkContentActivation(registry), "pinned-revision-digest");
});
proof("runtime-neutral barrel", "index", '/** Provider-neutral', 'export { checkContentApproval } from "./approval.js";\n/** Provider-neutral', ({ builtins }) => assert.deepEqual([...builtins], []));

async function environment(mutation) {
  const compile = loader(mutation); const core = compile("index"); const node = compile("node"); const fixtures = compile("__fixtures__/review");
  return { core: await import(core.url), node: await import(node.url), fixtures: await import(fixtures.url), builtins: core.builtins };
}
const baseline = await environment();
assert.deepEqual(baseline.core.checkContentLibraryReferences(baseline.fixtures.reviewFixture(), baseline.fixtures.libraryFixture()), []);
assert.deepEqual(baseline.node.checkContentActivation(baseline.fixtures.reviewFixture()), []);
for (const check of checks) check.check(baseline);
console.log(`Actual-source review baseline PASS (${checks.length} invariants)`);
for (const check of checks) {
  let killed = false;
  try { check.check(await environment(check)); } catch (error) { if (error.code !== "ERR_ASSERTION") throw error; killed = true; }
  assert(killed, `Surviving mutant: ${check.name}`);
  console.log(`KILLED ${check.name}`);
}
console.log(`Review mutation proof: ${checks.length}/${checks.length} killed`);
