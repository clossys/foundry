import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const script = join(dirname(fileURLToPath(import.meta.url)), "generated-merge.mjs");
const outputs = ["packages/designer/styles/compiled.css", "packages/designer/styles/utilities.css", "packages/publisher/styles/preview.css"];
const evidence = "packages/publisher/src/core/web-role-pair-evidence.ts";
const env = { ...process.env, GIT_AUTHOR_NAME: "fixture", GIT_AUTHOR_EMAIL: "fixture@example.invalid", GIT_COMMITTER_NAME: "fixture", GIT_COMMITTER_EMAIL: "fixture@example.invalid", GIT_EDITOR: "true" };
function fixture(t, prefix = "generated-merge-") {
  const root = mkdtempSync(join(tmpdir(), prefix));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "scripts"));
  cpSync(script, join(root, "scripts/generated-merge.mjs"));
  const write = (path, value) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), value); };
  const run = (bin, args) => execFileSync(bin, args, { cwd: root, env, encoding: "utf8", stdio: "pipe" });
  const git = (...args) => run("git", args).trim();
  git("init", "-q", "-b", "main");
  // Tiny local generator fixtures exercise real npm, Git drivers and hooks;
  // production orchestration still invokes only the existing workspace generators.
  write("package.json", JSON.stringify({ private: true, workspaces: ["packages/*"], scripts: { "generate:frame": "node scripts/generated-merge.mjs generate" } }));
  for (const name of ["designer", "publisher"]) {
    write(`packages/${name}/package.json`, JSON.stringify({ name, scripts: { test: "node ../../scripts/fixture-measure.cjs", [name === "designer" ? "generate:compiled-css" : "generate:preview-css"]: "node ../../scripts/fixture-generate.cjs" } }));
  }
  write("scripts/fixture-generate.cjs", `const fs=require('node:fs'); const root='../..';
    const names=fs.readdirSync(root+'/inputs').sort();
    const value=names.map(n=>fs.readFileSync(root+'/inputs/'+n,'utf8')).join('');
    for(const p of ${JSON.stringify(outputs)}) fs.writeFileSync(root+'/'+p,value);
    if(fs.existsSync(root+'/fail-generation')) process.exit(7);
  `);
  write("inputs/base", "base\n");
  for (const path of outputs) write(path, "base\n");
  const measured = "src/web/frame/source.txt";
  write(`packages/publisher/${measured}`, "source\n");
  write("packages/publisher/src/core/web-role-pair-evidence.test.tsx", "fixture measurement\n");
  const pin = `sha256:${createHash("sha256").update("source\n").digest("hex")}`;
  write(evidence, `const revision = "${"0".repeat(40)}";\nconst measuredAt = "2026-10-19";\nconst sources = ${JSON.stringify({ [measured]: pin }, null, 2)} as const;\nconst record = { fixtureDigest: "sha256:${"0".repeat(64)}" };\nconst authored = "base";\n`);
  write("scripts/fixture-measure.cjs", `const fs=require('node:fs'),cp=require('node:child_process'),crypto=require('node:crypto');
    const p='src/core/web-role-pair-evidence.ts';let s=fs.readFileSync(p,'utf8');
    const files=JSON.parse(s.match(/const sources = (\\{[\\s\\S]*?\\n\\}) as const;/)[1]);
    const pins=Object.fromEntries(Object.keys(files).map(p=>[p,'sha256:'+crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')]));
    if(process.env.UPDATE_WEB_ROLE_PAIR_EVIDENCE==='1') {
      const revision=cp.execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
      for(const [p,pin] of Object.entries(pins)) if(crypto.createHash('sha256').update(cp.execFileSync('git',['show',revision+':packages/publisher/'+p])).digest('hex')!==pin.slice(7)) process.exit(4);
      s=s.replace(/const revision = "[a-f0-9]{40}";/,'const revision = "'+revision+'";').replace(/const sources = \\{[\\s\\S]*?\\n\\} as const;/,'const sources = '+JSON.stringify(pins,null,2)+' as const;');fs.writeFileSync(p,s);
    } else if(JSON.stringify(files)!==JSON.stringify(pins)) process.exit(5);
  `);
  git("add", "."); git("commit", "-qm", "base");
  const revision = git("rev-parse", "HEAD");
  write(evidence, readFileSync(join(root, evidence), "utf8").replace("0".repeat(40), revision));
  git("add", evidence); git("commit", "-qm", "retained evidence");
  return { root, write, run, git, setup: () => run(process.execPath, ["scripts/generated-merge.mjs", "setup"]) };
}

