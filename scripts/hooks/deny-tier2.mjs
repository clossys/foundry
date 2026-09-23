#!/usr/bin/env node
// User-level Claude Code PreToolUse hook (Bash matcher): deny the
// always-human (tier-2) command shapes described in docs/HITL-HOOKS.md
// and docs/HITL.md's "Where each tier is enforced" section, in
// clossys/foundry. Reads the tool-call JSON Claude Code passes on stdin;
// exits 2 (block) with a reason on stderr for a match, exit 0 (allow)
// otherwise. This is a SEATBELT, not a lock -- see docs/HITL-HOOKS.md's
// "What it does and does not block" for the named gaps.
//
// THIS FILE ITSELF IS TIER-2 (#1187 escalation-rule round 4, both
// reviewers, blocking): the ratified rule's "Changing this rule itself"
// clause says plainly that "Agents can't write to the rule file or the
// deny hook" -- when this script's body lived only as a markdown code
// block inside docs/HITL.md (tier-1, round 3), a two-ordinary-reviewer
// change could silently weaken it. `governance/review-tiers.json`'s
// `tier2.globs` now names this file, its sibling deny-tier2-edit.mjs,
// and their tests explicitly, and both are covered by the protected-path
// lists below (each protects the other, and both protect
// docs/HITL-RULE.md and docs/HITL-HOOKS.md).

// Builds write-protection patterns for one protected file, matched by
// BASENAME alone (so a relative-path or cd'd-into-the-directory command
// still matches).
function writeProtect(basenamePattern) {
  const path = `(?:\\S*/)?${basenamePattern}\\b`;
  const cmdStart = "(?:^|[&;|]\\s*)"; // the verb must start a command
  const gap = "[^&;|\\n]*"; // flags/args only, never crossing a command separator
  const flagGap = "(?:\\s+\\S+)*?"; // other flag tokens before the one we care about, non-greedy

  return [
    // sed -i / sed --in-place, wherever the flag token falls among sed's
    // other flags (#1187 escalation-rule round 4, fresh final reviewer,
    // blocking: round 3's "sed\s+-i" pattern required -i to come
    // IMMEDIATELY after "sed", missing `sed -E -i`, `sed -n -i`, and the
    // GNU long form `sed --in-place`/`sed --in-place=.bak`).
    new RegExp(`${cmdStart}sed\\b${flagGap}\\s+(?:-i\\S*|--in-place\\b(?:=\\S*)?)\\b${gap}${path}`, "i"),
    new RegExp(`${cmdStart}(?:truncate|rm|git\\s+rm|install)\\b${gap}${path}`, "i"),
    // perl -i, alone or combined with other short flags in either order
    // (`perl -pi`, `perl -i -pe`, `perl -ip`) -- round 3 only matched the
    // single literal spelling "perl -pi" (#1187 escalation-rule round 4,
    // fresh final reviewer, blocking). The flag alphabet is deliberately
    // narrow (only letters perl one-liners commonly combine with -i) so
    // this does not false-positive on an unrelated flag that merely
    // CONTAINS the letter i, such as `-Mstrict`.
    new RegExp(`${cmdStart}perl\\b${flagGap}\\s+-[pnewla]*i[pnewla]*\\b${gap}${path}`, "i"),
    // dd's "of=" can follow other flags ("dd if=/tmp/x of=<path>"), not
    // only appear directly after "dd".
    new RegExp(`${cmdStart}dd\\b${gap}\\bof=${path}`, "i"),
    // cp/tee: only their LAST argument is the real destination -- a
    // protected path named earlier is being READ, not written
    // (`cp <protected> /tmp/x`).
    new RegExp(`${cmdStart}(?:cp|tee(?:\\s+-a)?)\\b${gap}${path}\\s*(?=$|[&;|])`, "im"),
    // mv/git mv: the protected path is destroyed at its OLD location even
    // when it is only the SOURCE argument, so -- unlike cp/tee above --
    // match it in ANY argument position (#1187 escalation-rule round 4,
    // both reviewers, blocking: round 3's last-argument-only anchor,
    // added to fix the cp/tee false positive, silently let
    // `mv <protected> /tmp/` and `git mv <protected> x` through too).
    new RegExp(`${cmdStart}(?:mv|git\\s+mv)\\b${gap}${path}`, "i"),
    // A plain overwrite (`>`), an append (`>>`), or the noclobber-override
    // form (`>|`) immediately before the path (#1187 escalation-rule round
    // 4, fresh final reviewer, blocking: `>|` was not matched at all).
    new RegExp(`(?:>>|>\\|?)\\s*${path}`, "i"),
  ];
}

