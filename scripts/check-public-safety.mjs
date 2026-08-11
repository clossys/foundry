#!/usr/bin/env node
// check-public-safety — refuse to publish anything carrying private identity.
//
//   node scripts/check-public-safety.mjs <dir> [options]
//
//     --require-denylist   fail (exit 2) rather than degrade to a partial scan
//     --allow-changelogs   permit CHANGELOG.md (see FORBIDDEN_NAMES)
//     --denylist <file>    explicit denylist path
//     --json               machine-readable output
//
// Exit 0 = safe to publish. Exit 1 = findings. Exit 2 = the gate could not run.
//
// The matcher is deliberately dumb and the rules deliberately broad: this gate
// is cheap to satisfy and expensive to bypass, which is the correct asymmetry
// when the failure mode — public disclosure — is irreversible.
//
// WHY THE DENYLIST IS NOT IN THIS FILE
// -----------------------------------
// A denylist names, in plaintext, exactly the things that must never be public.
// Committing it to a public repository publishes the secret it exists to keep:
// anyone could read off the client names, the retired identity, and the
// collaborator handles, and GitHub code search would index them. So the terms
// live outside the repository and are loaded at run time, from exactly one of:
//
//   1. --denylist <file>
//   2. $PUBLIC_SAFETY_DENYLIST                  (CI writes a secret to a temp file)
//
// There is deliberately no generic on-disk default (e.g.
// ~/.config/public-safety/denylist.json). A machine that also works with
// another repository's denylist would silently load THAT file here — same
// filename, wrong terms — and report a confident FULL-mode pass that never
// actually checked this repo's real identity terms at all. That is worse than
// PARTIAL mode, which is at least honest about what it skipped. So neither
// source present is treated exactly like a denylist that fails to parse: it
// falls through to PARTIAL mode below, same as any other unreadable file.
//
// With no denylist the gate runs in PARTIAL mode: secrets, forbidden files and
// generic structural rules still apply, but identity checks are skipped. That
// keeps the check useful on pull requests from forks, which cannot read secrets.
// Partial mode is never silent, and --require-denylist turns it into a hard
// failure — the publish path uses that flag so a release can never slip through
// on a degraded scan.

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative, basename, extname, resolve, sep } from "node:path";
import { execFileSync } from "node:child_process";

const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith("--")));
const positional = argv.filter((a) => !a.startsWith("--"));
const root = positional[0];

if (!root) {
  console.error("usage: check-public-safety.mjs <dir> [--require-denylist] [--allow-changelogs] [--json]");
  process.exit(2);
}
if (!existsSync(root)) {
  console.error(`check-public-safety: no such directory: ${root}`);
  process.exit(2);
}

