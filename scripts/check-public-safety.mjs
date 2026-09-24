#!/usr/bin/env node
// check-public-safety — refuse to publish anything carrying private identity.
//
//   node scripts/check-public-safety.mjs <dir> [options]
//
//     --require-denylist   fail (exit 2) rather than degrade to a partial scan
//     --allow-changelogs   permit CHANGELOG.md (see FORBIDDEN_NAMES)
//     --denylist <file>    explicit denylist path
//     --path-prefix <p>    repo-relative prefix to prepend to a scanned file's
//                          path before matching a neutralize rule's `paths`
//                          (see WHY --path-prefix EXISTS below); the path shown
//                          in a reported finding is never affected. Usually
//                          unnecessary: when `root` sits inside a real
//                          repository tree this is now auto-detected from
//                          where package-scope.json is found (see
//                          AUTO-DETECTING --path-prefix below) — pass this
//                          explicitly only to override that, or when scanning
//                          a root with no repository above it (e.g. an
//                          extracted tarball), where there is nothing to
//                          auto-detect from
//     --opaque-exemptions <file>
//                          explicit path to the opaque-content exemption
//                          registry (see OPAQUE_EXTENSIONS below); defaults to
//                          an upward search for governance/opaque-content-
//                          exemptions.json, same resolution style as
//                          package-scope.json
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

import { readFileSync, readdirSync, statSync, existsSync, writeSync } from "node:fs";
import { join, relative, basename, extname, resolve, sep } from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import zlib from "node:zlib";

const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith("--")));
const positional = argv.filter((a) => !a.startsWith("--"));
const root = positional[0];

