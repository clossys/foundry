/** Bounded actual-source checks. No build, dependencies, generated files, or source mutation. */
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const directory = fileURLToPath(new URL("../", import.meta.url));
const at = "2026-01-01T00:00:00Z";
const content = () => ({ name: "Sample", brief: { audience: "Readers", goal: "Inform", keyMessage: "Sample", callToAction: "Continue", tone: "Clear", constraints: [], sourceAnswers: [], version: 1 }, composition: { frame: { frameId: "frames.sample", configId: "default" }, sections: [{ key: "intro", sectionId: "sections.sample", configId: "default", intent: "continues", fields: [{ field: "title", text: "Sample", source: "handwritten", assets: [{ assetId: "assets.sample", libraryVersion: "1" }] }], ref: { candidateId: "sample", sectionKey: "intro", revision: "r1" } }], libraryVersion: "1" }, links: [], typeSettings: {}, openQuestions: [] });
function fixture(node) {
  const body = content();
  return { workspace: { consumerId: "sample", deployTargets: [], destinations: [] }, slots: [{ id: "websites/site/home", l1: "websites", l2: "site", name: "Home", position: { order: 0, name: "home" }, kind: "content", devOnly: false, tags: [], releases: [], createdAt: at }], candidates: [{ ...body, id: "sample", slotId: "websites/site/home", origin: "agent-draft", state: "draft", revision: "r1", tags: [], history: [node.createContentRevision(body, "r1", at)], updatedAt: at }] };
}
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
      if (!specifier.startsWith("./")) return match;
      const child = compile(specifier.slice(2, -3));
      child.builtins.forEach(value => builtins.add(value));
      return `from ${JSON.stringify(child.url)}`;
    });
    const result = { url: "data:text/javascript;base64," + Buffer.from(js).toString("base64"), builtins };
    cache.set(name, result); return result;
  }
  return compile;
}
const checks = [];
function proof(name, module, from, to, check) { checks.push({ name, module, from, to, check }); }
const rule = (findings, expected) => assert(findings.some(f => f.rule === expected), `Missing finding ${expected}`);
proof("closed taxonomy", "taxonomy", '"site", "app"', '"social", "app"', ({ core }) => assert.deepEqual(core.CONTENT_TAXONOMY, { websites: ["site", "app", "admin", "demo", "internal"], documents: ["slides", "docs"], communications: ["messages", "videos"] }));
proof("L1/L2 pairing", "taxonomy", '.includes(l2)', '.includes("site")', ({ core }) => assert.equal(core.isContentPlacement("websites", "social"), false));
proof("permanent slot id", "validate", 'if (!isContentPlacement(v.l1, v.l2))', 'if (v.id !== `${v.l1}/${v.l2}/${v.position?.name}` || !isContentPlacement(v.l1, v.l2))', ({ core, node }) => { const v = fixture(node); v.slots[0].l1 = "documents"; v.slots[0].l2 = "docs"; assert.deepEqual(core.validateContentRegistry(v), []); });
proof("worst-wins", "stages", "Math.min(worst, rank)", "Math.max(worst, rank)", ({ core }) => assert.equal(core.rollUpStageStatuses(["Done", "Waiting", "Needs input", "Failing"]), "Failing"));
proof("empty/NA rollup", "stages", "let worst = STAGE_STATUSES.length - 1", "let worst = 0", ({ core }) => { assert.equal(core.rollUpStageStatuses([]), "Not applicable"); assert.equal(core.rollUpStageStatuses(["Not applicable"]), "Not applicable"); });
proof("pinned revision", "vocabulary", "r[1-9][0-9]*", "r[0-9]+", ({ core }) => assert.equal(core.isRevisionId("r0"), false));
proof("finite JSON", "json", "Number.isFinite(v)", "true", ({ core }) => assert.equal(core.isContentJson(Infinity), false));
for (const [name, from, mutate, expected] of [
  ["handwritten copy", 'field.source !== "handwritten"', v => { v.sections[0].fields[0].source = "writer"; }, "handwritten-source"],
  ["pinned section reference", "!isRevisionId(section.ref.revision)", v => { v.sections[0].ref.revision = "latest"; }, "pinned-revision"],
  ["unique section keys", "keys.has(section.key)", v => { v.sections.push(structuredClone(v.sections[0])); }, "duplicate-section-key"],
  ["frame config", 'text(value.frame.configId, "composition.frame.configId");', v => { delete v.frame.configId; }, "nonempty-string"],
  ["asset version", 'text(asset.libraryVersion, `${assetPath}.libraryVersion`);', v => { delete v.sections[0].fields[0].assets[0].libraryVersion; }, "nonempty-string"],
  ["composition only", "!keys.includes(key)", v => { v.layout = "stack"; }, "unknown-field"],
]) proof(name, "composition", from, from.endsWith(";") ? "" : "false", ({ core }) => { const v = content().composition; mutate(v); rule(core.validateComposition(v), expected); });
for (const [field, vocabulary] of [["state", "CANDIDATE_STATES"], ["origin", "CANDIDATE_ORIGINS"]]) proof(`candidate ${field}`, "validate", `this.enum(v.${field}, ${vocabulary}, \`${'${path}'}.${field}\`);`, "", ({ core, node }) => { const v = fixture(node); v.candidates[0][field] = "unknown"; rule(core.validateContentRegistry(v), "enum"); });
proof("single active candidate", "validate", 'if (active.length > 1) checks.add(p, "one-active-candidate");', "", ({ core, node }) => { const v = fixture(node); v.candidates[0].state = "active"; v.slots[0].activeCandidateId = "sample"; v.candidates.push({ ...v.candidates[0], id: "other" }); rule(core.validateContentRegistry(v), "one-active-candidate"); });
proof("active pointer", "validate", 'if (slot.activeCandidateId !== active[0]?.id || active.length > 1)', "if (false)", ({ core, node }) => { const v = fixture(node); v.slots[0].activeCandidateId = "missing"; rule(core.validateContentRegistry(v), "active-candidate-pointer"); });
proof("redirect content kind", "validate", '(slot.kind === "redirect") !== (candidate.redirectTarget !== undefined)', "false", ({ core, node }) => { const v = fixture(node); v.slots[0].kind = "redirect"; rule(core.validateContentRegistry(v), "slot-content-kind"); });
proof("question blocking flag", "validate", 'typeof question.blocking !== "boolean"', "false", ({ core, node }) => { const v = fixture(node); v.candidates[0].openQuestions = [{ field: "brief.goal", question: "Which goal?", blocking: "yes" }]; rule(core.validateContentRegistry(v), "blocking-boolean"); });
proof("immutable snapshots", "revisions", "Object.freeze(value);", "", ({ node }) => assert(Object.isFrozen(node.createContentRevision(content(), "r1", at).content.brief)));
proof("snapshot isolation", "revisions", "structuredClone(candidateRevisionContent(content))", "candidateRevisionContent(content)", ({ node }) => { const body = content(); assert.notStrictEqual(node.createContentRevision(body, "r1", at).content.brief, body.brief); });
proof("no revisions for metadata-only edits", "revisions", 'if (preserved.at(-1)?.digest === computeContentDigest(content))', 'if (false)', ({ node }) => { const history = node.appendContentRevision([], content(), at); const next = node.appendContentRevision(history, { ...content(), tags: ["bundle:sample"], state: "active" }, at); assert.equal(next.length, 1); assert.deepEqual(next, history); });
proof("append-only sequence", "revisions", 'snapshot.revision !== `r${i + 1}` || ', "", ({ node }) => { const snapshot = node.createContentRevision(content(), "r2", at); assert.throws(() => node.appendContentRevision([snapshot], content(), at)); });
for (const field of ["name", "brief", "composition", "links", "typeSettings", "openQuestions", "redirectTarget"]) {
  const from = ["composition", "redirectTarget"].includes(field) ? `...(value.${field} === undefined ? {} : { ${field}: value.${field} }),` : `${field}: value.${field},`;
  proof(`digest covers ${field}`, "digest", from, "", ({ node }) => {
    const a = content(); const b = structuredClone(a);
    if (field === "name") b.name = "Rewrite";
    if (field === "brief") b.brief.goal = "Explain";
    if (field === "composition") b.composition.libraryVersion = "2";
    if (field === "links") b.links = [{ toSlotId: "documents/docs/next", relation: "next", intent: "Continue" }];
    if (field === "typeSettings") b.typeSettings = { title: "Rewrite" };
    if (field === "openQuestions") b.openQuestions = [{ field: "brief.goal", question: "Which goal?", blocking: true }];
    if (field === "redirectTarget") { delete a.composition; delete b.composition; a.redirectTarget = "/one"; b.redirectTarget = "/two"; }
    assert.notEqual(node.computeContentDigest(a), node.computeContentDigest(b));
  });
}
proof("tags outside digest", "digest", 'name: value.name, brief: value.brief,', 'name: value.name, brief: value.brief, tags: value.tags ?? [],', ({ node }) => { const a = content(); assert.equal(node.computeContentDigest(a), node.computeContentDigest({ ...a, tags: ["bundle:sample"] })); });
proof("runtime-neutral barrel", "index", '/** Provider-neutral', 'export { computeContentDigest } from "./digest.js";\n/** Provider-neutral', ({ builtins }) => assert.deepEqual([...builtins], []));

async function environment(mutation) {
  const compile = loader(mutation);
  const main = compile("index"); const entry = compile("node");
  return { core: await import(main.url), node: await import(entry.url), builtins: main.builtins };
}
const baseline = await environment();
for (const check of checks) check.check(baseline);
console.log(`Actual-source baseline PASS (${checks.length} invariants)`);
for (const check of checks) {
  const mutated = await environment(check);
  let killed = false;
  try { check.check(mutated); } catch (error) { if (error.code !== "ERR_ASSERTION") throw error; killed = true; }
  assert(killed, `Surviving mutant: ${check.name}`);
  console.log(`KILLED ${check.name}`);
}
console.log(`Mutation proof: ${checks.length}/${checks.length} killed`);