function flagValue(name) {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

// ---------------------------------------------------------------- rule tables

// Never ship, regardless of content. Agent instructions describe internal
// layout; changelogs cite internal PRs and repositories. Measured on a staged
// tree of the candidate packages, excluding these plus dist/ took the scan from
// 138 files / 175 findings down to 58 / 25 — the single largest contamination
// source by a wide margin.
// CHANGELOG.md is on this list for the IMPORT direction: an upstream changelog
// cites internal pull requests, repositories and people, and is one of the
// densest identity carriers measured. A changelog written fresh in this
// repository is ordinary open-source furniture, so --allow-changelogs drops it
// from the list and leans on content scanning instead — which is the correct
// control once the file is authored here rather than copied in.
const FORBIDDEN_NAMES = [
  "CLAUDE.md",
  "AGENTS.md",
  ...(flags.has("--allow-changelogs") ? [] : ["CHANGELOG.md"]),
  ".claude",
  ".codex",
  "CASCADE-OVERRIDES.json",
  "CONSUMPTION.json",
  "RECIPIENTS.json",
  ".npmrc",
  ".env",
  ".env.local",
  ".env.production",
  "id_rsa",
  "id_ed25519",
];

// Matched case-insensitively below (see the walk loop): a rule meant to apply
// "never, regardless of content" must not be bypassable by naming the file
// Claude.md, the directory .Claude/, or DIST/ — nobody defends a forbidden
// name by changing its capitalisation, same reasoning as the identity terms.
const FORBIDDEN_NAMES_LC = new Set(FORBIDDEN_NAMES.map((n) => n.toLowerCase()));

// Build output is never copied in by hand: it is compiled against the private
// monorepo and embeds resolved internal paths and package names.
//
// In --artifact mode the input is an EXTRACTED TARBALL rather than a repository
// tree, and there `dist/` is not a defect — it is the thing being shipped. So
// the rule inverts: instead of refusing the directory outright (and `continue`-ing
// past its contents, which is what makes tree mode blind to it), artifact mode
// scans every file in it. `.next/`, `coverage/` and `.turbo/` are still never
// legitimate tarball contents and stay forbidden in both modes.
const FORBIDDEN_DIRS = ["dist", "build", ".next", "coverage", ".turbo"];
const FORBIDDEN_DIRS_LC = new Set(FORBIDDEN_DIRS.map((d) => d.toLowerCase()));
const ARTIFACT_ALLOWED_DIRS = new Set(["dist", "build"]);

// Paths, relative to the scan root, that may hold an otherwise-forbidden name.
// The workspace validator requires paired agent loaders at every canonical
// repository root, so these root files are purpose-written for this public repo
// and content-scanned like everything else. The exemptions are exact paths;
// nested agent instructions are still refused.
const FORBIDDEN_EXEMPT_PATHS = new Set(["AGENTS.md", "CLAUDE.md"]);

// Extensions never scanned for identity prose (secrets scanning is likewise
// meaningless on binary pixel/audio/video/font data). Kept small and each
// group justified below — none of these can carry a hidden text file inside
// them the way an archive can, so skipping is a real "nothing here to scan",
// not a convenient shortcut.
const SKIP_CONTENT = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".avif", // raster images: pixel data only
  ".woff", ".woff2", ".ttf", ".otf", ".eot", // font binaries
  ".mp4", ".webm", // video containers
  ".wasm", // compiled binary, not source
  ".pdf", // scanned for secrets/binary marker like the rest; not a container the way an archive is
]);

// Archives are deliberately NOT in SKIP_CONTENT. A .zip (or a gzip-wrapped
// tar) can carry an arbitrary text file inside it — a copied CLAUDE.md, a
// stray .env, an identity-bearing README — that this gate would otherwise
// never open, silently passing exactly the kind of contamination it exists
// to catch. Rather than skip them like the true binaries above, refuse them
// outright: the safe default when the gate cannot see inside a container is
// to treat it as unsafe, not to assume it's clean.
const ARCHIVE_EXTENSIONS = new Set([".zip", ".gz", ".tgz"]);

// Credential-shaped strings. A cheap backstop, not a substitute for gitleaks
// over full history — which catches what a working tree no longer shows.
const SECRETISH = [
  ["sk-ant-[A-Za-z0-9_-]{16,}", "Anthropic API key"],
  ["sk-[A-Za-z0-9]{20,}", "OpenAI-style key"],
  ["sk_live_[A-Za-z0-9]{8,}", "Stripe live key"],
  ["rk_live_[A-Za-z0-9]{8,}", "Stripe restricted live key"],
  ["whsec_[A-Za-z0-9]{16,}", "Stripe webhook secret"],
  ["ghp_[A-Za-z0-9]{20,}", "GitHub PAT"],
  ["gho_[A-Za-z0-9]{20,}", "GitHub OAuth token"],
  ["github_pat_[A-Za-z0-9_]{20,}", "GitHub fine-grained PAT"],
  ["npm_[A-Za-z0-9]{30,}", "npm access token"],
  ["xox[baprs]-[A-Za-z0-9-]{10,}", "Slack token"],
  ["hooks\\.slack\\.com/services/[A-Za-z0-9/]+", "Slack webhook"],
  ["AKIA[0-9A-Z]{16}", "AWS access key id"],
  ["AIza[0-9A-Za-z_-]{35}", "Google API key"],
  ["sk_test_[A-Za-z0-9]{8,}", "Stripe test key"],
  ["-----BEGIN [A-Z ]*PRIVATE KEY-----", "private key"],
  // The character class after :// must start with an actual host character.
  // Without that, this pattern matches its own source line — and, worse, any
  // documentation that mentions a connection-string scheme.
  ["(postgres(ql)?|mysql|mongodb(\\+srv)?|redis)://[A-Za-z0-9][^\\s\"'`]*", "database URL"],
  ["eyJ[A-Za-z0-9_-]{20,}\\.[A-Za-z0-9_-]{20,}\\.[A-Za-z0-9_-]+", "JWT"],
];