if (!root) {
  console.error(
    "usage: check-public-safety.mjs <dir> [--require-denylist] [--allow-changelogs] [--denylist <file>] " +
      "[--path-prefix <p>] [--opaque-exemptions <file>] [--json]",
  );
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

// WHY --path-prefix EXISTS
// -------------------------
// A neutralize rule's `paths` are written as repository-relative paths (e.g.
// "packages/foo") because that is what a human reviewing the denylist reads
// them against. But this script is also invoked by check-artifact-safety.mjs
// against an EXTRACTED TARBALL, whose root is the package directory itself:
// everything in an npm tarball lives under `package/`, and that layer is
// stripped before this script ever sees the tree. Inside that scan `rel` is
// bare "CHANGELOG.md", not "packages/foo/CHANGELOG.md", so a package-scoped
// rule can never match there no matter how it is written: there is no
// repository-relative path left to compare against.
//
// --path-prefix closes that gap by letting the caller (which knows where the
// package really lives relative to the repository root) restore the missing
// leading segment before the comparison, and ONLY before the comparison:
// `rel` itself, and everything reported in a finding, stays the real scanned
// path. Omitted, matching is exactly what it always was — EXCEPT that when
// `root` sits inside a real repository tree (there is a package-scope.json
// somewhere above it), the value is now auto-detected rather than staying
// null; see "AUTO-DETECTING --path-prefix" further down, right after
// package-scope.json is located. An explicit --path-prefix always wins over
// the auto-detected value (issue #854).
let pathPrefix = flagValue("--path-prefix") ?? null;

// Neutralize `paths` are always written with "/" regardless of platform (see
// the denylist format note further down), so the comparison has to join on
// "/" too rather than the OS path separator, since these are repo-relative
// paths, not OS paths, even when this script runs on a platform whose
// `path.sep` isn't "/".
function toPosix(p) {
  return p.split(sep).join("/");
}

function prefixedRel(rel) {
  const posixRel = toPosix(rel);
  if (!pathPrefix) return posixRel;
  const trimmedPrefix = pathPrefix.replace(/\/+$/, "");
  return trimmedPrefix ? `${trimmedPrefix}/${posixRel}` : posixRel;
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
// control once the file is authored here rather than copied in. This
// repository's own package changelogs no longer carry that name: they live at
// docs/changelogs/<dir>.md (scripts/lib/changelog-location.mjs), outside every
// tarball, and a tree scan reads them as ordinary public text with or without
// this flag. The flag only ever governs a file actually named CHANGELOG.md.
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

// MACHINE-LOCAL PATH NAMES
// ------------------------
// The name lists above are exact matches, and identity matching (the
// denylist) only ever reads file CONTENTS. So a file or directory whose NAME
// is a flattened absolute local path — the shape an agent's session or
// scratchpad directory takes when it is copied into a tree — passed in FULL
// and PARTIAL mode alike. A real near-miss did exactly that: directories
// named after a flattened home path plus a session scratchpad id.
//
// These rules are structural and hardcoded, not denylist terms: they describe
// a SHAPE, not a secret, so they are safe to publish here, and they fire in
// PARTIAL mode too. They are tuned for low false positives over completeness;
// each has a positive and a negative case in scripts/test-gates.mjs
// ("# machine-local path names").
//
// Per path segment. A flattening tool substitutes one separator for every
// "/" (or "\"), so the home-directory rules require: a LEADING separator (the
// flattened root), a case-exact root word, a name, and at least one further
// component, with the same separator throughout (the `\1` backreference).
// That keeps out `home-page-copy.md` and `users-guide.md` (no flattened
// root), `Users-Guide-Intro.md` (no leading separator) and a Sass partial
// like `_home-page-hero.scss` (mixed separators). The temp-root rules may sit
// anywhere in a segment because their token pairs (`private` then `tmp` or
// `var`, `var` then `folders`, `tmp` then `claude-<digit>`) do not occur
// together in ordinary names; each still needs a following separator.
const MP_SEP = "[-_\\\\]";
const MP_NAME = "[^-_\\\\]+";
const MACHINE_PATH_SEGMENT_RULES = [
  [new RegExp(`^(${MP_SEP})Users\\1${MP_NAME}\\1.`), "flattened macOS user home (Users/<name>/...)"],
  [new RegExp(`^(${MP_SEP})home\\1${MP_NAME}\\1.`), "flattened Linux user home (home/<name>/...)"],
  [new RegExp(`^[A-Za-z]:?${MP_SEP}{1,2}Users${MP_SEP}${MP_NAME}${MP_SEP}.`), "flattened Windows user home (C:\\Users\\<name>\\...)"],
  [new RegExp(`(?:^|${MP_SEP})private(${MP_SEP})(?:tmp|var)\\1`), "flattened macOS temp root (private/tmp or private/var)"],
  [new RegExp(`(?:^|${MP_SEP})var(${MP_SEP})folders\\1`), "flattened macOS per-user temp root (var/folders)"],
  [new RegExp(`(?:^|${MP_SEP})tmp(${MP_SEP})claude-\\d`), "flattened agent session temp root (tmp/claude-<uid>)"],
];
// Over the whole POSIX-joined relative path: an absolute path mirrored as
// nested directories (a `Users` directory holding a per-name directory
// holding more), which no single segment shows. `Users` is case-exact
// because a lowercase `users` directory is an ordinary web route or feature
// folder. A mirrored Linux
// `home/<name>/` is deliberately NOT a rule: a relative path has no leading
// "/" to tell it apart from an ordinary `src/home/components/` layout.
const MACHINE_PATH_RELPATH_RULES = [
  [/(?:^|\/)Users\/[^/]+\/[^/]/, "mirrored macOS user home (Users/<name>/...)"],
  [/(?:^|\/)private\/(?:tmp|var)\//, "mirrored macOS temp root (private/tmp or private/var)"],
  [/(?:^|\/)var\/folders\//, "mirrored macOS per-user temp root (var/folders)"],
  [/(?:^|\/)tmp\/claude-\d/, "mirrored agent session temp root (tmp/claude-<uid>)"],
];

// Every machine-local shape in one relative path, as `{ where, what }` —
// `where` is the offending segment (or mirrored run of segments).
function machinePathHits(relPosix) {
  const hits = [];
  for (const segment of relPosix.split("/")) {
    // First matching rule only: one flattened segment is one finding.
    const rule = MACHINE_PATH_SEGMENT_RULES.find(([re]) => re.test(segment));
    if (rule) hits.push({ where: segment, what: rule[1] });
  }
  for (const [re, what] of MACHINE_PATH_RELPATH_RULES) {
    const m = re.exec(relPosix);
    if (m) hits.push({ where: m[0].replace(/^\//, ""), what });
  }
  return hits;
}
// The same shapes in file CONTENT are deliberately not matched here: slash-
// form paths in content are the denylist's job in FULL mode, and a
// structural content backstop measured 22 new findings on the current tree
// (placeholder `/home/<name>/` test fixtures, prose naming the macOS temp
// symlink), so it stays out until those have a principled exclusion.

// OPAQUE FORMATS (issue #588)
// ---------------------------
// These extensions used to be SKIP_CONTENT: `continue`d past with no bytes
// ever opened, on the theory that a raster image, a font, a video container
// or a PDF is "pixel/audio/binary data only" the way a JPEG's compressed
// pixel grid genuinely is. That theory does not hold for the formats
// themselves: a PNG carries plaintext tEXt/iTXt metadata chunks, a JPEG
// carries EXIF/XMP/COM text segments, a PDF carries an Info dictionary and
// (usually zlib-compressed) page-content text streams, a font's `name` table
// carries copyright/vendor strings, and MP4/WebM containers carry title and
// comment atoms. Every one of those can carry private identity or a
// credential-shaped string this gate exists to catch — and until this fixed,
// a passing scan and a passing tarball claimed to have checked for exactly
// that, on files it had never opened. No opaque file is committed anywhere
// in this repository today, which is what made this a FUTURE false-green
// rather than a current wrong answer: the day one is added, the old
// behaviour would report it clean without a single byte read.
//
// The fix does two independent things to every file with one of these
// extensions, neither of which is "skip":
//
//   1. REFUSE BY DEFAULT. This gate cannot deterministically parse any of
//      these formats, so it can never prove one is clean — and "cannot
//      prove clean" must never become "counted as clean" (see docs/
//      LIFECYCLE.md's "derived from evidence, never declared"). The only
//      way past the refusal is an explicit, human-reviewed, sha256-pinned
//      exemption — see "opaque exemption loading" further down, mirroring
//      check-package-evidence.mjs's `gaps`.
//   2. EXTRACT ANYWAY, best-effort. Refusing the file does not mean giving
//      up on looking at it: extractOpaqueStrings pulls every printable-ASCII
//      run out of the raw bytes (the same technique the `strings` utility
//      uses) and, for a PDF specifically, additionally inflates any
//      /FlateDecode content stream it can find first. Both are deterministic
//      and need no format parser or new dependency. A SECRET or identity
//      match found this way fails the file even when it IS exempted — a
//      human's "this is just a logo" review does not get to override an
//      actual credential sitting in the bytes. What this extraction can
//      never do is prove a negative: a string in an encoding, a compression
//      codec, or a binary field it does not know how to read is invisible to
//      it, which is exactly why passing extraction is never by itself
//      sufficient to admit the file — only an exemption is (see the PASS
//      banner at the bottom of this file, which says so rather than
//      claiming more than was checked).
const OPAQUE_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".avif", // raster images: can carry text metadata chunks/segments
  ".woff", ".woff2", ".ttf", ".otf", ".eot", // fonts: `name` table can carry copyright/vendor strings
  ".mp4", ".webm", // video containers: can carry title/comment metadata atoms
  ".wasm", // compiled binary: custom sections can carry producer/debug strings
  ".pdf", // Info dictionary and (usually compressed) content streams can carry text
]);

// Minimum run length for the printable-ASCII extractor below, matching the
// `strings` utility's own default (`strings -n 6`... actually GNU strings
// defaults to 4; 6 is chosen here to cut noise from short binary runs that
// happen to land in the printable range without meaningfully raising the
// risk of missing a real identity term, which this gate's own SHORT-term
// `caseSensitive` convention already exists to catch unanchored).
const OPAQUE_MIN_STRING_LEN = 6;

// Printable-ASCII run extraction: a deterministic, format-agnostic way to
// recover embedded text from bytes this gate cannot otherwise parse. See
// OPAQUE FORMATS above for what it does and does not catch.
function printableStrings(buf) {
  const out = [];
  let start = -1;
  for (let i = 0; i <= buf.length; i++) {
    const byte = i < buf.length ? buf[i] : -1;
    const printable = byte >= 0x20 && byte <= 0x7e;
    if (printable) {
      if (start < 0) start = i;
    } else if (start >= 0) {
      if (i - start >= OPAQUE_MIN_STRING_LEN) out.push(buf.toString("latin1", start, i));
      start = -1;
    }
  }
  return out;
}

// PDF-specific: locate every `stream\r?\n ... \r?\nendstream` block whose
// nearest preceding dictionary mentions /FlateDecode, and inflate it with
// Node's built-in zlib — no new dependency, and this is how nearly every
// real-world PDF writer compresses page content, so a printable-strings pass
// over the raw file alone would see only compressed bytes and miss the
// actual visible text entirely.
function pdfInflatedStrings(buf) {
  const out = [];
  const text = buf.toString("latin1");
  const streamRe = /stream\r?\n/g;
  let m;
  while ((m = streamRe.exec(text))) {
    const dataStart = m.index + m[0].length;
    const endIdx = text.indexOf("endstream", dataStart);
    if (endIdx < 0) break;
    // The dictionary governing this stream is whatever precedes `stream`,
    // bounded to a generous window so a malformed or huge file cannot make
    // this scan quadratic.
    const dict = text.slice(Math.max(0, m.index - 4096), m.index);
    if (/\/Filter\s*(\/FlateDecode|\[[^\]]*\/FlateDecode)/.test(dict)) {
      let dataEnd = endIdx;
      if (text[dataEnd - 1] === "\n") dataEnd -= 1; // PDF spec: one EOL before `endstream`
      if (text[dataEnd - 1] === "\r") dataEnd -= 1;
      try {
        out.push(...printableStrings(zlib.inflateSync(buf.subarray(dataStart, dataEnd))));
      } catch {
        // Not actually valid FlateDecode data, or truncated — best-effort;
        // move on rather than failing the whole scan on one bad stream.
      }
    }
    streamRe.lastIndex = endIdx;
  }
  return out;
}

function extractOpaqueStrings(buf, ext) {
  const strings = printableStrings(buf);
  if (ext === ".pdf") strings.push(...pdfInflatedStrings(buf));
  return strings;
}

// The exemption registry. Mirrors check-package-evidence.mjs's `gaps`
// mechanism: a `reason` (>=20 chars) and an integer `issue` are required, so
// an exemption is a recorded decision, not a standing carve-out — and here
// it is additionally pinned to the file's exact sha256, so it cannot outlive
// its reason in the most literal sense: change one byte of the file and the
// hash no longer matches, and the file is refused again until it is
// reviewed again. `path` is repository-relative (matched the same way a
// neutralize rule's `paths` is, against the --path-prefix-restored path —
// see WHY --path-prefix EXISTS above — so one exemption covers both the tree
// scan and the tarball scan of the same file).
// A nested Map (path -> sha256 -> entry), deliberately not a single map
// keyed by a joined string: a joined key needs a separator character that is
// guaranteed absent from both a path and a hex digest, and getting that
// subtly wrong (as an earlier draft of this function did, joining with a
// literal embedded NUL byte that then had to be typed identically at every
// call site) is exactly the class of bug this shape makes structurally
// impossible.
function validateOpaqueExemptions(list, sourceLabel) {
  const errors = [];
  const map = new Map();
  for (const entry of list) {
    if (!entry || typeof entry !== "object") {
      errors.push(`${sourceLabel}: an exemption entry is not an object`);
      continue;
    }
    const { path: entryPath, sha256, reason, issue } = entry;
    if (typeof entryPath !== "string" || !entryPath) {
      errors.push(`${sourceLabel}: an exemption entry needs a string "path"`);
      continue;
    }
    if (typeof sha256 !== "string" || !/^[0-9a-f]{64}$/.test(sha256)) {
      errors.push(`${sourceLabel}: exemption for "${entryPath}" needs a 64-hex-character "sha256" of the exact file it covers`);
      continue;
    }
    if (typeof reason !== "string" || reason.trim().length < 20) {
      errors.push(`${sourceLabel}: exemption for "${entryPath}" needs a "reason" of at least 20 characters saying what was checked and why it is safe`);
      continue;
    }
    if (!Number.isInteger(issue)) {
      errors.push(`${sourceLabel}: exemption for "${entryPath}" needs an integer "issue" — a countdown, like check-package-evidence.mjs's \`gaps\`, not a standing exemption`);
      continue;
    }
    if (!map.has(entryPath)) map.set(entryPath, new Map());
    const byHash = map.get(entryPath);
    if (byHash.has(sha256)) {
      errors.push(`${sourceLabel}: duplicate exemption for "${entryPath}" at the same sha256`);
      continue;
    }
    byHash.set(sha256, entry);
  }
  return { map, errors };
}

// Archives are deliberately NOT in OPAQUE_EXTENSIONS — there is no printable-
// strings extraction pass for them below, unlike an opaque file. A .zip (or a
// gzip-wrapped tar) can carry an arbitrary text file inside it — a copied
// CLAUDE.md, a stray .env, an identity-bearing README — that this gate would
// otherwise never open, silently passing exactly the kind of contamination it
// exists to catch. Rather than best-effort extract them, refuse them
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
//
// A NUL byte is stripped here too, NOT used as `if (contents.includes(NUL))
// continue` to skip the whole file as binary — that is the ordinary way to
// detect a binary file and a trap for a gate like this one. A single stray
// NUL anywhere in an otherwise-text file would make that whole file invisible
// to this scan. That is not hypothetical: scripts/check-contamination-classes.mjs
// embeds one literal NUL byte (as the needle of its own identical binary
// check), and this gate's own wholesale-skip once made that entire file
// invisible to FULL-mode scanning — the same file a real identity leak later
// shipped in and survived FULL-mode CI. A boundary gate must not have a byte
// that switches it off. Genuinely opaque formats are handled separately above
// (OPAQUE_EXTENSIONS: refused by default, best-effort extracted regardless —
// never silently skipped) and archives are refused outright (ARCHIVE_
// EXTENSIONS); everything else is scanned in full here, with the NUL and
// zero-width characters stripped out first.
const ZERO_WIDTH_RE = /[\u0000\u200B\u200C\u200D\u2060\u180E\u00AD\uFEFF]/g;
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

// Shared by both the text-file path and the opaque-extraction path below, so
// there is one implementation of "does a neutralize rule apply here" rather
// than two that can drift apart. `matchRelForFile` is the --path-prefix
// restored path (see WHY --path-prefix EXISTS above), never the raw `rel`.
function applyNeutralize(text, matchRelForFile) {
  let scannable = text;
  for (const rule of neutralizeRules) {
    if (rule.paths && !rule.paths.some((p) => matchRelForFile === p || matchRelForFile.startsWith(p + "/"))) continue;
    rule.re.lastIndex = 0;
    scannable = scannable.replace(rule.re, " ");
  }
  return scannable;
}

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
// The directory that upward search actually found package-scope.json in —
// distinct from scopeConfig itself, which is null both when nothing was
// found AND when something was found but failed to parse. AUTO-DETECTING
// --path-prefix below needs the directory in both of those latter cases too
// (a malformed package-scope.json is still sitting at the real repository
// root), so this is tracked unconditionally, before the parse is attempted.
let scopeConfigDir = null;
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
      scopeConfigDir = dir;
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

// AUTO-DETECTING --path-prefix (issue #854)
// ------------------------------------------
// A neutralize rule's `paths` are always written repository-relative. When
// `root` already IS the repository root, `rel` (a scanned file's path
// relative to `root`) is already repository-relative and no prefix is
// needed. But when `root` is a subdirectory of the repository — most
// commonly a single package directory, exactly what publish.yml's
// package-scoped safety-gate step scans — `rel` loses its leading
// `packages/<name>/` segment, and a neutralize entry written against the
// full repository-relative path can never match there again no matter how
// it is spelled. That silently turns an already-reviewed, deliberately
// exempted reference into a fresh CRITICAL finding purely because of how
// the gate happened to be invoked — not because anything about the tree
// changed.
//
// check-artifact-safety.mjs already avoids this for its own (extracted-
// tarball) scan by computing and passing --path-prefix explicitly (see that
// file for why). This block gives every OTHER caller the same correction
// automatically — including a bare manual invocation, and publish.yml's
// package-scoped step, neither of which pass --path-prefix today — by
// reusing the exact directory this scan already walked upward to find
// package-scope.json: the same single anchor this script already treats as
// "the repository root" for the registry-pin check above. There is
// deliberately no second, independent repository-root-finding mechanism
// (e.g. shelling out to `git rev-parse --show-toplevel`) here: reusing the
// one this script already trusts means the two can never disagree with each
// other about where the repository root is.
//
// An explicit --path-prefix always wins (this only fills in when none was
// given). And it only fills in when the upward search actually found an
// anchor to compute one from: in --artifact mode the extracted tarball sits
// in a temp directory with no repository above it, but that mode always
// supplies --scope-config (and, from check-artifact-safety.mjs, its own
// correctly-computed --path-prefix) explicitly instead, so
// `explicitScopeConfig` is set and this block is skipped entirely — it never
// runs a second, redundant computation of the same value. When neither an
// explicit prefix nor a discoverable package-scope.json exists, `pathPrefix`
// stays null and matching is exactly what it always was: never widened,
// only correctly rebased when a repository root is actually known.
if (pathPrefix === null && !explicitScopeConfig && scopeConfigDir) {
  pathPrefix = toPosix(relative(scopeConfigDir, rootAbs));
}

// -------------------------------------------------- opaque exemption loading
//
// Resolved the same way package-scope.json above is: an explicit --opaque-
// exemptions flag first, else an upward search from `root` for governance/
// opaque-content-exemptions.json. The upward search has no answer when
// `root` is an extracted tarball in a temp directory (no repository above
// it) — check-artifact-safety.mjs passes --opaque-exemptions explicitly for
// exactly that reason, same as it already does for --scope-config.
let opaqueExemptionMap = new Map();
const opaqueExemptionLoadErrors = [];
const explicitOpaqueExemptions = flagValue("--opaque-exemptions");
let opaqueExemptionsPath = null;
if (explicitOpaqueExemptions) {
  if (!existsSync(explicitOpaqueExemptions)) {
    console.error(`check-public-safety: --opaque-exemptions ${explicitOpaqueExemptions} does not exist`);
    process.exit(2);
  }
  opaqueExemptionsPath = explicitOpaqueExemptions;
} else {
  for (let dir = rootAbs; ; dir = join(dir, "..")) {
    const candidate = join(dir, "governance", "opaque-content-exemptions.json");
    if (existsSync(candidate)) {
      opaqueExemptionsPath = candidate;
      break;
    }
    const parent = join(dir, "..");
    if (parent === dir) break; // reached filesystem root
  }
}
// No registry found at all is not an error — it just means every opaque file
// in this scan is refused, which is the correct default with nothing yet
// reviewed. A registry that exists but does not parse, or that carries a
// malformed entry, IS an error: pushed into `failures` below (once that
// array exists) rather than silently treated as "no exemptions" — a
// reviewer's typo must never read as "nothing to see here".
if (opaqueExemptionsPath) {
  try {
    const parsed = JSON.parse(readFileSync(opaqueExemptionsPath, "utf8"));
    const list = Array.isArray(parsed.exemptions) ? parsed.exemptions : [];
    const { map, errors } = validateOpaqueExemptions(list, opaqueExemptionsPath);
    opaqueExemptionMap = map;
    opaqueExemptionLoadErrors.push(...errors);
  } catch (error) {
    opaqueExemptionLoadErrors.push(`${opaqueExemptionsPath} does not parse: ${error.message}`);
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
// A malformed opaque-exemption registry is a real, visible failure — see
// "No registry found at all is not an error" above — pushed here rather than
// where it was discovered, since `failures` did not exist yet at that point.
for (const message of opaqueExemptionLoadErrors) {
  failures.push({
    rel: opaqueExemptionsPath ? relative(rootAbs, opaqueExemptionsPath) : "governance/opaque-content-exemptions.json",
    kind: "opaque-exemption-invalid",
    detail: message,
    severity: "high",
    line: 0,
  });
}
let opaqueScanned = 0;
let opaqueAcknowledged = 0;
const files = walk(rootAbs);

for (const file of files) {
  const rel = relative(rootAbs, file);
  const segments = rel.split(sep);
  const base = basename(file);

  // Structural, so it runs in PARTIAL mode too, and before every `continue`
  // below: a machine-local path name is a finding whatever the file holds.
  // Not a `continue` itself — the file's contents are still scanned.
  for (const { where, what } of machinePathHits(toPosix(rel))) {
    failures.push({
      rel,
      kind: "machine-path",
      detail: `path segment "${where}" is a ${what}; machine-local paths must not be committed`,
      severity: "high",
      line: 0,
    });
  }

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
  // Neutralize rules (and now, the opaque-exemption registry) compare
  // against `matchRel`, not `rel`; see WHY --path-prefix EXISTS above. Every
  // failure pushed below still reports `rel`, the real scanned path: only
  // the comparison is rebased, never what a finding shows. Computed once per
  // file, ahead of both the opaque path and the text path, since both need it.
  const matchRel = prefixedRel(rel);

  if (OPAQUE_EXTENSIONS.has(ext)) {
    opaqueScanned += 1;
    let raw;
    try {
      raw = readFileSync(file);
    } catch {
      // Cannot even open the bytes. Fail closed exactly like every other
      // path in this gate: "could not be read" is the strongest possible
      // case for refusing an opaque file, never a reason to let it slide.
      failures.push({
        rel,
        kind: "opaque-unreadable",
        detail: `${ext} file could not be read; an unreadable opaque file is refused, never treated as clean`,
        severity: "high",
        line: 0,
      });
      continue;
    }
    const sha256 = createHash("sha256").update(raw).digest("hex");
    const exemption = opaqueExemptionMap.get(matchRel)?.get(sha256);

    // Best-effort extraction runs regardless of exemption status — see
    // OPAQUE FORMATS above for why a SECRET/identity hit here fails the file
    // even when a human has reviewed and exempted it.
    for (const line of extractOpaqueStrings(raw, ext)) {
      for (const [pattern, why] of secretRes) {
        pattern.lastIndex = 0;
        if (pattern.test(line)) {
          failures.push({ rel, kind: "SECRET", detail: why, severity: "critical", line: 0, text: "<redacted>" });
        }
      }
      const neutralizedLine = applyNeutralize(line, matchRel);
      for (const [re, why, severity] of denyRes) {
        re.lastIndex = 0;
        if (re.test(neutralizedLine)) {
          failures.push({ rel, kind: "identity", detail: why, severity, line: 0, text: line.trim().slice(0, 100) });
        }
      }
    }

    if (exemption) {
      opaqueAcknowledged += 1;
    } else {
      failures.push({
        rel,
        kind: "opaque-unacknowledged",
        detail:
          `${ext} is an opaque format that can carry hidden text, metadata, or an attachment this gate cannot fully parse; ` +
          "refused unless explicitly reviewed and recorded (with this exact file's sha256) in governance/opaque-content-exemptions.json",
        severity: "high",
        line: 0,
      });
    }
    continue;
  }

  let contents;
  try {
    contents = readFileSync(file, "utf8");
  } catch {
    continue;
  }

  // Strip NUL and zero-width/invisible Unicode before any pattern match: a
  // term with a ZWSP/ZWNJ/ZWJ/BOM inserted mid-string renders identically to
  // a human reader but defeats a literal or regex match, and a stray NUL must
  // not make the whole file invisible to the scan (see stripInvisible above).
  // Stripped once here, upfront, so every check below (secrets, neutralize,
  // identity) sees the same text a reader would.
  contents = stripInvisible(contents);

  const rawLines = contents.split("\n");
  const identityLines = normalizeOpaqueLockIntegrity(contents, rel).split("\n");
  // `matchRel` was already computed above (shared with the opaque path).
  // Every failure pushed below still reports `rel`, the real scanned path:
  // only the neutralize comparison is rebased, never what a finding shows.
  const neutralizedLines = identityLines.map((text) => applyNeutralize(text, matchRel));

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
  // writeSync, not console.log, and the difference is not cosmetic.
  //
  // When stdout is a PIPE (any caller doing `... --json | something`, or a
  // parent capturing it via spawnSync/execFileSync) Node writes it
  // ASYNCHRONOUSLY. process.exit() on the next line then terminates the
  // process with that write still queued, and everything past roughly the
  // first 64 KB is silently discarded — the reader gets a truncated document
  // that is no longer valid JSON. Redirect the same command to a FILE and it
  // is correct, because file writes are synchronous; that asymmetry is what
  // makes this so easy to miss.
  //
  // Measured here at 4,178,042 bytes to a file versus exactly 65,536 through
  // a pipe. It stayed hidden because a report only gets big when there are
  // many findings, and the common cases — a clean tree, or a handful of hits
  // — fit under the limit.
  //
  // writeSync(1, ...) blocks until the bytes are handed over, so the
  // subsequent exit cannot truncate it.
  writeSync(
    1,
    JSON.stringify({ mode, root: rootAbs, scanned: files.length, opaqueScanned, opaqueAcknowledged, failures }, null, 2) + "\n",
  );
  process.exit(failures.length ? 1 : 0);
}

console.log(`check-public-safety: scanned ${files.length} files under ${rootAbs}`);
console.log(`mode: ${mode}${denylist ? ` (denylist v${denylist.version}, ${denylist.terms.length} terms)` : ""}`);
if (!denylist) {
  console.log(
    `\n!! PARTIAL SCAN — identity checks were SKIPPED (denylist ${denylistError}).\n` +
      `!! Secrets, forbidden files, machine-local path names and structural rules were still enforced.\n` +
      `!! A pass here does NOT clear a tree for publication. Re-run in FULL mode\n` +
      `!! with --require-denylist before any push to a public remote.`,
  );
}
console.log("");

// The opaque-content claim, narrowed to exactly what was checked (issue
// #588): an opaque file is never silently absent from this sentence, and a
// PASS never implies this gate parsed a format it cannot parse. See OPAQUE
// FORMATS above for what "reviewed" and "best-effort" mean here.
const opaqueNote = opaqueScanned
  ? ` ${opaqueScanned} opaque file(s) (PDF/image/font/video/wasm) present, each explicitly reviewed and acknowledged in governance/opaque-content-exemptions.json; best-effort text extraction found no additional SECRET or identity match in them, but that extraction cannot prove a negative on a format this gate does not fully parse — the exemption, not the extraction, is what authorizes shipping them.`
  : " No opaque (PDF/image/font/video/wasm) files were present in this scan.";

if (!failures.length) {
  console.log(
    (mode === "FULL"
      ? "PASS — no private identity, forbidden file, machine-local path name, or credential-shaped string found in readable content."
      : "PASS (partial) — no forbidden file, machine-local path name, or credential-shaped string found in readable content.") + opaqueNote,
  );
  process.exit(0);
}

const RANK = { critical: 0, high: 1, medium: 2 };
for (const kind of ["SECRET", "forbidden-file", "machine-path", "opaque-unacknowledged", "opaque-unreadable", "opaque-exemption-invalid", "manifest", "identity"]) {
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
