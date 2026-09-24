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
// user-level) are never blocked.
const PROTECTED_BASENAMES = [
  /(^|\/)hitl-escalation-rule[\w.-]*\.json$/i,
  /(^|\/)HITL-RULE\.md$/i,
  /(^|\/)HITL-HOOKS\.md$/i,
  /(^|\/)deny-tier2-edit\.mjs$/i,
  /(^|\/)deny-tier2-edit\.test\.mjs$/i,
  /(^|\/)\.claude\/settings(\.local)?\.json$/i,
];

// Resolves symlinks before comparing, so a symlink ALIAS to a protected
// path (or through a symlinked ancestor directory) can't bypass basename
// matching by presenting a different path string for the same real file.
function resolveRealPath(targetPath) {
  try {
    return realpathSync(targetPath);
  } catch {
    // realpathSync throws both for an ordinary not-yet-existing path AND
    // for a DANGLING symlink (a symlink whose OWN target doesn't exist
    // yet either -- it can never resolve one of those, no matter how
    // much of the rest of the path exists) -- #1187 escalation-rule
    // round 8, strong-class reviewer, blocking B2: an earlier version
    // treated both cases the same way (resolve only the parent
    // directory, then re-append the ORIGINAL path's own basename), which
    // for a dangling symlink means re-appending the LINK's name, not
    // its target -- so a symlink literally named `neutral.json` pointing
    // at `.claude/settings.local.json` (which doesn't exist yet) was
    // never recognized as protected at all. Follow the symlink chain
    // manually instead: lstat (which does NOT follow the link, so it
    // succeeds even when the target is dangling), read its target with
    // readlink, resolve that target relative to the LINK's OWN
    // directory (not the caller's cwd), and repeat, bounded, in case of
    // a chain of links.
    let current = targetPath;
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
      current = isAbsolute(linkTarget) ? linkTarget : resolve(dirname(current), linkTarget);
    }
    if (current !== targetPath) return current;

    // Not a symlink (dangling or otherwise) either -- fall back to
    // resolving only the existing portion of the path (its parent
    // directory), so a symlinked ANCESTOR directory still can't alias a
    // protected path for a not-yet-existing target underneath it.
    try {
      const realDir = realpathSync(dirname(targetPath));
      return `${realDir}/${basename(targetPath)}`;
    } catch {
      return targetPath;
    }
  }
}

function isProtected(targetPath) {
  if (PROTECTED_BASENAMES.some((re) => re.test(targetPath))) return true;
  const resolved = resolveRealPath(targetPath);
  if (resolved !== targetPath && PROTECTED_BASENAMES.some((re) => re.test(resolved))) return true;
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
