// The batched history index must give exactly the answers the per-record
// `git` commands give, on a fixture whose shapes exercise every rule the
// index reproduces: pass-through merges, a rewriting side branch, delete and
// re-add, a mode-only change, an identical add on both sides of a merge, a
// root-commit record, an octopus merge, a path that later becomes a
// directory, and ranges whose merges have irrelevant (uninteresting,
// non-bottom) parents.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import {
  assertAncestor,
  buildGitHistoryIndex,
  commitParentLine,
  pathBlobOid,
  pathContent,
  pathHasHistory,
  pathIntroductions,
  pathRangeTouches,
  withGitHistoryIndex,
} from "./git-history-index.mjs";

const REC = "governance/records/rec.json";
const OTHER = "governance/records/other.json";
const ROOTREC = "governance/root.json";
const BECOMES_DIR = "governance/records/later-dir";
const PATHS = [REC, OTHER, ROOTREC, BECOMES_DIR, `${BECOMES_DIR}/inner.json`, "governance/records/never.json"];

function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "git-history-index-")));
  const env = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
  let tick = 0;
  const git = (...args) => {
    tick += 1;
    const date = `2026-01-01T00:${String(Math.floor(tick / 60)).padStart(2, "0")}:${String(tick % 60).padStart(2, "0")}Z`;
    return execFileSync("git", args, { cwd: root, encoding: "utf8", env: { ...env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } }).trim();
  };
  const write = (path, text) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), text); };
  const commit = (message) => { git("add", "-A"); git("commit", "-q", "--allow-empty", "-m", message); return git("rev-parse", "HEAD"); };
  const tree = () => git("write-tree");
  const craft = (message, treeId, ...parents) => git("commit-tree", treeId, ...parents.flatMap((p) => ["-p", p]), "-m", message);

  git("init", "-q", "-b", "main", ".");
  git("config", "core.autocrlf", "false");
  git("config", "commit.gpgsign", "false");
  git("config", "core.hooksPath", "/dev/null");
  write(ROOTREC, "root\n");
  write("README", "r\n");
  const r0 = commit("root with record");
  // A branch forked BEFORE the record exists, merged back later (pass-through).
  git("checkout", "-q", "-b", "early");
  write("early.txt", "e\n");
  const early = commit("early side work");
  git("checkout", "-q", "main");
  write(REC, "v1\n");
  const intro = commit("introduce record");
  write("a.txt", "a\n");
  const a1 = commit("unrelated");
  git("merge", "-q", "--no-edit", "early");
  const passThrough = git("rev-parse", "HEAD");
  // A side branch that rewrites the record, merged with the rewrite kept.
  git("checkout", "-q", "-b", "rewrite", a1);
  write(REC, "v2\n");
  const rewrite = commit("rewrite record");
  git("checkout", "-q", "main");
  git("merge", "-q", "--no-edit", "-X", "theirs", "rewrite");
  const rewriteMerge = git("rev-parse", "HEAD");
  // Mode-only change.
  chmodSync(join(root, REC), 0o755);
  const modeChange = commit("mode change");
  // Delete and re-add.
  rmSync(join(root, OTHER), { force: true });
  write(OTHER, "o1\n");
  commit("add other");
  rmSync(join(root, OTHER));
  commit("delete other");
  write(OTHER, "o2\n");
  const readd = commit("re-add other");
  // Identical add on both sides of a merge.
  git("checkout", "-q", "-b", "both");
  write("governance/records/both.json", "same\n");
  commit("add both (side)");
  git("checkout", "-q", "main");
  write("governance/records/both.json", "same\n");
  commit("add both (main)");
  git("merge", "-q", "--no-edit", "both");
  // Octopus merge of three branches touching different paths.
  const octoBase = git("rev-parse", "HEAD");
  for (const name of ["o1", "o2", "o3"]) {
    git("checkout", "-q", "-b", name, octoBase);
    write(`governance/records/${name}.json`, `${name}\n`);
    commit(`octopus leg ${name}`);
  }
  git("checkout", "-q", "main");
  git("merge", "-q", "--no-edit", "o1", "o2", "o3");
  // A path that is a file, then a directory.
  write(BECOMES_DIR, "file\n");
  commit("later-dir as a file");
  rmSync(join(root, BECOMES_DIR));
  write(`${BECOMES_DIR}/inner.json`, "inner\n");
  const dirCommit = commit("later-dir as a directory");
  // Crafted merges whose parents are uninteresting for a range bottom of
  // `bottom`: `pa` is reachable from `bottom` but is not `bottom` itself.
  write(REC, "v3\n");
  const pa = commit("record v3");
  write(REC, "v4\n");
  const bottom = commit("record v4 (range bottom)");
  write("c.txt", "c\n");
  const c = commit("after bottom");
  // Same as the relevant parent c, differs from the irrelevant parent pa.
  const irrelevantDiffers = craft("merge with irrelevant differing parent", tree(), c, pa);
  // Every parent irrelevant: a merge of two ancestors of the bottom.
  git("checkout", "-q", pa);
  write(REC, "v5\n");
  git("add", "-A");
  const allIrrelevant = craft("merge of two uninteresting parents", tree(), pa, intro);
  git("checkout", "-q", "-f", "main");
  git("reset", "-q", "--hard", irrelevantDiffers);
  git("merge", "-q", "--no-edit", "-X", "ours", allIrrelevant);
  // Bottom itself as a merge parent (relevant) with a differing record.
  write(REC, "v6\n");
  commit("record v6");
  const tip = craft("merge with bottom as parent", tree(), git("rev-parse", "HEAD"), bottom);
  git("reset", "-q", "--hard", tip);
  write(REC, "v7\n");
  commit("final touch");
  return { root, git, named: { r0, early, intro, a1, passThrough, rewrite, rewriteMerge, modeChange, readd, dirCommit, pa, bottom, c, irrelevantDiffers, allIrrelevant, tip } };
}

