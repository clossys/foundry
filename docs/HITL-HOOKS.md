# HITL escalation rule -- the deny hook

This is **the deny hook** the ratified escalation rule's own closing
clause names, alongside the rule file (`docs/HITL-RULE.md`), when it says
"Agents can't write to the rule file or the deny hook." `docs/HITL.md`
(the living implementation-mapping and gate documentation) links here
rather than containing this material itself, for the same reason
`docs/HITL-RULE.md` exists as its own file: so that an ordinary edit to
`docs/HITL.md`'s other, considerably longer content never needs
owner-only review the way a change to the hook's own definition does.

**This file, `scripts/hooks/deny-tier2.mjs`, and `scripts/hooks/deny-tier2-edit.mjs`
are classified tier-2** by `governance/review-tiers.json`'s `tier2.globs`
(#1187 escalation-rule round 4, both reviewers, blocking: round 3 moved the
ratified rule's own text into a tier-2 file but left the hook that is
supposed to enforce write-protection for it defined only in tier-1
`docs/HITL.md` -- a two-ordinary-reviewer change could have silently
dropped `docs/HITL-RULE.md` from the protected-path list, and the owner
would have installed or updated from the weakened copy without ever
reaching tier-2 review).

**The two hook scripts are real, tracked, tested files in this
repository** -- `scripts/hooks/deny-tier2.mjs` and
`scripts/hooks/deny-tier2-edit.mjs` -- not markdown code blocks copied by
hand. `scripts/hooks/deny-tier2.test.mjs` and
`scripts/hooks/deny-tier2-edit.test.mjs` spawn each script as a real
subprocess and feed it the same Claude-Code-shaped JSON on stdin a live
`PreToolUse` hook receives, checking exit code 2 (block) against every
pattern this document claims is blocked and exit code 0 (allow) against
every pattern this document claims is not -- this is what turns each
independent reviewer's own by-hand verification, every round so far, into
something this repository checks on every push instead. This document
deliberately does **not** re-embed either script's source: two copies
that must be kept in sync by hand is exactly the class of drift this
round is fixing elsewhere (see "Implementation of 'Changing this rule
itself'" in `docs/HITL-RULE.md`), so the tracked files under
`scripts/hooks/` are the single source of truth, and this document only
describes them and how to install them.

## What it does and does not block

Both scripts are a Claude Code **user-level** `PreToolUse` hook example.
The Bash-matched one (`deny-tier2.mjs`) blocks a fixed, named list of
command shapes that are always tier-2 (credentials, deployment approval,
repository/branch-protection settings, publish, and destructive
force-pushes or branch deletes) at the tool layer, before the command
runs, PLUS a best-effort, Bash-command-text write-protection pass over a
fixed list of protected paths. The Edit-matched one (`deny-tier2-edit.mjs`)
blocks `Edit`, `Write`, `MultiEdit`, and `NotebookEdit` calls whose own
`file_path` (or, for `NotebookEdit`, `notebook_path`) targets one of the
same protected paths. Both are seatbelts: they run inside the same
permission boundary as every other tool call a session issues, in files a
session with shell or Edit-tool access could in principle edit. Their
value is catching an *accidental* tier-2 command or edit a session didn't
mean to make, not resisting a session that has decided to defeat them.

**This repository does not install either hook, anywhere, for anyone.**
No commit in this pull request adds either to `.claude/settings.json`
(repo-scoped) or any other tracked file. They are documented here, as an
example the owner may copy into their own **user-level** settings if they
choose to.

The protected paths, for both hooks, are: `docs/HITL-RULE.md` (the rule
file), this document (`docs/HITL-HOOKS.md`), `governance/decisions/hitl-escalation-rule*.json`
(the rule's decision record and any superseding successor record,
matching the tier-2 glob), `scripts/hooks/deny-tier2.mjs` and
`scripts/hooks/deny-tier2-edit.mjs` (each protects the other), and
`~/.claude/settings.json` and `.claude/settings.local.json` (either of
which can register or disable a hook -- protecting the scripts without
protecting either settings file that controls them would not be real
protection at all).

**THIS IS BEST-EFFORT AND HONOUR-SYSTEM, NOT REAL WRITE-PROTECTION --
STATED PLAINLY RATHER THAN CLAIMED OTHERWISE.** Measured directly against
the patterns in `scripts/hooks/deny-tier2.test.mjs`, ALL of the following
are ALLOWED, not blocked, against any protected path:

- `git checkout <ref> -- <path>` or `git restore --source=<ref> <path>`
  (restoring a file from history is not, itself, one of the matched
  verbs)
- `python3 -c "open(path,'w')…"`, `node -e "writeFileSync(path,…)"`, or any
  other interpreter one-liner -- this hook only ever matches shell
  command TEXT, never what a spawned interpreter then does
- A path held in a shell variable set on a previous line (`F=hitl-escalation-rule.json;
  echo x > "$F"`) -- the pattern never sees the literal filename on the
  matched line at all
- `chmod 000 <hook script>` or `ln -sf /tmp/x <hook script>` -- neither
  writes the file's own bytes, so neither matches a write-verb pattern,
  but both can still defeat the hook (permission-denied or a redirected
  symlink)
- `tee <path> </tmp/input` (writing to the path but reading its OWN input
  from a redirected file rather than a pipe) -- `tee`'s destination-anchor
  requires the path to be the LAST token before a command separator or
  end of line; anything trailing it, including its own input redirection,
  is missed
- `cp` or `tee` writing to a protected settings file FROM a longer path
  whose own basename happens to also match -- an edge case of the same
  basename-only matching every pattern in this hook already accepts as a
  tradeoff
- **Either hook script simply being MISSING** -- deleted, never installed,
  or misspelled in `~/.claude/settings.json`'s own `command` field.
  Claude Code does not error when a configured hook command's target file
  does not exist; it just doesn't run that hook, silently, so every
  pattern in this document goes inactive with no warning to the session
  or the owner. Nothing in either script can detect its own absence --
  the sole mitigation is periodically re-verifying, per the install steps
  below, that both hooks still fire.

**Claude Code's own Edit, Write, MultiEdit, and NotebookEdit tools are
NEVER matched by a `Bash`-matcher hook at all** -- not narrowed to them
being "intentional", simply true: a `PreToolUse` hook only sees the tool
calls its own `matcher` names. For `docs/HITL.md` (tier-1, not protected
by either hook at all -- an ordinary Edit-tool change to it is the
NORMAL, PR-reviewed path a legitimate change already takes), that is
fine. For the protected paths above, the stakes are higher (owner-only,
not ordinary review), which is exactly what `deny-tier2-edit.mjs` exists
to cover: it checks `tool_input.file_path` (for `Edit`/`Write`/`MultiEdit`)
and `tool_input.notebook_path` (for `NotebookEdit`) **independently,
whenever either is present** -- not one as a fallback from the other, so
a payload that happens to carry a harmless `file_path` alongside a
protected `notebook_path` still blocks.

**Real write-protection needs something no hook running inside the same
session can provide**: OS-level file permissions set by the owner, on a
different user account than the one agent sessions run as, or the
signed-commit verification `docs/HITL-RULE.md`'s "Where I'm pushing back"
section describes as the eventual end state. Until either exists, every
pattern in this document -- old and new -- is a deterrent against an
ACCIDENTAL tier-2 command or edit, not a barrier a session that has
decided to defeat it cannot cross.

It does **not** block, and an owner relying on it should know this:

- Any of the above run through a wrapper script, a Makefile target, `npm
  run <script>` that shells out to one of these commands, or any other
  indirection the regex list does not literally match.
  `git push --force-with-lease` is deliberately not blocked at all.
- The same actions performed through the GitHub web UI, a different tool
  entirely (Claude in Chrome, a browser), or any MCP server with its own
  credentials.
- A plain `gh pr merge` (no `--admin`) or a direct push to a branch with no
  force flag -- this hook is about the specific always-tier-2 command
  *shapes* above, not a general merge gate; `scripts/land-stack.mjs` is
  the merge gate, and it has its own, separately documented, skip paths
  (see `docs/HITL.md`'s "Where each tier is enforced").
- Anything typed directly into a terminal outside a Claude Code session, or
  run by a different agent or human entirely.
- The full list of bypasses just enumerated above, for the write-protection
  patterns specifically.

## Round 4 fixes (this pull request)

Measured directly, by `scripts/hooks/deny-tier2.test.mjs`, against both
the newly fixed patterns and everything that already worked:

- `sed --in-place`, `sed --in-place=SUFFIX`, `sed -E -i`, and `sed -n -i`
  now block -- round 3's pattern only matched `-i` immediately after
  `sed`, with no other flags in between, and never matched the GNU long
  form at all.
- `perl -i -pe` (the in-place flag as its own token, rather than combined
  as `-pi`) now blocks, in either flag order.
- `mv <protected> /tmp/x` and `git mv <protected> x` -- the protected path
  as `mv`'s SOURCE argument, moving it away rather than overwriting it --
  now block. Round 3 anchored `cp`/`mv`/`tee` to their LAST argument
  specifically to fix a `cp <protected> /tmp/x` false positive (reading
  FROM the file), but that anchor also stopped matching `mv`'s source
  position, since moving a file removes it from there just as surely as
  `rm` would. `cp` and `tee` keep the last-argument-only anchor (reading
  FROM a file with either is legitimate and common); `mv`/`git mv` now
  match the protected path in ANY argument position, since both of a
  `mv`'s two positions are always destructive to that argument.
- `echo x >| <path>` (the noclobber-override redirect) now blocks -- the
  redirect pattern previously matched only a plain `>` or `>>`.
- The missing-hook-script gap described above is newly documented, not
  newly fixed -- there is no pattern-level fix for a hook that silently
  does not run at all.

Round 3's fixes (still true, still tested): `tee`, `cp`, and `mv` writing
TO a protected path (as their destination) are blocked; `dd if=… of=<path>`
(with a flag before `of=`) is blocked; `grep`/`rg` referencing a
write-verb-shaped word before a protected path, and `cp <path> /tmp/x`
(reading FROM the file), are not false-positived.

## Install steps

1. Copy both scripts from this repository as-is: `scripts/hooks/deny-tier2.mjs`
   to `~/.claude/hooks/deny-tier2.mjs`, and `scripts/hooks/deny-tier2-edit.mjs`
   to `~/.claude/hooks/deny-tier2-edit.mjs`. Do not retype or paraphrase
   them -- copy the tracked files. Make both executable:
   `chmod +x ~/.claude/hooks/deny-tier2.mjs ~/.claude/hooks/deny-tier2-edit.mjs`.
2. Open your **user-level** Claude Code settings --
   `~/.claude/settings.json` (create it if it does not exist; this is your
   personal machine-wide settings file, not anything tracked in this or any
   other repository).
3. Add TWO `PreToolUse` hook entries -- one matching `Bash`, one matching
   `Edit|Write|MultiEdit|NotebookEdit`:

   ```json
   {
     "hooks": {
       "PreToolUse": [
         {
           "matcher": "Bash",
           "hooks": [
             {
               "type": "command",
               "command": "node ~/.claude/hooks/deny-tier2.mjs"
             }
           ]
         },
         {
           "matcher": "Edit|Write|MultiEdit|NotebookEdit",
           "hooks": [
             {
               "type": "command",
               "command": "node ~/.claude/hooks/deny-tier2-edit.mjs"
             }
           ]
         }
       ]
     }
   }
   ```

4. Restart or reload Claude Code so it picks up the new user-level setting.
5. Verify the `Bash` hook: ask a session to run `git push --force origin
   main` in any repository. It should be blocked before the command
   executes, with the reason printed above. Also try `git push origin
   :some/branch`, `gh repo edit --description x`, `gh api
   repos/OWNER/REPO/branches/claude/foo/protection`, `gh api -X DELETE
   repos/OWNER/REPO/git/refs/heads/claude/foo`, `echo x >
   governance/decisions/hitl-escalation-rule.json`, `sed --in-place s/x/y/
   ~/.claude/hooks/deny-tier2.mjs`, `perl -i -pe s/x/y/
   ~/.claude/hooks/deny-tier2-edit.mjs`, `mv docs/HITL-RULE.md /tmp/`,
   `sed -i '' /deny-tier2/d ~/.claude/settings.json`, and `echo {} >
   .claude/settings.local.json` to confirm the slash-branch, repo-edit,
   refs-DELETE, both hook scripts', the rule file moved away, and both
   settings files' write-protection cases all block. Then try `cat
   governance/decisions/hitl-escalation-rule.json` and `git diff HEAD --
   docs/HITL-RULE.md > /tmp/d.txt` to confirm plain reads are NOT
   blocked.
6. Verify the `Edit|Write|MultiEdit|NotebookEdit` hook: ask a session to
   edit `docs/HITL-RULE.md` or
   `governance/decisions/hitl-escalation-rule.json` directly with the
   Edit tool (not a shell command). It should be blocked before the edit
   is applied, with the path printed above. Also try a `NotebookEdit`
   call whose `notebook_path` targets one of the protected paths, and a
   call that carries a HARMLESS `file_path` alongside a protected
   `notebook_path` (or vice versa) -- both fields are checked
   independently, so either alone blocks. This is the coverage the
   `Bash`-only hook cannot provide for `~/.claude/hooks/deny-tier2.mjs`,
   `~/.claude/hooks/deny-tier2-edit.mjs`, `~/.claude/settings.json`, and
   `.claude/settings.local.json` specifically, since none of the four
   lives inside a reviewed repository. `docs/HITL.md` itself is NOT
   protected by either hook -- it is tier-1, and an ordinary Edit-tool
   change to it should NOT be blocked; verify that separately if in
   doubt.
7. Periodically re-run steps 5-6. Neither hook can warn you if it stops
   running at all (see "Either hook script simply being MISSING" above) --
   the sole way to know both are still active is to test them.

If you already have other `PreToolUse` hooks configured, add these as
additional entries under their respective `matcher`s rather than replacing
what is there -- Claude Code runs every matching hook.