// ------------------------------------------------------------ denylist loading

// No third, silent fallback here on purpose — see "WHY THE DENYLIST IS NOT IN
// THIS FILE" above. Either explicit source is fine; neither is fine too, and
// just means PARTIAL mode.
const denylistPath = flagValue("--denylist") ?? process.env.PUBLIC_SAFETY_DENYLIST ?? null;

let denylist = null;
let denylistError = null;
if (!denylistPath) {
  denylistError = "no --denylist flag and $PUBLIC_SAFETY_DENYLIST is unset";
} else {
  try {
    const parsed = JSON.parse(readFileSync(denylistPath, "utf8"));
    if (!Array.isArray(parsed.terms) || parsed.terms.length === 0) {
      throw new Error("denylist has no terms");
    }
    denylist = parsed;
  } catch (error) {
    denylistError = error.code === "ENOENT" ? "not found" : error.message;
  }
}

const mode = denylist ? "FULL" : "PARTIAL";

if (!denylist && flags.has("--require-denylist")) {
  console.error(
    `check-public-safety: FULL mode required but the denylist could not be loaded (${denylistError}).\n` +
      `  looked at: ${denylistPath ?? "(nothing — no --denylist flag and $PUBLIC_SAFETY_DENYLIST is unset)"}\n` +
      `  set --denylist <file> or $PUBLIC_SAFETY_DENYLIST.\n` +
      `  Refusing to report a pass from a degraded scan.`,
  );
  process.exit(2);
}

// Zero-width/invisible Unicode characters render identically to a human
// reader but break a literal or regex match if inserted mid-term — the
// classic bypass being a denylisted name with one of these slipped between
// two of its characters. ZWSP/ZWNJ/ZWJ/word-joiner/soft-hyphen/BOM are the
// ones with no legitimate reason to appear in this repository's own prose or
// source, so stripping them unconditionally (see stripInvisible, applied to
// every scanned file's contents before any pattern runs) is pure hardening.
const ZERO_WIDTH_RE = /[\u200B\u200C\u200D\u2060\u180E\u00AD\uFEFF]/g;
function stripInvisible(text) {
  return text.replace(ZERO_WIDTH_RE, "");
}

/**
 * npm lockfile integrity values are opaque, deterministic hashes rather than
 * publishable prose or package metadata. Scanning their base64 payloads for
 * identity terms creates irreproducible false positives without increasing
 * disclosure protection. Keep the field and all other lockfile content in
 * scope; replace only the hash payload before identity matching.
 */
