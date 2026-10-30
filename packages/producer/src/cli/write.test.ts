import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const entry = resolve(dirname(fileURLToPath(import.meta.url)), "../../dist/cli/index.js");
let fixture: string;
beforeEach(() => {
  fixture = mkdtempSync(join(tmpdir(), "producer-write-"));
  mkdirSync(join(fixture, "clossys"));
  writeFileSync(join(fixture, "clossys", "clossys.config.ts"), "throw new Error('Config must not execute');\n");
});
afterEach(() => rmSync(fixture, { recursive: true, force: true }));
function run(args: string[], cwd = fixture) {
  const result = spawnSync(process.execPath, [entry, ...args, "--json"], { cwd, encoding: "utf8" });
  expect(result.error).toBeUndefined();
  expect(result.stderr).toBe("");
  expect(result.stdout.trim().split("\n")).toHaveLength(1);
  const value = JSON.parse(result.stdout);
  expect(value.exitCode).toBe(result.status);
  return { status: result.status, value };
}
function json(path: string, value: unknown) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, JSON.stringify(value, null, 2) + "\n"); }
function snapshot(root = fixture): unknown[] {
  return readdirSync(root).sort().flatMap((name): unknown[] => {
    const path = join(root, name), stat = statSync(path);
    const item = { path: relative(fixture, path), mtime: stat.mtimeMs, directory: stat.isDirectory() };
    return stat.isDirectory() ? [item, ...snapshot(path)] : [{ ...item, hash: createHash("sha256").update(readFileSync(path)).digest("hex") }];
  });
}
function writerCell(root = fixture) {
  const agent = join(root, "clossys", "agents", "writer");
  const path = join(agent, "cells", "site.home", "v1.md");
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `---\nid: site.home\nversion: 1\nstatus: active\nupdated: 2026-10-29\nlinks: []\nconfirmed: migration:2026-10-29\nlocales: [en]\n---\n\n## en\n### site.home.title\n<!-- {"id":"site.home.title","leaf":"strings.label","bindings":[]} -->\nA useful starting point\n\n`);
  json(join(agent, "tree.json"), { schemaVersion: 1, active: { "site.home": 1 }, retired: [] });
  json(join(agent, "compile.json"), { schemaVersion: 1, files: [{ path: "site.en.json", kind: "envelope", header: { locale: "en" }, order: [["site.home", "en", "site.home.title"]], bindingOrder: [], hasBindings: false }], passthrough: [] });
  return agent;
}

const inputs: Record<string, string> = {
  "identity.brand.essence": "Value: Helpful planning",
  "identity.brand.personality": "Traits: calm",
  "identity.visual.style": "Value: Clear visual hierarchy",
  "identity.verbal.voice": 'Sound: plain\n- Never: "risk-free"',
  "focus.segment.core": "Value: Small project teams",
  "focus.category.stance": "Value: A practical planning tool",
  "advantage.proposition.proof": 'Never-claim: "guaranteed results"',
};
function director(version = 1) {
  const agent = join(fixture, "clossys", "agents", "director");
  for (const [id, direction] of Object.entries(inputs)) {
    const path = join(agent, "cells", id, `v${version}.md`);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `---\nid: ${id}\nversion: ${version}\nstatus: active\nupdated: 2026-10-29\ncites: []\nfeeds: []\nfunctions: []\nconfirmed: msg:2026-10-29-1#U1\n---\n\n## Direction\n- ${direction}\n\n## Because\n- Fictional interview evidence.\n\n## Watch\n- Review when the audience changes.\n`);
  }
  json(join(agent, "tree.json"), { schemaVersion: 1, active: Object.fromEntries(Object.keys(inputs).map(id => [id, version])) });
  return agent;
}
function linkedWriter(brief: any) {
  const agent = writerCell();
  const refs = brief.directorInputs.map((input: any) => input.ref);
  const path = join(agent, "cells", "site.home", "v1.md");
  writeFileSync(path, readFileSync(path, "utf8").replace("links: []", `links: [${refs.join(", ")}]`));
  const record = { id: "clossys.voice.formality", context: "clossys.voice.formality", leaf: "lexicon.formality", directorSources: brief.obligations.map(({ ref, line }: any) => ({ ref, line })), register: "plain" };
  const voicePath = join(agent, "cells", "clossys.voice", "v1.md");
  mkdirSync(dirname(voicePath), { recursive: true });
  writeFileSync(voicePath, `---\nid: clossys.voice\nversion: 1\nstatus: active\nupdated: 2026-10-29\nlinks: [${refs.join(", ")}]\nconfirmed: migration:2026-10-29\nlocales: [en]\n---\n\n## en\n### clossys.voice.formality\n<!-- ${JSON.stringify({ id: record.id, leaf: record.leaf, directorSources: record.directorSources, register: record.register, bindings: [] })} -->\n\`\`\`json\n${JSON.stringify(record)}\n\`\`\`\n\n`);
  json(join(agent, "tree.json"), { schemaVersion: 1, active: { "site.home": 1, "clossys.voice": 1 }, retired: [] });
  return agent;
}

