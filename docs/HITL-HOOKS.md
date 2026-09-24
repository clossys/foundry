# HITL escalation rule -- the deny hook

This is **the deny hook** the ratified escalation rule's own closing
clause names, alongside the rule file (`docs/HITL-RULE.md`), when it says
"Agents can't write to the rule file or the deny hook." `docs/HITL.md`
(the living implementation-mapping and gate documentation) links here
rather than containing this material itself, for the same reason
`docs/HITL-RULE.md` exists as its own file: so that an ordinary edit to
`docs/HITL.md`'s other, considerably longer content never needs
owner-only review the way a change to the hook's own definition does.

**The control that actually matters is the tier-2 PR gate** --
`governance/review-tiers.json`'s classification plus
`scripts/land-stack.mjs`'s enforcement of it, documented in
`docs/HITL.md`. A local edit only matters once it is PUSHED, and every
push to a protected path goes through tier-2 classification and review
regardless of whether the hook below is installed at all. This hook is
one additional, optional layer on top of that gate, not a substitute
for it.

## The Bash-matched hook was removed (owner decision, 2026-09-23)

An earlier version of this pull request also shipped a **Bash-matched**
`PreToolUse` hook (`scripts/hooks/deny-tier2.mjs`), attempting to parse
arbitrary shell command TEXT and block one that referenced a protected
path. Seven independent review rounds on this pull request -- almost
entirely about that one script -- kept finding either another shell
construct it failed to recognize as a write (a multi-line command, a
prefix, a subshell, a combined flag, `git -C`, `<>`, ANSI-C quoting,
`${VAR:-default}`, a substituted or wrapped command word, ...) or another
ordinary command in some UNRELATED repository that it blocked by mistake
(both hooks are **user-level**, so a false positive there hits every
repository on the machine, not just this one). The owner, presented with
this history in the coordinator chat on 2026-09-23, decided: **"Drop
Bash hook, land rest."** Full decision text: "Remove deny-tier2.mjs from
this PR. Land the rule docs, tier gate, decision records and the
reliable Edit/Write hook after fixing the 4 real issues (anchored
settings match, dangling symlink, rule-text fidelity, owner-record files
-> tier-2). The Bash hook becomes a separate low-priority issue."