for (const order of [["first", "second"], ["second", "first"]]) {
  test(`ordinary merges regenerate both inputs in order ${order.join(" then ")}`, t => {
    const f = fixture(t); f.setup();
    const base = f.git("rev-parse", "HEAD");
    for (const name of order) {
      f.git("switch", "-qc", name, base);
      f.write(`inputs/${name}`, `${name}\n`);
      for (const path of outputs) f.write(path, `base\n${name}\n`);
      f.git("add", "."); f.git("commit", "-qm", name);
    }
    f.git("switch", "main");
    for (const name of order) f.git("merge-generated", name);
    for (const path of outputs) assert.equal(readFileSync(join(f.root, path), "utf8"), "base\nfirst\nsecond\n");
    assert.equal(f.git("status", "--porcelain"), "");
    assert.equal(f.git("diff", "--name-only", "--diff-filter=U"), "");
  });
}

test("generator failure prevents the merge commit", t => {
  const f = fixture(t); f.setup();
  f.git("switch", "-qc", "feature"); f.write("inputs/feature", "feature\n");
  f.git("add", "."); f.git("commit", "-qm", "feature"); f.git("switch", "main");
  f.git("switch", "feature"); f.write("fail-generation", "yes"); f.git("add", "."); f.git("commit", "-qm", "generator failure fixture"); f.git("switch", "main");
  const head = f.git("rev-parse", "HEAD");
  const result = spawnSync("git", ["merge-generated", "feature"], { cwd: f.root, env, encoding: "utf8" });
  assert.notEqual(result.status, 0);
  assert.equal(f.git("rev-parse", "HEAD"), head);
  assert.ok(existsSync(join(f.root, "fail-generation")));
});

test("dirty worktree is refused without changing the index or user files", t => {
  const f = fixture(t); f.setup(); f.write("inputs/base", "uncommitted\n");
  const head = f.git("rev-parse", "HEAD");
  assert.throws(() => f.git("merge-generated", "main"), /clean worktree/);
  assert.equal(f.git("rev-parse", "HEAD"), head);
  assert.equal(readFileSync(join(f.root, "inputs/base"), "utf8"), "uncommitted\n");
  assert.equal(f.git("diff", "--cached", "--name-only"), "");
});

test("evidence changes get a faithful follow-up commit without losing authored code", t => {
  const f = fixture(t); f.setup(); const base = f.git("rev-parse", "HEAD");
  f.git("switch", "-qc", "feature");
  f.write("packages/publisher/src/web/frame/source.txt", "changed source\n");
  f.write(evidence, readFileSync(join(f.root, evidence), "utf8").replace('authored = "base"', 'authored = "feature"'));
  f.git("add", "."); f.git("commit", "-qm", "feature");
  f.git("switch", "main");
  f.write(evidence, readFileSync(join(f.root, evidence), "utf8").replace('const measuredAt = "2026-10-19"', 'const measuredAt = "2026-10-20"'));
  f.git("add", "."); f.git("commit", "-qm", "measurement date");
  f.git("merge-generated", "feature");
  const source = readFileSync(join(f.root, evidence), "utf8");
  assert.match(source, /authored = "feature"/);
  assert.ok(source.includes(f.git("rev-parse", "HEAD^")));
  assert.equal(f.git("log", "-1", "--format=%s"), "Refresh web role-pair evidence after source merge");
  assert.equal(f.git("diff", "HEAD^", "--name-only"), evidence);
  assert.equal(f.git("status", "--porcelain"), "");
  assert.notEqual(base, f.git("rev-parse", "HEAD"));
  const before = readFileSync(join(f.root, evidence), "utf8");
  f.run(process.execPath, ["scripts/generated-merge.mjs", "generate"]);
  assert.equal(readFileSync(join(f.root, evidence), "utf8"), before);
  assert.equal(f.git("status", "--porcelain"), "");
});