function normalizeOpaqueLockIntegrity(text, rel) {
  if (rel !== "package-lock.json") return text;
  return text.replace(/^(\s*"integrity"\s*:\s*")[^"]*("\s*,?\s*)$/gm, "$1<opaque-lock-integrity>$2");
}

const secretRes = SECRETISH.map(([p, why]) => [new RegExp(p, "g"), why]);
// Terms are matched case-insensitively by default, which is right for a name or
// a domain: nobody defends an identity by changing its capitalisation.
//
// `caseSensitive: true` exists for the opposite case — a SHORT term, typically
// an acronym, where the correct fix for word-boundary blindness is to drop the
// boundary anchor and match the term embedded in a longer token. Unanchored AND
// case-insensitive, a three-letter sequence hits constantly inside minified
// bundles, hashes and base64 blobs; the noise then trains everyone to ignore the
// gate, which is worse than the gap it closed. Matching the acronym in its real
// capitalisation keeps it unanchored without that cost.
const denyRes = (denylist?.terms ?? []).map((t) => [
  new RegExp(t.pattern, t.caseSensitive ? "g" : "gi"),
  t.why,
  t.severity ?? "high",
]);
// Deliberately NOT a line-level allow-list. An allowed line would be skipped
// wholesale, so anything sharing a line with a sanctioned string would ride
// through unscanned. Instead each pattern's own match is redacted out of the
// line and whatever remains is still scanned in full.
//
// An entry may optionally carry `paths`: an array of repo-relative paths (or
// path prefixes) where it applies. Omitted `paths` means global — reserve
// that for narrow, single-purpose patterns (an exact author string, an exact
// repo URL). A scope or org name mentioned in prose needs the opposite shape:
// a broader pattern confined to the handful of files that are actually
// documenting the decision, so the same string anywhere else still fails.
const neutralizeRules = (denylist?.neutralize ?? []).map((a) => ({
  re: new RegExp(a.pattern, "gi"),
  paths: a.paths ?? null,
}));

// --------------------------------------------------------------------- walking

// Files git ignores cannot reach the remote, so scanning them reports problems
// that do not exist — a locally-built dist/ being the obvious one. Skipping
// them is safe in the direction that matters: an ignored file is not published
// by `git push`, and the tarball's contents are separately proven by
// `npm pack --dry-run` in the publish workflow. Pass --no-gitignore to scan
// everything anyway, which is what you want for a staging directory that is
// not a repository.
function ignoredPaths(dir) {
  if (flags.has("--no-gitignore")) return new Set();
  try {
    const out = execFileSync(
      "git",
      ["-C", dir, "ls-files", "--others", "--ignored", "--exclude-standard", "--directory"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    );
    return new Set(out.split("\n").filter(Boolean).map((p) => p.replace(/\/$/, "")));
  } catch {
    return new Set(); // not a git work tree — scan everything
  }
}

const rootAbs = resolve(root);
const ignored = ignoredPaths(rootAbs);

// package-scope.json is this repository's single source of truth for both the
// npm scope (enforced by scripts/set-scope.mjs) and the registry a publish is
// allowed to target. The gate is often invoked against a single package
// directory (packages/<name>), not the repo root, so search upward for it —
// same resolution style as tsconfig.json/package.json. Not finding one at all
// means every registry pin fails closed rather than silently passing.
//
// --scope-config exists because the upward search has no answer in --artifact
// mode: an extracted tarball sits in a temp directory with no repository above
// it, so the search would find nothing and fail every registry pin for a reason
// that has nothing to do with the artifact. The caller that extracted the
// tarball knows where the real config is and passes it explicitly.
let scopeConfig = null;
const explicitScopeConfig = flagValue("--scope-config");
if (explicitScopeConfig) {
  if (!existsSync(explicitScopeConfig)) {
    console.error(`check-public-safety: --scope-config ${explicitScopeConfig} does not exist`);
    process.exit(2);
  }
  try {
    scopeConfig = JSON.parse(readFileSync(explicitScopeConfig, "utf8"));
  } catch (error) {
    console.error(`check-public-safety: --scope-config ${explicitScopeConfig} does not parse: ${error.message}`);
    process.exit(2);
  }
} else {
  for (let dir = rootAbs; ; dir = join(dir, "..")) {
    const candidate = join(dir, "package-scope.json");
    if (existsSync(candidate)) {
      try {
        scopeConfig = JSON.parse(readFileSync(candidate, "utf8"));
      } catch {
        scopeConfig = null;
      }
      break;
    }
    const parent = join(dir, "..");
    if (parent === dir) break; // reached filesystem root
  }
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".git") continue;
    const full = join(dir, entry);
    if (ignored.has(relative(rootAbs, full))) continue;
    let stat;
    try {
      stat = statSync(full);
    } catch {
      continue; // broken symlink
    }
    if (stat.isDirectory()) walk(full, out);
    else if (stat.isFile()) out.push(full);
  }
  return out;
}

const failures = [];
const files = walk(rootAbs);

for (const file of files) {
  const rel = relative(rootAbs, file);
  const segments = rel.split(sep);
  const base = basename(file);

  if (!FORBIDDEN_EXEMPT_PATHS.has(rel)) {
    const badDir = segments
      .slice(0, -1)
      .find((s) => FORBIDDEN_DIRS_LC.has(s.toLowerCase()) && !(flags.has("--artifact") && ARTIFACT_ALLOWED_DIRS.has(s.toLowerCase())));
    if (badDir) {
      failures.push({ rel, kind: "forbidden-file", detail: `build output (${badDir}/) must not be committed or copied`, severity: "high", line: 0 });
      continue;
    }
    const badName = segments.find((s) => FORBIDDEN_NAMES_LC.has(s.toLowerCase()));
    if (badName) {
      failures.push({ rel, kind: "forbidden-file", detail: `${badName} must not ship publicly`, severity: "high", line: 0 });
      continue;
    }
  }

  const ext = extname(file).toLowerCase();
  if (ARCHIVE_EXTENSIONS.has(ext)) {
    failures.push({
      rel,
      kind: "forbidden-file",
      detail: `archive (${ext}) cannot be content-scanned for identity or secrets — extract it and ship its contents, or drop it`,
      severity: "high",
      line: 0,
    });
    continue;
  }
  if (SKIP_CONTENT.has(ext)) continue;

  let contents;
  try {
    contents = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  if (contents.includes("\u0000")) continue; // binary

  // Strip zero-width/invisible Unicode before any pattern match: a term with
  // a ZWSP/ZWNJ/ZWJ/BOM inserted mid-string renders identically to a human
  // reader but defeats a literal or regex match. Stripped once here, upfront,
  // so every check below (secrets, neutralize, identity) sees the same text
  // a reader would.
  contents = stripInvisible(contents);

  const rawLines = contents.split("\n");
  const identityLines = normalizeOpaqueLockIntegrity(contents, rel).split("\n");
  const neutralizedLines = identityLines.map((text) => {
    let scannable = text;
    for (const rule of neutralizeRules) {
      if (rule.paths && !rule.paths.some((p) => rel === p || rel.startsWith(p + "/"))) continue;
      rule.re.lastIndex = 0;
      scannable = scannable.replace(rule.re, " ");
    }
    return scannable;
  });

  rawLines.forEach((text, i) => {
    for (const [pattern, why] of secretRes) {
      pattern.lastIndex = 0;
      if (pattern.test(text)) {
        // Secrets are reported without the matching line: echoing it into CI
        // logs would leak the very value the gate just caught.
        failures.push({ rel, kind: "SECRET", detail: why, severity: "critical", line: i + 1, text: "<redacted>" });
      }
    }
  });

  // Identity-class matching, pass 1: per line, same as always.
  for (let i = 0; i < neutralizedLines.length; i++) {
    for (const [re, why, severity] of denyRes) {
      re.lastIndex = 0;
      if (re.test(neutralizedLines[i])) {
        failures.push({ rel, kind: "identity", detail: why, severity, line: i + 1, text: rawLines[i].trim().slice(0, 100) });
      }
    }
  }
  // Identity-class matching, pass 2: a sliding window across the boundary
  // between each line and the next. Pass 1 alone is blind to a term that
  // happens to be split by a line wrap — common in prose, comments, or
  // minified output — because neither half matches on its own. Joining
  // adjacent lines (tried both with and without a space, since a prose wrap
  // replaces a space and a hard/minified split doesn't) catches that without
  // rescanning the whole file as one blob, which would make `line` in a
  // finding meaningless. Only reported when NEITHER line alone already
  // matched, so this never duplicates a pass-1 finding under the wrong line.
  for (let i = 0; i + 1 < neutralizedLines.length; i++) {
    const a = neutralizedLines[i];
    const b = neutralizedLines[i + 1];
    for (const [re, why, severity] of denyRes) {
      re.lastIndex = 0;
      const soloA = re.test(a);
      re.lastIndex = 0;
      const soloB = re.test(b);
      if (soloA || soloB) continue;
      re.lastIndex = 0;
      const spans = re.test(`${a} ${b}`) || (re.lastIndex = 0, re.test(`${a}${b}`));
      if (spans) {
        failures.push({
          rel,
          kind: "identity",
          detail: why,
          severity,
          line: i + 1,
          text: `${rawLines[i].trim()} / ${rawLines[i + 1].trim()}`.slice(0, 100),
        });
      }
    }
  }

  // Monorepo-only dependency protocols are checked structurally rather than as
  // denylist prose. `workspace:*` and `catalog:` are unresolvable for anyone
  // outside the workspace that defines them, but they are also strings this repository's own
  // documentation has to be able to write down. Matching them only inside a
  // manifest's dependency blocks catches the defect without flagging the
  // sentence that warns about it.
  if (base === "package.json") {
    let manifest;
    try {
      manifest = JSON.parse(contents);
    } catch {
      failures.push({ rel, kind: "manifest", detail: "package.json does not parse", severity: "high", line: 0 });
      manifest = null;
    }
    const DEP_BLOCKS = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"];
    for (const block of manifest ? DEP_BLOCKS : []) {
      for (const [dep, range] of Object.entries(manifest[block] ?? {})) {
        if (typeof range !== "string") continue;
        if (range.startsWith("workspace:") || range.startsWith("catalog:")) {
          failures.push({
            rel,
            kind: "manifest",
            detail: `${block}.${dep} uses the "${range}" protocol — unresolvable outside the workspace that defines them`,
            severity: "high",
            line: 0,
          });
        }
      }
    }
    // publishConfig.registry is allowed ONLY when it matches package-scope.json's
    // declared registry — the same single-source-of-truth pattern as the scope
    // check. That lets a deliberate registry choice (npmjs, or GitHub Packages
    // while proving that path) pass, while any OTHER pinned registry — a stale
    // leftover, a copy-pasted private one — still fails. An unpinned registry
    // (the npm default) also always passes.
    if (manifest?.private !== true && manifest?.publishConfig?.registry) {
      const declared = scopeConfig?.registry;
      if (manifest.publishConfig.registry !== declared) {
        failures.push({
          rel,
          kind: "manifest",
          detail:
            `publishConfig.registry ("${manifest.publishConfig.registry}") does not match ` +
            `the registry declared in package-scope.json ("${declared ?? "none"}")`,
          severity: "high",
          line: 0,
        });
      }
    }
  }
}

// -------------------------------------------------------------------- reporting

if (flags.has("--json")) {
  console.log(JSON.stringify({ mode, root: rootAbs, scanned: files.length, failures }, null, 2));
  process.exit(failures.length ? 1 : 0);
}

console.log(`check-public-safety: scanned ${files.length} files under ${rootAbs}`);
console.log(`mode: ${mode}${denylist ? ` (denylist v${denylist.version}, ${denylist.terms.length} terms)` : ""}`);
if (!denylist) {
  console.log(
    `\n!! PARTIAL SCAN — identity checks were SKIPPED (denylist ${denylistError}).\n` +
      `!! Secrets, forbidden files and structural rules were still enforced.\n` +
      `!! A pass here does NOT clear a tree for publication. Re-run in FULL mode\n` +
      `!! with --require-denylist before any push to a public remote.`,
  );
}
console.log("");

if (!failures.length) {
  console.log(
    mode === "FULL"
      ? "PASS — no private identity, forbidden file, or credential-shaped string found."
      : "PASS (partial) — no forbidden file or credential-shaped string found.",
  );
  process.exit(0);
}

const RANK = { critical: 0, high: 1, medium: 2 };
for (const kind of ["SECRET", "forbidden-file", "manifest", "identity"]) {
  const rows = failures.filter((f) => f.kind === kind);
  if (!rows.length) continue;
  console.log(`## ${kind} — ${rows.length} finding(s)`);
  const grouped = rows.reduce((a, r) => ((a[r.detail] ??= []).push(r), a), {});
  const order = Object.entries(grouped).sort(
    (a, b) => (RANK[a[1][0].severity] ?? 3) - (RANK[b[1][0].severity] ?? 3),
  );
  for (const [detail, rs] of order) {
    const where = [...new Set(rs.map((r) => r.rel))];
    console.log(`  [${rs[0].severity}] ${detail}: ${rs.length} hit(s) across ${where.length} file(s)`);
    for (const f of where.slice(0, 6)) console.log(`      ${f}`);
    if (where.length > 6) console.log(`      ...and ${where.length - 6} more`);
  }
  console.log("");
}

console.log(`FAIL — ${failures.length} finding(s). This tree is NOT safe to publish.`);
process.exit(1);