const DENY_PATTERNS = [
  /\bgh\s+api\b[^\n]*\/pending_deployments\b/i,
  /\bgh\s+api\b[^\n]*\/rulesets\b/i,
  /\bgh\s+api\b[^\n]*\/environments\b/i,
  // branches/<branch>/protection -- <branch> can itself contain a "/"
  // (e.g. claude/foo), so this must NOT stop at the first slash the way
  // [^/\s]+ would.
  /\bgh\s+api\b[^\n]*\/branches\/\S+\/protection\b/i,
  // Deleting a branch via the raw Git refs API instead of `git push
  // --delete` -- a second way to the same always-tier-2 end this hook's
  // git-push patterns below do not see at all. Matches both gh's short
  // (`-X`) and long (`--method`) form.
  /\bgh\s+api\b[^\n]*(?:-X|--method)\s+DELETE[^\n]*\/git\/refs\/heads\/\S+/i,
  /\bgh\s+secret\s+set\b/i,
  /\bgh\s+repo\s+edit\b/i,
  /\bgh\s+pr\s+merge\b[^\n]*--admin\b/i,
  /\bnpm\s+publish\b/i,
  /\bnpm\s+unpublish\b/i,
  /\bnpm\s+dist-tag\b/i,
  // --force, or a standalone -f token, but not --force-with-lease.
  /\bgit\s+push\b[^\n]*(--force(?!-with-lease)\b|(?:^|\s)-f\b)/i,
  // A "+refspec" force-push shorthand anywhere after "git push".
  /\bgit\s+push\b[^\n]*\s\+\S+/,
  // "--delete <branch>", or ":branch" (including a slash-named branch).
  /\bgit\s+push\b[^\n]*(--delete\b|\s:\S+)/i,
  // Write-protection: the escalation rule's own file (docs/HITL-RULE.md),
  // this hook's own definition (docs/HITL-HOOKS.md, and both hook
  // scripts themselves), the rule's decision record and any superseding
  // successor record (hitl-escalation-rule*.json, matching the tier-2
  // glob), and the settings files that register or disable either hook --
  // BEST-EFFORT, honour-system, Bash-command-text matching only. See
  // docs/HITL-HOOKS.md's "What it does and does not block" for the full
  // list of known bypasses this cannot catch.
  ...writeProtect("hitl-escalation-rule[\\w.-]*\\.json"),
  ...writeProtect("HITL-RULE\\.md"),
  ...writeProtect("HITL-HOOKS\\.md"),
  ...writeProtect("deny-tier2\\.mjs"),
  ...writeProtect("deny-tier2-edit\\.mjs"),
  // "settings.json" and "settings.local.json" are matched by bare
  // basename, deliberately broader than only the `.claude/` versions of
  // each -- a false positive here (blocking an unrelated settings write)
  // is cheap; missing the one write that disables this hook, at either
  // project or user scope, is not. `.claude/settings.local.json` is a
  // SEPARATE basename from `settings.json`: Claude Code can register or
  // disable hooks there too (e.g. via `disableAllHooks`).
  ...writeProtect("settings\\.json"),
  ...writeProtect("settings\\.local\\.json"),
];

let input = "";
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", () => {
  let payload;
  try {
    payload = JSON.parse(input);
  } catch {
    process.exit(0); // fail open on unparseable input -- this hook only ever narrows, never widens, so unparseable input is not this hook's problem to solve
  }
  const command = typeof payload?.tool_input?.command === "string" ? payload.tool_input.command : "";
  if (!command) process.exit(0);

  const hit = DENY_PATTERNS.find((re) => re.test(command));
  if (hit) {
    process.stderr.write(
      `Blocked by user-level deny hook (docs/HITL-HOOKS.md, clossys/foundry): this command shape is tier-2 (owner only). Pattern: ${hit}\n`,
    );
    process.exit(2);
  }
  process.exit(0);
});