test("authored evidence conflicts remain conflicts", t => {
  const f = fixture(t); f.setup();
  f.git("switch", "-qc", "feature");
  f.write(evidence, readFileSync(join(f.root, evidence), "utf8").replace('authored = "base"', 'authored = "feature"'));
  f.git("add", "."); f.git("commit", "-qm", "feature"); f.git("switch", "main");
  f.write(evidence, readFileSync(join(f.root, evidence), "utf8").replace('authored = "base"', 'authored = "main"'));
  f.git("add", "."); f.git("commit", "-qm", "main");
  assert.throws(() => f.git("merge-generated", "feature"));
  assert.equal(f.git("diff", "--name-only", "--diff-filter=U"), evidence);
  assert.match(readFileSync(join(f.root, evidence), "utf8"), /<<<<<<<[\s\S]*authored = "main"[\s\S]*authored = "feature"/);
});

test("setup is idempotent and never overwrites existing hooks or merge policy", t => {
  const f = fixture(t);
  const hook = join(f.root, ".git/hooks/pre-commit");
  writeFileSync(hook, "#!/bin/sh\nexit 12\n");
  f.setup();
  assert.equal(readFileSync(hook, "utf8"), "#!/bin/sh\nexit 12\n");
  rmSync(hook);
  f.setup();
  const attributes = readFileSync(join(f.root, ".git/info/attributes"), "utf8");
  f.setup();
  assert.equal(readFileSync(join(f.root, ".git/info/attributes"), "utf8"), attributes);
  f.git("config", "merge.foundry-generated.driver", "node scripts/generated-merge.mjs driver %O %A %B %P");
  f.git("config", "alias.merge-generated", "!node scripts/generated-merge.mjs merge");
  f.setup();
  assert.match(f.git("config", "--get", "alias.merge-generated"), /git-common-dir/);
  f.git("config", "merge.foundry-generated.driver", "false");
  assert.throws(() => f.setup(), /existing merge driver/);
});

test("source conflicts remain conflicts and are never marked resolved", t => {
  const f = fixture(t); f.setup();
  f.git("switch", "-qc", "feature"); f.write("inputs/base", "feature\n");
  f.git("add", "."); f.git("commit", "-qm", "feature"); f.git("switch", "main");
  f.write("inputs/base", "main\n"); f.git("add", "."); f.git("commit", "-qm", "main");
  assert.throws(() => f.git("merge-generated", "feature"));
  assert.equal(f.git("diff", "--name-only", "--diff-filter=U"), "inputs/base");
  f.write("inputs/base", "resolved\n"); f.git("add", "inputs/base");
  f.git("merge-generated", "--continue");
  for (const path of outputs) assert.equal(readFileSync(join(f.root, path), "utf8"), "resolved\n");
  assert.equal(f.git("status", "--porcelain"), "");
});