Text analysis of arbitrary Bash can never be made complete -- there is
always another construct, another verb, another indirection -- and that
is a structural limit, not a bug this pull request could round-8 its way
out of. The Edit-matched hook below does not have this problem: it
compares an EXACT path string Claude Code itself supplies for the tool
call it is about to make, never shell text it has to parse and guess at.
A possible future, best-effort, OPTIONAL Bash hook is tracked as its own,
low-priority issue (#1405), linking the round 6-8 reviews that found this
history -- see that issue for the reasoning this section only summarizes.
`scripts/hooks/deny-tier2.mjs` and its tests are deleted from this
repository as of this pull request; nothing in `.claude/settings.json`
(or any other tracked file) installs it, and nothing here documents an
install procedure for it anymore.

## The Edit/Write/MultiEdit/NotebookEdit hook

`scripts/hooks/deny-tier2-edit.mjs` is a Claude Code **user-level**
`PreToolUse` hook, matched on `Edit|Write|MultiEdit|NotebookEdit`. It
reads the tool-call JSON Claude Code passes on stdin, checks
`tool_input.file_path` (for `Edit`/`Write`/`MultiEdit`) and
`tool_input.notebook_path` (for `NotebookEdit`) **independently, whenever
either is present** -- not one as a fallback from the other, so a payload
carrying a harmless `file_path` alongside a protected `notebook_path`
still blocks -- against a fixed list of protected basenames, and exits 2
(block) with a reason on stderr for a match, exit 0 (allow) otherwise.

**This repository does not install it, anywhere, for anyone.** No commit
here adds it to `.claude/settings.json` (repo-scoped) or any other
tracked file. It is documented here as an example the owner may copy
into their own **user-level** settings if they choose to.

**This file, and everything under `scripts/hooks/`, are classified
tier-2 for PR REVIEW purposes** by `governance/review-tiers.json`'s
`tier2.globs` (`scripts/hooks/**`, a directory glob, not literal
filenames -- a new file later added under this directory is tier-2 too
by construction, without needing a separate addition to that list).
**The hook itself protects a narrower, fixed list of basenames**
(`deny-tier2-edit.mjs` and its own `.test.mjs`, matched literally) -- an
`Edit`/`Write` of some hypothetical OTHER file later added under
`scripts/hooks/`, such as a shared helper module, would NOT be blocked
by the hook, even though it would still need tier-2 review to be MERGED
(these are two different mechanisms: the hook is a local seatbelt, the
`tier2.globs` classification is what the PR gate actually enforces).

**`scripts/hooks/deny-tier2-edit.mjs` is a real, tracked, tested file in
this repository** -- not a markdown code block copied by hand.
`scripts/hooks/deny-tier2-edit.test.mjs` spawns it as a real subprocess
and feeds it the same Claude-Code-shaped JSON on stdin a live
`PreToolUse` hook receives, checking exit code 2 (block) against every
case this document claims is blocked and exit code 0 (allow) against
every case this document claims is not.

### Protected paths

`docs/HITL-RULE.md` (the rule file), this document (`docs/HITL-HOOKS.md`),
`governance/decisions/hitl-escalation-rule*.json` (the rule's decision
record and any superseding successor record, matching the tier-2 glob),
`scripts/hooks/deny-tier2-edit.mjs` and its own `.test.mjs`, and
`~/.claude/settings.json`/`.claude/settings.local.json` (either of which
can register or disable this hook -- protecting the script without
protecting the settings file that controls it would not be real
protection at all). **The `.claude/settings.local.json` pattern has no
repository scope at all** (#1187 escalation-rule round 9, strong-class
reviewer, non-blocking N2): since this hook runs at the user level, it
blocks an `Edit`/`Write` of `.claude/settings.local.json` in EVERY
repository on the machine, not only this one -- the same reasoning that
already applies to `~/.claude/settings.json` (there is only ever one of
those), stated once more here because the project-scoped file's own
per-repository copy is what this actually stops an agent from editing,
anywhere. Every pattern is anchored to a path boundary (start of string,
or immediately after a `/`), so a coincidental substring match
never counts:

```js
const PROTECTED_BASENAMES = [
  /(^|\/)hitl-escalation-rule[\w.-]*\.json$/i,
  /(^|\/)HITL-RULE\.md$/i,
  /(^|\/)HITL-HOOKS\.md$/i,
  /(^|\/)deny-tier2-edit\.mjs$/i,
  /(^|\/)deny-tier2-edit\.test\.mjs$/i,
  /(^|\/)\.claude\/settings(\.local)?\.json$/i,
];
```

**This anchoring is itself a round-8 fix** (#1187 escalation-rule round
8, both reviewers, blocking B1): an earlier, unanchored version of these
same patterns matched a protected basename as a SUBSTRING anywhere in
the path, so `NOT-HITL-RULE.md` (which merely ENDS with `HITL-RULE.md`)
blocked too, and the settings patterns matched any file literally named
`settings.json`/`settings.local.json` REGARDLESS of its directory -- in
EVERY repository on the machine, since this hook is user-level. That
blocked ordinary, unrelated files: `.vscode/settings.json`,
`app-settings.json`, `usersettings.json`, `test/fixtures/settings.json`.
The settings patterns now require an immediate `.claude/` parent
directory; every other pattern requires the match to start at a real
path-component boundary, not partway through a filename.

### Symlink resolution, including a DANGLING symlink

The hook resolves symlinks before comparing, via `realpathSync`, so a
symlink alias under an unrelated name, or one reached through a
symlinked ancestor directory, still resolves to the real protected file
and still blocks. When the target path cannot be `realpath`'d at all --
either because it genuinely does not exist yet, or because it IS a
symlink whose OWN target does not exist yet either (a "dangling"
symlink, which `realpathSync` can never resolve, no matter how much of
the rest of the path exists) -- the hook falls back to `lstat`ing the
path. If that reveals a symlink, it follows the link's target with
`readlink`, resolved relative to the LINK's OWN directory (not the
caller's working directory), repeating for a chain of links, and tests
the final result. Only if that also fails does it fall back further, to
resolving just the existing portion of the path (its parent directory).

**The dangling-symlink case is itself a round-8 fix** (#1187
escalation-rule round 8, strong-class reviewer, blocking B2): an earlier
version treated a dangling symlink the same as an ordinary not-yet-
existing path -- resolving only the parent directory, then re-appending
the LINK's OWN name (not its target) -- so a symlink literally named
`neutral.json` pointing at `.claude/settings.local.json` (which is
usually absent) was never recognized as protected at all, even though
writing through that alias would have created the real, protected
settings file with that content.

### What it does not block

- **Hard links.** `realpathSync` does not resolve a hard link back to
  the file it shares inode data with; a hard link to a protected path,
  edited under its own separate name, is not recognized as the same
  file. Creating a hard link at all needs a shell `ln` command this
  repository no longer has any hook to catch (see "The Bash-matched hook
  was removed" above).
- **A protected path read or merely mentioned**, since this hook only
  ever sees the exact `file_path`/`notebook_path` Claude Code is about
  to WRITE to -- it is not consulted for a `Read` tool call, a shell
  command that happens to reference a protected path in its output or in
  a string argument, or a GitHub comment body that names one.
- **Everything real write-protection needs and no hook running inside
  the same session can provide**: OS-level file permissions set by the
  owner, on a different user account than the one agent sessions run as,
  or the signed-commit verification `docs/HITL-RULE.md`'s "Where I'm
  pushing back" section describes as the eventual end state. Until
  either exists, this hook is a deterrent against an ACCIDENTAL edit to
  a protected path, not a barrier a session that has decided to defeat
  it cannot cross.
- **The hook script simply being MISSING** -- deleted, never installed,
  or misspelled in `~/.claude/settings.json`'s own `command` field. When
  a configured hook's command targets a script that does not exist, Node
  exits non-zero and Claude Code surfaces that as a non-blocking hook
  error rather than hiding it entirely -- but nothing about that error
  STOPS the edit it would have blocked. Nothing in the script can detect
  its own absence from the inside; the sole mitigation is periodically
  re-verifying, per the install steps below, that it still fires.

## Install steps

**Step 3 below deliberately never runs a real destructive edit.** It
pipes crafted tool-input JSON directly into the installed script and
reads its exit code -- nothing is ever actually written.

1. Copy the script from this repository as-is:
   `scripts/hooks/deny-tier2-edit.mjs` to
   `~/.claude/hooks/deny-tier2-edit.mjs`. Do not retype or paraphrase it
   -- copy the tracked file. Make it executable:
   `chmod +x ~/.claude/hooks/deny-tier2-edit.mjs`.
2. Open your **user-level** Claude Code settings --
   `~/.claude/settings.json` (create it if it does not exist; this is
   your personal machine-wide settings file, not anything tracked in
   this or any other repository) -- and add a `PreToolUse` hook entry
   matching `Edit|Write|MultiEdit|NotebookEdit`:

   ```json
   {
     "hooks": {
       "PreToolUse": [
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

3. Restart or reload Claude Code so it picks up the new user-level
   setting, then verify it without running anything destructive:

   ```sh
   echo '{"tool_input":{"file_path":"docs/HITL-RULE.md"}}' \
     | node ~/.claude/hooks/deny-tier2-edit.mjs; echo "exit=$?"
   echo '{"tool_input":{"notebook_path":"governance/decisions/hitl-escalation-rule.json"}}' \
     | node ~/.claude/hooks/deny-tier2-edit.mjs; echo "exit=$?"
   echo '{"tool_input":{"file_path":"docs/HITL.md","notebook_path":"docs/HITL-RULE.md"}}' \
     | node ~/.claude/hooks/deny-tier2-edit.mjs; echo "exit=$?"
   echo '{"tool_input":{"file_path":"docs/HITL.md"}}' \
     | node ~/.claude/hooks/deny-tier2-edit.mjs; echo "exit=$?"
   ```

   The earlier three commands above should print `exit=2` (the third one
   shows `notebook_path` alone is enough to block even with a harmless
   `file_path` also present); the fourth and last should print `exit=0`
   -- `docs/HITL.md` is tier-1, not protected.
4. Periodically re-run step 3. The hook cannot warn you if it stops
   running at all (see "What it does not block" above) -- the sole way
   to know it is still active is to test it, this way, never by making
   an edit that only the hook would have stopped.

If you already have other `PreToolUse` hooks configured, add this as an
additional entry under `matcher` rather than replacing what is there --
Claude Code runs every matching hook.
