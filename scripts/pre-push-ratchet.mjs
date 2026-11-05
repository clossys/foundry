#!/usr/bin/env node
/**
 * Pre-push ratchet: a push may not add debt. check:rules and each hook sub-check run twice, once on
 * the head and once on the base (`git merge-base <head> origin/main` unless --base names another),
 * and the push is blocked only by what the head has and the base did not. There is no baseline
 * file: the base revision is the baseline, measured fresh on every push.
 *
 * Both revisions are exported with `git archive`. The base is measured with the head's checks, the
 * accept-unit overlay: the check code files that check:rules and the sub-checks reach (the
 * check:orphan-checks graph) and their npm script definitions are copied from the head onto the
 * base. Data stays each revision's own: the rule registry, its fixtures, the check:studio manifest
 * and the tree under test.
 *
 * Blocks (exit 1) when the head has:
 *   - a check:rules finding (`<kind> <id>`) the base did not have, counted per key, so a second
 *     unenforced rule or a new unmapped sub-check is new even when others already existed;
 *   - any check-integrity finding (shape, unknown-check, unreachable, fixture-*, exemption-*): the
 *     overlay gives the base the head's check code, so a weakened check would read the same on both
 *     sides; these are never debt and block whenever the head has them;
 *   - a sub-check that is red where the base was green, or red on both with output lines the base did
 *     not print (tree paths and durations normalized, digits masked so changed counts compare equal):
 *     a new violation inside existing debt;
 *   - a sub-check that is red on the head because it could not load a module (`loadError`: the
 *     extracted trees hold no gitignored dist/ of their own): the check never measured the head, so it
 *     fails closed as `setup-error` whatever the base did, never as unchanged debt.
 * Unchanged debt and fixed debt pass. Either revision failing to run check:rules is a setup error
 * (exit 2) and blocks too: the ratchet fails closed. The delta is printed either way.
 *
 * Usage: node scripts/pre-push-ratchet.mjs [--base REV] [--head REV | --pushed] [--id <sub-check id>]... [--json]
 * Without --id the hook sub-checks in HOOK_CHECKS run. --pushed is the pre-push hook's mode: it reads
 * git's `<local ref> <local sha> <remote ref> <remote sha>` lines from stdin and ratchets every pushed
 * local sha as a head (a delete, an all-zero local sha, pushes nothing and is skipped), so pushing a
 * branch other than HEAD is measured as that branch. It blocks when any pushed ref blocks.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { commit, extract, gitTop, linkModules, loadError, overlayChecks } from "./accept-unit.mjs";

export const STUDIO_MANIFEST = "packages/producer/scripts/check-studio.json";
/** The fast, server-free check:studio sub-checks that enforce a registered rule on the real tree. */
export const HOOK_CHECKS = Object.freeze([
  "producer check:assemble-only",
  "producer check-no-page-jsx",
  "producer check:studio-map",
  "producer check:studio-template",
  "designer check:provenance",
  "designer check:ref-verbatim",
  "designer check:references",
  "designer check:slot-contracts",
]);
/** check:rules finding kinds about the checks themselves, not about debt in the tree. */
export const INTEGRITY = /^(?:shape|unknown-check|unreachable|fixture-.+|exemption-.+)$/;
const RULES_ENTRY = { dir: ".", script: "check:rules" };

