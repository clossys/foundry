#!/usr/bin/env node
// User-level Claude Code PreToolUse hook (Edit|Write|MultiEdit|NotebookEdit
// matcher): deny an edit whose OWN file_path (and, for NotebookEdit, its
// notebook_path) targets one of a fixed list of protected paths. This
// hook is EXACT for the path itself -- tool_input.file_path/notebook_path
// is the real path the tool is about to write, supplied by Claude Code
// itself, not parsed or guessed from free-form shell text.
//
// #1187 escalation-rule round 8, owner decision (recorded in the
// coordinator chat, 2026-09-23): the companion Bash-matched hook,
// scripts/hooks/deny-tier2.mjs, is REMOVED from this repository. Seven
// review rounds on this PR, almost entirely about that hook, kept finding
// another shell-parsing bypass or another false positive on an ordinary
// command in an unrelated repository (both hooks are user-level, so a
// false positive there hits every repository on the machine) -- text
// analysis of arbitrary Bash can never be made complete. This hook does
// not have that problem: it compares an EXACT path string Claude Code
// itself supplies, never shell text it has to parse. See
// docs/HITL-HOOKS.md for the full history and
// "Optional Bash deny hook for tier-2 paths (best-effort)" (a separate,
// low-priority, not-yet-scheduled issue) for the Bash hook's own future.
//
// THIS FILE ITSELF IS TIER-2 -- see docs/HITL-HOOKS.md's own header.

import { realpathSync, lstatSync, readlinkSync } from "node:fs";
import { dirname, basename, resolve, isAbsolute } from "node:path";

// #1187 escalation-rule round 8, strong-class reviewer, blocking B1:
// anchored at a path boundary (start of string, or right after a "/"),
// so "NOT-HITL-RULE.md" no longer matches "HITL-RULE.md" merely because
// it ends with that substring, and the settings patterns require an
// immediate ".claude/" parent, so ".vscode/settings.json",
// "app-settings.json", "usersettings.json", and
// "test/fixtures/settings.json" in ANY repository (these hooks are
// user-level) are never blocked. `.claude/settings.json` blocks in EVERY
// repository on the machine, not only this one's -- see
// docs/HITL-HOOKS.md for why that is the intended, documented scope.
const PROTECTED_BASENAMES = [
  /(^|\/)hitl-escalation-rule[\w.-]*\.json$/i,
  /(^|\/)HITL-RULE\.md$/i,
  /(^|\/)HITL-HOOKS\.md$/i,
  /(^|\/)deny-tier2-edit\.mjs$/i,
  /(^|\/)deny-tier2-edit\.test\.mjs$/i,
  /(^|\/)\.claude\/settings(\.local)?\.json$/i,
];

// #1187 escalation-rule round 9, strong-class reviewer, blocking B1: the
// patterns above only fold ASCII case (regex /i). On a case-INSENSITIVE,
// Unicode-normalizing filesystem such as APFS (macOS's default), a path
// that substitutes U+017F (LATIN SMALL LETTER LONG S, "ſ") for an
// ordinary "s", or U+212A (KELVIN SIGN, "K") for an ordinary "K", reads
// and writes the SAME on-disk file as the plain-ASCII spelling, but is a
// DIFFERENT JavaScript string that regex /i alone does not fold --
// ".claude/ſettings.json" (ſ, not s) passed this hook entirely
// unmatched, while `fs.writeFileSync` on that same path silently
// overwrote the real ".claude/settings.json". NFKC normalization maps
// both ſ and Kelvin-K to their ordinary ASCII forms (among other
// compatibility foldings), closing this for a not-yet-existing path too
// -- not only one the filesystem could already resolve.
function normalizePathForMatching(p) {
  return p.normalize("NFKC");
}