const lines = (text) => text.split("\n").filter(Boolean);
const sorted = (list) => [...list].sort();

test("the batched index answers exactly what each per-record git command answers", () => {
  const { root, git } = fixture();
  try {
    const index = buildGitHistoryIndex(root);
    const commits = lines(git("rev-list", "HEAD"));
    assert.equal(index.size, commits.length, "index holds every commit reachable from HEAD");
    assert.equal(index.head, git("rev-parse", "HEAD"));
    for (const commit of commits) {
      assert.deepEqual(index.parents(commit), git("rev-list", "--parents", "-n", "1", commit).split(" ").slice(1), `parents of ${commit}`);
    }
    for (const b of commits) {
      const ancestors = new Set(lines(git("rev-list", b)));
      for (const a of commits) assert.equal(index.isAncestor(a, b), ancestors.has(a), `ancestry ${a} ${b}`);
    }
    const blobs = new Map(commits.map((commit) => [commit, new Map(lines(git("ls-tree", "-r", "--full-tree", commit)).map((line) => {
      const tab = line.indexOf("\t");
      return [line.slice(tab + 1), line.slice(0, tab).split(" ")[2]];
    }))]));
    let covered = 0;
    for (const path of PATHS) {
      if (!index.covers(path)) continue;
      covered += 1;
      assert.deepEqual(sorted(index.introductions(path)), sorted(lines(git("log", "--full-history", "--diff-filter=A", "--format=%H", "HEAD", "--", path))), `introductions ${path}`);
      for (const commit of commits) {
        assert.equal(index.blobOid(commit, path), blobs.get(commit).get(path) ?? null, `blob ${commit}:${path}`);
        assert.equal(index.hasPathHistory(commit, path), git("log", "--full-history", "-1", "--format=%H", commit, "--", path) !== "", `history ${commit} ${path}`);
        assert.deepEqual(sorted(index.rangeTouches(commit, path)), sorted(lines(git("rev-list", "--full-history", `${commit}..HEAD`, "--", path))), `range ${commit}..HEAD ${path}`);
      }
    }
    assert.ok(covered >= 4, "the fixture exercises covered paths");
    assert.equal(index.covers(BECOMES_DIR), false, "a path that is ever a directory falls back to git");
    assert.equal(index.covers("governance/records/*.json"), false, "a glob pathspec falls back to git");
    assert.equal(index.covers("README"), false, "a path outside the scope falls back to git");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the scoped helpers return the same answers with and without the index", () => {
  const { root, git, named } = fixture();
  try {
    const head = git("rev-parse", "HEAD");
    const subset = Object.fromEntries(["r0", "early", "intro", "rewrite", "rewriteMerge", "pa", "bottom", "allIrrelevant", "tip"].map((name) => [name, named[name]]));
    const ask = () => {
      const out = {};
      for (const path of PATHS) {
        out[`intro ${path}`] = sorted(pathIntroductions(root, "HEAD", path));
        out[`intro@sha ${path}`] = sorted(pathIntroductions(root, head, path));
        for (const [name, commit] of Object.entries(subset)) {
          out[`log ${name} ${path}`] = sorted(pathRangeTouches(root, commit, "HEAD", path));
          out[`rev-list ${name} ${path}`] = sorted(pathRangeTouches(root, commit, "HEAD", path, { command: "rev-list" }));
          out[`has ${name} ${path}`] = pathHasHistory(root, commit, path);
          out[`blob ${name} ${path}`] = pathBlobOid(root, commit, path);
          try { out[`show ${name} ${path}`] = pathContent(root, commit, path); }
          catch (error) { out[`show ${name} ${path}`] = `error ${error.status}: ${error.message}`; }
        }
      }
      for (const [name, commit] of Object.entries(subset)) {
        out[`parents ${name}`] = commitParentLine(root, commit);
        for (const [other, descendant] of Object.entries(subset)) {
          try { assertAncestor(root, commit, descendant); out[`anc ${name} ${other}`] = true; }
          catch (error) { out[`anc ${name} ${other}`] = error.message; }
        }
      }
      return out;
    };
    const direct = ask();
    let built = 0;
    const indexed = withGitHistoryIndex(root, ask, { build: (dir) => { built += 1; return buildGitHistoryIndex(dir); } });
    assert.equal(built, 1, "one history read serves the whole scope");
    assert.deepEqual(indexed, direct);
    // An index that cannot be built falls back to the per-record commands.
    const unavailable = withGitHistoryIndex(root, ask, { build: () => { throw new Error("no index"); } });
    assert.deepEqual(unavailable, direct);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