describe("clossys write deterministic modes", () => {
  it("assembles the active Director brief and checks linked Writer cells without changing bytes or mtimes", () => {
    const agent = director();
    const active = readFileSync(join(agent, "cells", "identity.verbal.voice", "v1.md"), "utf8");
    writeFileSync(join(agent, "cells", "identity.verbal.voice", "v2.md"), active.replace("version: 1", "version: 2").replace("status: active", "status: draft").replace("confirmed: msg:2026-10-29-1#U1\n", "").replace("Sound: plain", "Sound: unpublished"));
    const beforeBrief = snapshot();
    const result = run(["write", "--brief"]);
    expect(result.status).toBe(0);
    expect(snapshot()).toEqual(beforeBrief);
    const brief = result.value.brief;
    expect(brief.directorInputs).toHaveLength(7);
    expect(brief.directorInputs.find((input: any) => input.id === "identity.verbal.voice")).toMatchObject({ version: 1, ref: "director:identity.verbal.voice@1" });
    expect(brief.leaves.flatMap((leaf: any) => leaf.ids)).toContain("lexicon.formality");
    expect(brief.missingInputs).toEqual([]);
    linkedWriter(brief);
    const beforeCheck = snapshot();
    const checked = run(["write", "--check"]);
    expect(checked.status).toBe(0);
    expect(checked.value.checks.checks.voiceDerivation.ok).toBe(true);
    expect(checked.value.checks.checks.localeCoverage.complete).toBe(true);
    expect(snapshot()).toEqual(beforeCheck);
  });
  it("reports missing links, uncovered rules and banned claims with exit 1", () => {
    director();
    const brief = run(["write", "--brief"]).value.brief;
    const agent = linkedWriter(brief);
    const voicePath = join(agent, "cells", "clossys.voice", "v1.md");
    const allSources = JSON.stringify(brief.obligations.map(({ ref, line }: any) => ({ ref, line })));
    const partialSources = JSON.stringify([{ ref: brief.obligations[0].ref, line: brief.obligations[0].line }]);
    writeFileSync(voicePath, readFileSync(voicePath, "utf8").replaceAll(allSources, partialSources));
    const path = join(agent, "cells", "site.home", "v1.md");
    writeFileSync(path, readFileSync(path, "utf8").replace(/^links: .*$/m, "links: []").replace("A useful starting point", "A risk-free plan"));
    const before = snapshot();
    const checked = run(["write", "--check"]);
    expect(checked.status).toBe(1);
    const rules = checked.value.checks.findings.map((finding: any) => finding.rule);
    expect(rules).toContain("director-link-missing");
    expect(rules).toContain("voice-derivation-coverage:missing");
    expect(rules).toContain("wont-claim:hit");
    expect(snapshot()).toEqual(before);
  });
  it("detects stale links after the active Director advances", () => {
    director();
    linkedWriter(run(["write", "--brief"]).value.brief);
    expect(run(["write", "--check"]).status).toBe(0);
    director(2);
    const before = snapshot();
    const checked = run(["write", "--check"]);
    expect(checked.status).toBe(1);
    expect(checked.value.checks.findings).toContainEqual(expect.objectContaining({ rule: "director-link-stale" }));
    expect(snapshot()).toEqual(before);
  });
  it("surfaces declared locale coverage gaps without writing outputs", () => {
    director();
    const agent = linkedWriter(run(["write", "--brief"]).value.brief);
    const tree = JSON.parse(readFileSync(join(agent, "tree.json"), "utf8"));
    tree.meta = { libraryManifest: { defaultLocale: "en", locales: [{ tag: "en" }, { tag: "fr" }] } };
    json(join(agent, "tree.json"), tree);
    const before = snapshot();
    const checked = run(["write", "--check"]);
    expect(checked.status).toBe(2);
    expect(checked.value.checks.findings.some((finding: any) => finding.rule.startsWith("locale-coverage:"))).toBe(true);
    expect(snapshot()).toEqual(before);
  });
  it.each([["--brief", "--check"], ["--once"], ["--target", "example"]])("rejects incompatible write arguments %j", (...flags) => {
    const before = snapshot();
    expect(run(["write", ...flags]).status).toBe(2);
    expect(snapshot()).toEqual(before);
  });
  it.each(["direct", "publish", "produce"])("rejects --brief on %s", verb => {
    expect(run([verb, "--brief"]).value.message).toContain("--brief requires design or write");
  });
  it.each(["--brief", "--check"])("reports missing active Director for %s with no writes", flag => {
    writerCell();
    const before = snapshot();
    const result = run(["write", flag]);
    expect(result.status).toBe(2);
    expect(result.value).toMatchObject({ verb: "write", root: fixture });
    expect(result.value.message).not.toContain("not implemented");
    expect(snapshot()).toEqual(before);
  });
  it("compiles active Writer records without Director and leaves newer drafts uncompiled", () => {
    const agent = writerCell();
    const active = readFileSync(join(agent, "cells", "site.home", "v1.md"), "utf8");
    writeFileSync(join(agent, "cells", "site.home", "v2.md"), active.replace("version: 1", "version: 2").replace("status: active", "status: draft").replace("confirmed: migration:2026-10-29\n", "").replace("A useful starting point", "Draft wording"));
    const result = run(["write"]);
    expect(result.status).toBe(0);
    expect(result.value.compilation).toMatchObject({ cellCount: 1, recordCount: 1, output: "clossys/agents/writer/compiled" });
    expect(JSON.parse(readFileSync(join(agent, "compiled", "site.en.json"), "utf8")).records[0].text).toBe("A useful starting point");
    expect(JSON.parse(readFileSync(join(agent, "tree.json"), "utf8")).active).toEqual({ "site.home": 1 });
  });
  it("uses the nearest consumer root and supports a relative --root", () => {
    const inner = join(fixture, "nested");
    mkdirSync(join(inner, "clossys"), { recursive: true });
    writeFileSync(join(inner, "clossys", "clossys.config.ts"), "export default {};\n");
    writerCell(inner);
    const nested = join(inner, "app", "src");
    mkdirSync(nested, { recursive: true });
    expect(run(["write"], nested).value.root).toBe(inner);
    expect(run(["write", "--root", "nested"]).value.root).toBe(inner);
    expect(readdirSync(join(fixture, "clossys"))).toEqual(["clossys.config.ts"]);
  });
  it("returns 2 for malformed Writer cells without producing output", () => {
    const agent = writerCell();
    writeFileSync(join(agent, "cells", "site.home", "v1.md"), "malformed");
    const before = snapshot();
    expect(run(["write"]).status).toBe(2);
    expect(snapshot()).toEqual(before);
  });
});