// Walks up from `p` to the nearest ancestor directory that actually
// exists, resolving it with realpathSync.native (following any symlinks
// along that ancestry chain -- including a symlinked ancestor directory
// itself, #1187 escalation-rule round 9, both reviewers, blocking B2/N1:
// a dangling symlink's target reached through an ALIAS directory, e.g.
// `link -> aliasDir/settings.local.json` where `aliasDir -> .claude`,
// previously returned the un-resolved lexical target, missing that
// `aliasDir` itself resolves to the real, protected `.claude`), then
// re-appends whatever portion of `p` did not exist, lexically, on top of
// that real ancestor.
function resolveExistingAncestor(p) {
  const tail = [];
  let current = p;
  for (let i = 0; i < 100; i++) {
    try {
      const real = realpathSync.native(current);
      return tail.length ? `${real}/${tail.join("/")}` : real;
    } catch {
      const parent = dirname(current);
      if (parent === current) return p; // reached the filesystem root with nothing resolvable
      tail.unshift(basename(current));
      current = parent;
    }
  }
  return p;
}

// Resolves symlinks before comparing, so a symlink ALIAS to a protected
// path (or through a symlinked ancestor directory) can't bypass basename
// matching by presenting a different path string for the same real
// file. Uses realpathSync.native (the OS's own realpath syscall), not
// the pure-JS realpathSync, so the CANONICAL on-disk spelling is used on
// a case-folding/Unicode-normalizing filesystem (#1187 escalation-rule
// round 9, strong-class reviewer, blocking B1) -- realpathSync alone
// does not consult the filesystem for this at all, so it returns
// whatever string it was given, unresolved to the real name.
function resolveRealPath(targetPath) {
  const normalized = normalizePathForMatching(targetPath);
  try {
    return realpathSync.native(normalized);
  } catch {
    // realpathSync.native throws both for an ordinary not-yet-existing
    // path AND for a DANGLING symlink (a symlink whose OWN target
    // doesn't exist yet either) -- it can never resolve one of those, no
    // matter how much of the rest of the path exists. Follow the
    // symlink chain manually instead: lstat (which does NOT follow the
    // link, so it succeeds even when the target is dangling), read its
    // target with readlink, resolve that target relative to the LINK's
    // OWN directory (not the caller's cwd), and repeat, bounded, in case
    // of a chain of links.
    let current = normalized;
    for (let hop = 0; hop < 40; hop++) {
      let stat;
      try {
        stat = lstatSync(current);
      } catch {
        break; // `current` doesn't exist at all, not even as a symlink
      }
      if (!stat.isSymbolicLink()) break;
      let linkTarget;
      try {
        linkTarget = readlinkSync(current);
      } catch {
        break;
      }
      const resolved = isAbsolute(linkTarget) ? linkTarget : resolve(dirname(current), linkTarget);
      current = normalizePathForMatching(resolved);
    }
    // Whether or not a symlink was followed above, resolve as much of
    // the FINAL path's ancestry as exists -- walking up, and through any
    // symlinked ancestor directory along the way -- then re-append
    // whatever tail did not exist. This covers a plain not-yet-existing
    // path, a dangling symlink whose target is a plain not-yet-existing
    // path, AND a dangling symlink whose target is reached through a
    // symlinked ancestor directory, uniformly, with one fallback.
    return resolveExistingAncestor(current);
  }
}

function isProtected(targetPath) {
  const normalized = normalizePathForMatching(targetPath);
  if (PROTECTED_BASENAMES.some((re) => re.test(normalized))) return true;
  const resolved = resolveRealPath(targetPath);
  if (resolved !== normalized && PROTECTED_BASENAMES.some((re) => re.test(resolved))) return true;
  return false;
}

let input = "";
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", () => {
  let payload;
  try {
    payload = JSON.parse(input);
  } catch {
    process.exit(0); // fail open on unparseable input
  }

  // Check EVERY path-bearing field that is present, not just one as a
  // fallback from the other -- a payload carrying a harmless file_path
  // alongside a protected notebook_path still blocks either way.
  const candidatePaths = [payload?.tool_input?.file_path, payload?.tool_input?.notebook_path].filter(
    (value) => typeof value === "string" && value.length > 0,
  );
  if (candidatePaths.length === 0) process.exit(0);

  for (const targetPath of candidatePaths) {
    if (isProtected(targetPath)) {
      process.stderr.write(
        `Blocked by user-level deny hook (docs/HITL-HOOKS.md, clossys/foundry): editing this path is tier-2 (owner only). Path: ${targetPath}\n`,
      );
      process.exit(2);
    }
  }
  process.exit(0);
});
