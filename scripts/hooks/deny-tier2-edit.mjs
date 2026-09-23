#!/usr/bin/env node
// User-level Claude Code PreToolUse hook (Edit|Write|MultiEdit|NotebookEdit
// matcher): deny an edit whose OWN file_path (and, for NotebookEdit, its
// notebook_path) targets one of the same protected paths the Bash hook
// (deny-tier2.mjs) covers by best-effort text matching. This hook is
// EXACT for the path itself -- tool_input.file_path/notebook_path is the
// real path the tool is about to write, supplied by Claude Code itself --
// but the list below still has to be kept in sync with the Bash hook's
// writeProtect() basenames by hand; the two are not generated from one
// shared source.
//
// THIS FILE ITSELF IS TIER-2, same as deny-tier2.mjs -- see that file's
// own header comment.

const PROTECTED_BASENAMES = [
  /hitl-escalation-rule[\w.-]*\.json$/i,
  /HITL-RULE\.md$/i,
  /HITL-HOOKS\.md$/i,
  /deny-tier2\.mjs$/i,
  /deny-tier2-edit\.mjs$/i,
  /settings\.json$/i,
  /settings\.local\.json$/i,
];

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
  // fallback from the other (#1187 escalation-rule round 4, fresh final
  // reviewer, non-blocking N1: an earlier version used file_path when it
  // was any string and fell back to notebook_path only otherwise, so a
  // payload carrying a harmless file_path alongside a protected
  // notebook_path -- a shape the current NotebookEdit schema may never
  // send, but nothing here depends on that -- would exit 0). A single
  // match on EITHER field blocks.
  const candidatePaths = [payload?.tool_input?.file_path, payload?.tool_input?.notebook_path].filter(
    (value) => typeof value === "string" && value.length > 0,
  );
  if (candidatePaths.length === 0) process.exit(0);

  for (const targetPath of candidatePaths) {
    const hit = PROTECTED_BASENAMES.find((re) => re.test(targetPath));
    if (hit) {
      process.stderr.write(
        `Blocked by user-level deny hook (docs/HITL-HOOKS.md, clossys/foundry): editing this path is tier-2 (owner only). Path: ${targetPath}\n`,
      );
      process.exit(2);
    }
  }
  process.exit(0);
});