test("linked worktrees use the clone-local alias without changing the primary worktree", t => {
  const f = fixture(t, "generated-merge-$`%A ' "); f.setup();
  f.git("switch", "-qc", "feature"); f.write("inputs/feature", "feature\n");
  f.git("add", "."); f.git("commit", "-qm", "feature"); f.git("switch", "main");
  const linked = join(f.root, "linked");
  f.git("worktree", "add", "-qb", "linked", linked, "main");
  execFileSync("git", ["rm", "scripts/generated-merge.mjs"], { cwd: linked, env, stdio: "pipe" });
  execFileSync("git", ["commit", "-qm", "branch predates helper"], { cwd: linked, env, stdio: "pipe" });
  execFileSync("git", ["merge-generated", "feature"], { cwd: linked, env, stdio: "pipe" });
  for (const path of outputs) assert.equal(readFileSync(join(linked, path), "utf8"), "base\nfeature\n");
  assert.equal(f.git("diff", "--name-only"), "");
  assert.equal(f.git("branch", "--show-current"), "main");
});

test("setup preserves an unrelated file at its installation path", t => {
  const f = fixture(t);
  const installed = join(f.root, ".git/generated-merge/runner.mjs");
  mkdirSync(dirname(installed), { recursive: true });
  writeFileSync(installed, "unrelated local file\n");
  assert.throws(() => f.setup(), /existing installed runner/);
  assert.equal(readFileSync(installed, "utf8"), "unrelated local file\n");
  assert.equal(existsSync(join(f.root, ".git/info/attributes")), false);
});

test("setup recognizes its own installed runner from a CRLF checkout", t => {
  const f = fixture(t);
  const tracked = join(f.root, "scripts/generated-merge.mjs");
  writeFileSync(tracked, readFileSync(tracked, "utf8").replaceAll("\n", "\r\n"));
  f.setup();
  const installed = join(f.root, ".git/generated-merge/runner.mjs");
  const before = readFileSync(installed, "utf8");
  f.setup();
  assert.equal(readFileSync(installed, "utf8"), before);
});

test("installed coordinator merges branches that predate the tracked helper", t => {
  const f = fixture(t); f.setup();
  const base = f.git("rev-parse", "HEAD");
  f.git("switch", "-qc", "modern", base);
  f.write("inputs/modern", "modern\n");
  for (const path of outputs) f.write(path, "base\nmodern\n");
  f.git("add", "."); f.git("commit", "-qm", "modern input");
  f.git("switch", "-qc", "legacy", base);
  f.git("rm", "scripts/generated-merge.mjs");
  f.write("inputs/legacy", "legacy\n");
  for (const path of outputs) f.write(path, "base\nlegacy\n");
  f.git("add", "."); f.git("commit", "-qm", "legacy input without helper");
  f.git("merge-generated", "modern");
  for (const path of outputs) assert.equal(readFileSync(join(f.root, path), "utf8"), "base\nlegacy\nmodern\n");
  assert.equal(existsSync(join(f.root, "scripts/generated-merge.mjs")), false);
  assert.equal(f.git("status", "--porcelain"), "");
});

test("plain Git merge cannot silently accept provisional generated conflicts", t => {
  const f = fixture(t); f.setup();
  f.git("switch", "-qc", "feature"); for (const path of outputs) f.write(path, "feature\n");
  f.git("add", "."); f.git("commit", "-qm", "feature"); f.git("switch", "main");
  for (const path of outputs) f.write(path, "main\n");
  f.git("add", "."); f.git("commit", "-qm", "main");
  assert.throws(() => f.git("merge", "--no-ff", "--no-edit", "feature"), /merge-generated/);
  assert.equal(f.git("diff", "--name-only", "--diff-filter=U").split("\n").length, 3);
});

test("measurement failure keeps the source merge and creates no evidence commit", t => {
  const f = fixture(t); f.setup();
  f.git("switch", "-qc", "feature");
  f.write("scripts/fixture-measure.cjs", "process.exit(9);\n");
  f.git("add", "."); f.git("commit", "-qm", "failed measurement fixture"); f.git("switch", "main");
  assert.throws(() => f.git("merge-generated", "feature"), /exit 9/);
  assert.equal(f.git("rev-list", "--parents", "-n", "1", "HEAD").split(" ").length, 3);
  assert.equal(f.git("diff", "HEAD^", "--name-only", "--", evidence), "");
});