function sh(command, args, cwd) {
  return new Promise(accept => {
    const child = spawn(command, args, { cwd, env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" }, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.on("data", chunk => { stdout += chunk; });
    child.stderr.on("data", chunk => { stderr += chunk; });
    child.on("error", error => accept({ code: 127, stdout, stderr: `${stderr}${error.message}\n` }));
    child.on("close", code => accept({ code: code ?? 1, stdout, stderr }));
  });
}

async function rulesOf(tree) {
  const out = await sh(process.execPath, ["scripts/check-rules.mjs", "--root", tree, "--json"], tree);
  if (out.code === 0 || out.code === 1) {
    try { return { exit: out.code, findings: JSON.parse(out.stdout).findings }; } catch {}
  }
  return { exit: out.code, error: (out.stderr || out.stdout).trim().split("\n").slice(-3).join(" ") || `exit ${out.code}` };
}

/** Output lines with the tree's own location and timings removed, so two trees compare line by line. */
export function normalize(output, tree) {
  const roots = [...new Set([tree, existsSync(tree) ? realpathSync(tree) : tree])].sort((a, b) => b.length - a.length);
  return output.split("\n").map(line => {
    for (const root of roots) line = line.replaceAll(root, "<root>");
    return line.replace(/\b\d+(?:\.\d+)?\s?(?:ms|s)\b/g, "<t>").trimEnd();
  }).filter(Boolean);
}

async function subCheck(tree, check) {
  const out = await sh("/bin/sh", ["-c", check.run], join(tree, check.cwd ?? "."));
  const text = `${out.stdout}\n${out.stderr}`;
  return { exit: out.code, lines: normalize(text, tree), load: out.code === 0 ? undefined : loadError(normalize(text, tree).join("\n")) };
}

const key = finding => `${finding.rule} ${finding.id}`;
function counts(items) {
  const map = new Map();
  for (const item of items) map.set(item, (map.get(item) ?? 0) + 1);
  return map;
}
/** Items of `after` beyond their count in `before` (multiset difference). */
function beyond(after, before) {
  const left = counts(before), out = [];
  for (const item of after) { const n = left.get(item) ?? 0; if (n > 0) left.set(item, n - 1); else out.push(item); }
  return out;
}

/**
 * Lines of `after` beyond `before`, compared with digits masked: a summary whose count changed ("2
 * violations" to "1 violation") is the same line, a finding line the base never printed is new.
 */
const mask = line => line.replace(/\d+/g, "#");
function beyondMasked(after, before) {
  const left = counts(before.map(mask)), out = [];
  for (const line of after) { const n = left.get(mask(line)) ?? 0; if (n > 0) left.set(mask(line), n - 1); else out.push(line); }
  return out;
}

/** The ratchet verdict for two measured revisions. Pure: the tests feed it directly as well. */
export function delta(base, head) {
  const headKeys = head.rules.map(key), baseKeys = base.rules.map(key);
  const integrity = head.rules.filter(finding => INTEGRITY.test(finding.rule));
  const added = head.rules.filter(finding => !INTEGRITY.test(finding.rule));
  const newFindings = beyond(added.map(key), baseKeys).map(k => head.rules.find(finding => key(finding) === k));
  const rules = {
    new: newFindings,
    integrity,
    fixed: beyond(baseKeys, headKeys),
    unchanged: headKeys.length - beyond(headKeys, baseKeys).length,
  };
  const checks = head.checks.map(check => {
    const before = base.checks.find(other => other.id === check.id) ?? { exit: 0, lines: [] };
    if (check.exit !== 0 && check.load) return { id: check.id, base: before.exit, head: check.exit, state: "setup-error", lines: [check.load] };
    const lines = check.exit !== 0 && before.exit !== 0 ? beyondMasked(check.lines, before.lines) : [];
    const state = check.exit === 0 ? (before.exit === 0 ? "green" : "fixed") : before.exit === 0 ? "new-red" : lines.length ? "new-lines" : "unchanged-red";
    return { id: check.id, base: before.exit, head: check.exit, state, lines };
  });
  const block = rules.new.length > 0 || rules.integrity.length > 0 || checks.some(check => check.state === "new-red" || check.state === "new-lines" || check.state === "setup-error");
  return { block, rules, checks };
}

export function report(result) {
  const out = [`pre-push ratchet: base ${result.base.slice(0, 9)} -> head ${result.head.slice(0, 9)}`];
  const { rules, checks } = result.delta;
  out.push(`check:rules: base ${result.baseRules} finding(s), head ${result.headRules}; ${rules.new.length} new, ${rules.integrity.length} check-integrity, ${rules.fixed.length} fixed, ${rules.unchanged} unchanged`);
  for (const finding of rules.new) out.push(`  NEW ${finding.rule}\t${finding.id}\t${finding.message}`);
  for (const finding of rules.integrity) out.push(`  INTEGRITY ${finding.rule}\t${finding.id}\t${finding.message}`);
  for (const fixed of rules.fixed) out.push(`  fixed ${fixed}`);
  for (const check of checks) {
    out.push(`${check.state.padEnd(13)} ${check.id}: base exit ${check.base}, head exit ${check.head}`);
    for (const line of check.lines.slice(0, 20)) out.push(`  ${check.state === "setup-error" ? "LOAD" : "NEW"} ${line}`);
    if (check.lines.length > 20) out.push(`  ... ${check.lines.length - 20} more new line(s)`);
  }
  out.push(result.delta.block ? "BLOCKED: the head adds debt the base did not have" : "PASS: no new findings, failing rules or red checks");
  return out.join("\n");
}

function mergeBase(repo, head) {
  return new Promise((accept, reject) => {
    const child = spawn("git", ["merge-base", head, "origin/main"], { cwd: repo });
    let stdout = "";
    child.stdout.on("data", chunk => { stdout += chunk; });
    child.on("close", code => code === 0 ? accept(stdout.trim()) : reject(new Error(`no merge base between ${head} and origin/main; pass --base`)));
  });
}

const OID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
/**
 * The refs a pre-push hook receives on stdin, one `<local ref> <local sha> <remote ref> <remote sha>`
 * line each. Deletes (an all-zero local sha) push no commit and are dropped; an unreadable line throws,
 * so the hook fails closed rather than measuring nothing.
 */
export function pushedRefs(text) {
  return String(text ?? "").split("\n").map(line => line.trim()).filter(Boolean).map(line => {
    const [localRef, localSha, remoteRef, remoteSha, extra] = line.split(/\s+/);
    if (extra !== undefined || !localRef || !remoteRef || !OID.test(localSha ?? "") || !OID.test(remoteSha ?? "")) throw new Error(`unreadable pre-push line: ${JSON.stringify(line)}`);
    return { localRef, localSha, remoteRef, remoteSha };
  }).filter(ref => !/^0+$/.test(ref.localSha));
}

export async function ratchet({ cwd = process.cwd(), base, head = "HEAD", ids = HOOK_CHECKS } = {}) {
  const repo = gitTop(cwd);
  const headSha = commit(repo, head), baseSha = commit(repo, base ?? await mergeBase(repo, headSha));
  // The real path: the slot model refuses a tree reached through a symlinked temp root (/var -> /private/var).
  const work = realpathSync(mkdtempSync(join(tmpdir(), "pre-push-ratchet-")));
  const baseTree = join(work, "base"), headTree = join(work, "head");
  extract(repo, baseSha, baseTree);
  extract(repo, headSha, headTree);
  const manifest = join(headTree, STUDIO_MANIFEST);
  const known = existsSync(manifest) ? JSON.parse(readFileSync(manifest, "utf8")).checks ?? [] : [];
  const checks = ids.map(id => {
    const check = known.find(entry => entry.id === id);
    if (!check) throw new Error(`no check:studio sub-check ${JSON.stringify(id)} at head`);
    return check;
  });
  const overlaid = await overlayChecks(headTree, baseTree, [RULES_ENTRY, ...checks.map(check => ({ cwd: check.cwd ?? ".", run: check.run }))]);
  linkModules(repo, baseTree);
  linkModules(repo, headTree);
  const [baseRules, headRules] = await Promise.all([rulesOf(baseTree), rulesOf(headTree)]);
  for (const [name, side] of [["base", baseRules], ["head", headRules]]) {
    if (side.error) throw Object.assign(new Error(`check:rules could not run on the ${name} (${name === "base" ? baseSha : headSha}): ${side.error}`), { work });
  }
  const measured = { base: [], head: [] };
  for (const check of checks) {
    const [b, h] = await Promise.all([subCheck(baseTree, check), subCheck(headTree, check)]);
    measured.base.push({ id: check.id, ...b });
    measured.head.push({ id: check.id, ...h });
  }
  const result = delta({ rules: baseRules.findings, checks: measured.base }, { rules: headRules.findings, checks: measured.head });
  return { base: baseSha, head: headSha, work, overlaid, baseRules: baseRules.findings.length, headRules: headRules.findings.length, delta: result };
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const options = { ids: [] };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--base" || arg === "--head") options[arg.slice(2)] = args[++i];
    else if (arg === "--id") options.ids.push(args[++i]);
    else if (arg === "--json") options.json = true;
    else if (arg === "--pushed") options.pushed = true;
    else { console.error(`usage: node scripts/pre-push-ratchet.mjs [--base REV] [--head REV | --pushed] [--id <sub-check id>]... [--json]\nunknown argument: ${arg}`); process.exit(2); }
  }
  if (!options.ids.length) options.ids = [...HOOK_CHECKS];
  if (options.pushed && options.head) { console.error("pre-push ratchet: --pushed reads the heads from stdin; do not also pass --head"); process.exit(2); }
  try {
    if (options.pushed) {
      const refs = pushedRefs(readFileSync(0, "utf8"));
      if (!refs.length) { console.log("pre-push ratchet: no pushed commits to measure (nothing pushed, or deletes only)"); process.exit(0); }
      const results = [];
      for (const ref of refs) {
        const result = await ratchet({ ...options, head: ref.localSha });
        results.push({ ...ref, ...result });
        if (!options.json) console.log(`pre-push ratchet: ${ref.localRef} -> ${ref.remoteRef}\n${report(result)}`);
      }
      if (options.json) console.log(JSON.stringify(results, null, 2));
      process.exit(results.some(result => result.delta.block) ? 1 : 0);
    }
    const result = await ratchet(options);
    console.log(options.json ? JSON.stringify(result, null, 2) : report(result));
    process.exit(result.delta.block ? 1 : 0);
  } catch (error) {
    console.error(`pre-push ratchet could not run, so the push is blocked: ${error.message}${error.work ? ` (trees in ${error.work})` : ""}`);
    process.exit(2);
  }
}
