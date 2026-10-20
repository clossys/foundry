#!/usr/bin/env node
// Coordinate the existing generators after Git has completed the source merge.
// A pre-merge hook cannot do this: Git has already cached its commit tree.
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";

const css = [
  "packages/designer/styles/compiled.css",
  "packages/designer/styles/utilities.css",
  "packages/publisher/styles/preview.css",
];
const evidence = "packages/publisher/src/core/web-role-pair-evidence.ts";
const evidenceTest = "src/core/web-role-pair-evidence.test.tsx";
const outputs = [...css, evidence];
const driver = "node scripts/generated-merge.mjs driver %O %A %B %P";
const alias = "!node scripts/generated-merge.mjs merge";
const git = (...args) => execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const configured = key => {
  const result = spawnSync("git", ["config", "--get", key], { encoding: "utf8" });
  if (result.status === 1) return "";
  if (result.status !== 0) throw new Error(`Cannot read Git setting ${key}.`);
  return result.stdout.trim();
};
const run = (bin, args, env = process.env) => {
  console.log(`${bin} ${args.join(" ")}`);
  const result = spawnSync(bin, args, { env, stdio: ["ignore", "inherit", "inherit"] });
  if (result.error || result.status !== 0) throw new Error(`${bin} ${args.join(" ")} failed (exit ${result.status ?? "unknown"}).`);
};
function generateCss() {
  run("npm", ["run", "generate:compiled-css", "--workspace=packages/designer"]);
  run("npm", ["run", "generate:preview-css", "--workspace=packages/publisher"]);
}
function refreshEvidence() {
  const source = readFileSync(evidence, "utf8");
  const revision = source.match(/const revision = "([a-f0-9]{40})";/)?.[1];
  const data = source.match(/const sources = (\{[\s\S]*?\n\}) as const;/)?.[1];
  if (!revision || !data) throw new Error("Unrecognized role-pair evidence format; refresh it explicitly.");
  const pins = JSON.parse(data);
  const digest = value => `sha256:${createHash("sha256").update(value).digest("hex")}`;
  const stale = Object.entries(pins).some(([path, pin]) => digest(readFileSync(`packages/publisher/${path}`)) !== pin);
  const testChanged = digest(readFileSync(`packages/publisher/${evidenceTest}`)) !== digest(execFileSync("git", ["show", `${revision}:packages/publisher/${evidenceTest}`]));
  if (stale || testChanged) {
    // The existing measurer deliberately requires a committed source snapshot.
    // Never invent an unreachable revision or move HEAD temporarily to satisfy it.
    const changed = git("diff", "HEAD", "--name-only", "--", ...Object.keys(pins).map(path => `packages/publisher/${path}`), `packages/publisher/${evidenceTest}`);
    if (changed) throw new Error("Commit the measured sources before refreshing role-pair evidence.");
    run("npm", ["test", "--workspace=packages/publisher", "--", evidenceTest, "-t", "regenerates retained role-pair measurements on explicit request"], { ...process.env, UPDATE_WEB_ROLE_PAIR_EVIDENCE: "1" });
  }
  // The update hook is not the clearance: re-measure all three pairs afterward.
  run("npm", ["test", "--workspace=packages/publisher", "--", evidenceTest]);
}
function setup() {
  for (const [key, desired] of [["merge.foundry-generated.driver", driver], ["alias.merge-generated", alias]]) {
    const current = configured(key);
    if (current && current !== desired) throw new Error(`Refusing to replace an existing merge driver or alias (${key}).`);
  }
  for (const path of outputs) {
    const attribute = git("check-attr", "merge", "--", path).split(": ").at(-1);
    if (attribute !== "unspecified" && attribute !== "foundry-generated") throw new Error(`Refusing to replace an existing merge attribute for ${path}.`);
  }
  const attributes = resolve(git("rev-parse", "--git-path", "info/attributes"));
  const before = existsSync(attributes) ? readFileSync(attributes, "utf8") : "";
  const additions = outputs.map(path => `${path} merge=foundry-generated`).filter(line => !before.split("\n").includes(line));
  mkdirSync(dirname(attributes), { recursive: true });
  if (additions.length) writeFileSync(attributes, before + (before && !before.endsWith("\n") ? "\n" : "") + additions.join("\n") + "\n");
  git("config", "--local", "merge.foundry-generated.driver", driver);
  git("config", "--local", "alias.merge-generated", alias);
  console.log("Generated merge setup installed for this clone and its linked worktrees; existing hooks are unchanged.");
}
// Only these four measured fields may defer to regeneration. Everything else in
// the evidence module is authored code and receives an ordinary three-way merge.
const fields = [/const revision = "[a-f0-9]{40}";/g, /const measuredAt = "\d{4}-\d{2}-\d{2}";/g, /const sources = \{[\s\S]*?\n\} as const;/g, /fixtureDigest: "sha256:[a-f0-9]{64}"/g];
function normalize(source) {
  if (source.includes("/* generated-field-")) throw new Error("Evidence contains a reserved merge placeholder; review the conflict explicitly.");
  const values = [];
  for (const [index, pattern] of fields.entries()) {
    const matches = [...source.matchAll(pattern)];
    if (matches.length !== 1) throw new Error("Unrecognized evidence field; leave the conflict for review.");
    values.push(matches[0][0]);
    source = source.replace(pattern, `/* generated-field-${index} */`);
  }
  return { source, values };
}
function mergeDriver() {
  const [base, ours, theirs, path] = process.argv.slice(3);
  if (!outputs.includes(path)) throw new Error("This driver only handles the declared generated outputs.");
  if (process.env.FOUNDRY_GENERATED_MERGE !== "1" || !existsSync(git("rev-parse", "--git-path", "foundry-generated-merge-active"))) throw new Error("Use git merge-generated <ref> so regeneration finishes before committing.");
  if (path !== evidence) return; // %A is provisional; the wrapper replaces it.
  const originals = [base, ours, theirs].map(file => normalize(readFileSync(file, "utf8")));
  const scratch = mkdtempSync(resolve(tmpdir(), "generated-evidence-"));
  try {
    const files = ["base", "ours", "theirs"].map(name => resolve(scratch, name));
    for (const [index, file] of files.entries()) writeFileSync(file, originals[index].source);
    const result = spawnSync("git", ["merge-file", "-p", files[1], files[0], files[2]], { encoding: "utf8" });
    if (result.error || result.status === null || result.status > 127) throw new Error("Cannot merge authored role-pair evidence code.");
    let merged = result.stdout;
    for (const [index, value] of originals[1].values.entries()) merged = merged.replaceAll(`/* generated-field-${index} */`, value);
    writeFileSync(ours, merged);
    if (result.status !== 0) throw new Error("Authored role-pair evidence conflict requires review.");
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}
function assertOnlyGeneratedChanges() {
  const changed = git("diff", "--name-only", "-z").split("\0").filter(Boolean);
  if (changed.some(path => !outputs.includes(path))) throw new Error("Generation changed a path outside the generated allowlist; nothing was staged.");
}
function merge(ref) {
  const continuing = ref === "--continue";
  if (!ref || ref.startsWith("-") && !continuing || process.argv.length !== 4) throw new Error("Usage: git merge-generated <ref>|--continue");
  const merging = () => existsSync(git("rev-parse", "--git-path", "MERGE_HEAD"));
  if (!continuing && git("status", "--porcelain", "--untracked-files=normal")) throw new Error("Generated merge requires a clean worktree and index; preserve your changes first.");
  if (!continuing && merging()) throw new Error("An existing merge must be finished or aborted first.");
  if (continuing) {
    if (git("ls-files", "-u")) throw new Error("Resolve and stage the source conflicts before continuing.");
    assertOnlyGeneratedChanges();
    if (!merging() && git("diff", "--cached", "--name-only")) throw new Error("Evidence continuation requires an otherwise clean index.");
    if (git("ls-files", "--others", "--exclude-standard", "--", "packages/designer/src", "packages/publisher/src")) throw new Error("Move untracked source files before continuing.");
  }
  const target = continuing ? null : git("rev-parse", "--verify", `${ref}^{commit}`);
  const active = git("rev-parse", "--git-path", "foundry-generated-merge-active");
  writeFileSync(active, "active\n", { flag: "wx" });
  try {
    if (!continuing) {
      run("git", ["merge", "--no-ff", "--no-commit", target], { ...process.env, FOUNDRY_GENERATED_MERGE: "1" });
      if (!merging()) return;
    }
    if (merging()) {
      generateCss();
      assertOnlyGeneratedChanges();
      git("add", "--", ...css);
      run("git", ["commit", "--no-edit"]);
    }
    // This second ordinary commit is needed only when the combined source
    // snapshot needs fresh evidence. It preserves all existing commit hooks.
    refreshEvidence();
    assertOnlyGeneratedChanges();
    if (git("diff", "--name-only", "--", evidence)) {
      git("add", "--", evidence);
      run("git", ["commit", "-m", "Refresh web role-pair evidence after source merge"]);
    }
  } finally {
    unlinkSync(active);
  }
}
try {
  switch (process.argv[2]) {
    case "setup": setup(); break;
    case "generate": generateCss(); refreshEvidence(); break;
    case "driver": mergeDriver(); break;
    case "merge": merge(process.argv[3]); break;
    default: throw new Error("Usage: node scripts/generated-merge.mjs setup|generate|merge <ref>");
  }
} catch (error) {
  console.error(`Generated merge: ${error.message}`);
  process.exitCode = 1;
}
