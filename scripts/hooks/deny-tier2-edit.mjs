#!/usr/bin/env node
// User-level Claude Code PreToolUse hook (Edit|Write|MultiEdit|NotebookEdit
// matcher): deny an edit whose OWN file_path (and, for NotebookEdit, its
// notebook_path) targets one of the same protected paths the Bash hook
// (deny-tier2.mjs) covers by best-effort text matching. This hook is
// EXACT for the path itself -- tool_input.file_path/notebook_path is the
// real path the tool is about to write, supplied by Claude Code itself --
// but the list below still has to be kept in sync with the Bash hook's
// PROTECTED_BASENAME_PATTERNS by hand; the two are not generated from one
// shared source.
//
// THIS FILE ITSELF IS TIER-2, same as deny-tier2.mjs -- see
// docs/HITL-HOOKS.md's own header.

import { realpathSync } from "node:fs";
import { dirname, basename } from "node:path";

const PROTECTED_BASENAMES = [
  /hitl-escalation-rule[\w.-]*\.json$/i,
  /HITL-RULE\.md$/i,
  /HITL-HOOKS\.md$/i,
  /deny-tier2\.mjs$/i,
  /deny-tier2-edit\.mjs$/i,
  /deny-tier2\.test\.mjs$/i,
  /deny-tier2-edit\.test\.mjs$/i,
  /settings\.json$/i,
  /settings\.local\.json$/i,
];

// #1187 escalation-rule round 6, coordinator instruction (d): resolve
// symlinks before comparing, so a symlink ALIAS to a protected path (or
// through a symlinked ancestor directory) can't bypass basename matching
// by presenting a different path string for the same real file.
function resolveRealPath(targetPath) {
  try {
    return realpathSync(targetPath);
  } catch {
    // The path doesn't exist yet (e.g. about to be CREATED as a new
    // symlink or a new file) -- resolve as much of it as does exist, so
    // a symlinked ANCESTOR directory still can't alias a protected path
    // for a not-yet-existing target underneath it.
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
    process.exit(0); // fail open on unparseable input, same as the Bash hook
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
