# HITL escalation rule -- the deny hook

This is **the deny hook** the ratified escalation rule's own closing
clause names, alongside the rule file (`docs/HITL-RULE.md`), when it says
"Agents can't write to the rule file or the deny hook." `docs/HITL.md`
(the living implementation-mapping and gate documentation) links here
rather than containing this material itself, for the same reason
`docs/HITL-RULE.md` exists as its own file: so that an ordinary edit to
`docs/HITL.md`'s other, considerably longer content never needs
owner-only review the way a change to the hook's own definition does.

**This file, and everything under `scripts/hooks/`, are classified
tier-2** by `governance/review-tiers.json`'s `tier2.globs` (`scripts/hooks/**`,
a directory glob, not four literal filenames -- a new file later added
under this directory, such as a shared helper or a third hook, is tier-2
too, by construction, without needing a separate addition to that list).

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
that must be kept in sync by hand is exactly the class of drift earlier
rounds found repeatedly (see "Implementation of 'Changing this rule
itself'" in `docs/HITL-RULE.md`), so the tracked files under
`scripts/hooks/` are the single source of truth, and this document only
describes them and how to install them.

## The model: an allowlist, not a denylist (round 6)

Rounds 3-5 tried to enumerate every dangerous write verb and flag
combination (`sed -i`, `--in-place`, `-E -i`, `perl -pi`, `-i -pe`, `mv`
vs `cp` anchoring, `dd of=`, `>`, `>>`, `>|`, ...). **Every single round,
two independent reviewers found another one the enumeration missed** --
a denylist of write verbs can never be complete; there is always another
spelling, another flag order, another prefix, another shell construct.
Round 6 replaced that model for protected-path write detection with an
allowlist instead:

1. **Split the command into sub-commands.** Every line; `;`, `&&`, `||`,
   `|`, `(`, `)`, `{`, `}`, and a backtick; a segment beginning with
   `then`/`do`/`else`/`elif` (etc.) has that leading keyword stripped.
   Leading whitespace is stripped from each sub-command, and prefixes --
   `sudo`, `env VAR=...`, `time`, `command`, `nohup`, `xargs` (with its
   own flags), a leading `VAR=value` assignment, and an absolute or
   `\`-escaped binary path (`/bin/rm` or `\rm`) -- are peeled off before
   looking at the verb.
2. **If ANY token in ANY sub-command references a protected path** --
   literally, as a bare filename after a `cd` into its directory
   (basename-only matching naturally covers this), as a glob that COULD
   match one, as a quote-split reconstruction (`docs/HITL-'RULE'.md`), or
   as a `$VAR` whose value this hook cannot resolve -- **that sub-command
   is allowed ONLY if its verb is on a small, closed, read-only
   allowlist**: `cat`, `less`, `more`, `head`, `tail`, `grep`/`egrep`/
   `fgrep`/`rg`, `wc`, `diff`, `cmp`, `file`, `stat`, `ls`, `git show`/
   `log`/`diff`/`blame`/`cat-file`, `jq` without `-i`/`--in-place`, `node
   --check`/`-c`, and `cp`/`rsync` only when the protected path is a
   SOURCE argument, never the destination. **Every other verb --
   including one this hook has never seen before -- is BLOCKED.** This is
   what "fails closed on unknown verbs" means: the previous model treated
   an unrecognized verb as safe by default; this one treats it as unsafe
   by default.
3. **Separately, recursive or destructive operations on an ANCESTOR
   directory of a protected path are blocked**, even when no protected
   basename is named on the command line at all: `rm -r`/`-rf`, `git rm
   -r`, `git clean` (forced), `git checkout`/`restore`/`reset`/`stash` of
   an ancestor pathspec, `mv`/`git mv` of an ancestor, `rsync --delete`
   into an ancestor, and `ln -s` aliasing an ancestor. The ancestor set is
   `docs`, `governance`, `governance/decisions`, `scripts`,
   `scripts/hooks`, and `.claude` -- the literal parent directories of
   today's protected files, not an arbitrary or growing list, so
   `rm -rf dist` or `rm -rf node_modules` are unaffected.
4. **A `>`/`>>`/`>|` redirect target is ALWAYS a write**, unconditionally,
   whatever the sub-command's own verb is -- `cat /tmp/x > docs/HITL-RULE.md`
   blocks even though `cat` is otherwise read-only, because here it is
   being used as a write instrument. Conversely, **a `<` (or `<<`) target
   is ALWAYS a read** and is exempt from the read-only-verb requirement
   entirely -- `tee /tmp/out < docs/HITL-RULE.md` only reads the protected
   file and writes an unrelated one, so it is allowed (#1187
   escalation-rule round 6, fresh final reviewer, non-blocking N3: this
   was a false positive under the old anchor-based model).
5. **The Edit hook resolves symlinks before comparing** (coordinator
   instruction (d)): `deny-tier2-edit.mjs` calls `realpathSync` on the
   target path (falling back to resolving only the existing portion of
   the path, via its parent directory, when the target does not exist
   yet) and checks the RESOLVED path against the protected basenames too,
   not only the path string Claude Code passed. A symlink alias under an
   unrelated name, or reached through a symlinked ancestor directory,
   still resolves to the real protected file and still blocks.

This is **deliberately more conservative than rounds 3-5**: a verb that
was previously allowed because no denylist pattern happened to match it
-- `perl -Mstrict -ne 'print' <path>` (no `-i`, effectively read-only in
practice), `sed -n '1,5p' <path>`, `git checkout <ref> -- <path>`, `chmod
000 <path>` -- is now BLOCKED, because `perl`, `sed`, `chmod`, and `git
checkout` are simply not on the small read-only allowlist. That is the
point of the redesign, not an accident: a hand-picked "these flags of
this verb are safe" carve-out is exactly the kind of enumeration that
kept needing another round's fix.

**Note (round 6, coordinator's own naming):** an `$VAR` this hook cannot
resolve counts as a protected-path reference for ANY non-read-only verb,
even when the variable's actual value has nothing to do with any
protected path -- this hook cannot tell the difference from the command
text alone, and treats "unprovable" the same as "yes" for that check. An
owner who finds this too aggressive in practice for their own workflow
should say so; the fix is a narrower rule, not silently reverting to the
denylist model this round replaced.

This is deliberately **not** a full POSIX shell parser -- see "What it
does not block" below for what that limits.

## What it does and does not block

Both scripts are a Claude Code **user-level** `PreToolUse` hook example.
The Bash-matched one (`deny-tier2.mjs`) blocks a fixed, named list of
command shapes that are always tier-2 (credentials, deployment approval,
repository/branch-protection settings, publish, and destructive
force-pushes or branch deletes) at the tool layer, before the command
runs, PLUS the allowlist-based protected-path write detection described
above. The Edit-matched one (`deny-tier2-edit.mjs`) blocks `Edit`,
`Write`, `MultiEdit`, and `NotebookEdit` calls whose own `file_path` (or,
for `NotebookEdit`, `notebook_path`) resolves -- after symlinks -- to one
of the same protected paths. Both are seatbelts: they run inside the same
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
matching the tier-2 glob), every file under `scripts/hooks/` (each script
protects the other, and both protect their own tests), and
`~/.claude/settings.json` and `.claude/settings.local.json` (either of
which can register or disable a hook -- protecting the scripts without
protecting either settings file that controls them would not be real
protection at all).

**THIS IS BEST-EFFORT AND HONOUR-SYSTEM, NOT REAL WRITE-PROTECTION --
STATED PLAINLY RATHER THAN CLAIMED OTHERWISE.** This is not a complete
list of what it does not block -- it cannot be, for the same reason the
allowlist model exists at all -- but everything below is measured
directly, in `scripts/hooks/deny-tier2.test.mjs`, and confirmed to still
pass (allowed, not blocked) against every protected path:

- An interpreter one-liner -- `python3 -c "open(path,'w').close()"`,
  `node -e "require('fs').writeFileSync(path,'x')"` -- whose script text
  happens to mention a protected path as a quoted STRING ARGUMENT, not as
  a shell-visible path token. This hook only ever parses shell command
  TEXT; it does not parse or execute the language a spawned interpreter
  then runs, so a path that only exists inside a `-c`/`-e` string is
  invisible to it. `node --check`/`-c` is allowed specifically because it
  does NOT execute the file's code, only checks its syntax; plain `node
  <path>` is blocked, correctly, because it does.
- A path assembled entirely at RUNTIME, inside a script or an
  interpreter's own logic (string concatenation, a config file read at
  execution time, a value returned from another program) rather than
  appearing as a literal, glob, quote-split, or named-variable token in
  the command text this hook actually sees. `echo docs/HITL-RULE.md |
  xargs sed -i` is a partial version of this: the literal path IS visible
  in the `echo` sub-command (a different sub-command from `xargs sed
  -i`), so this hook does not connect the two -- the pipe boundary that
  lets `xargs` inject the path as an argument at runtime is exactly the
  boundary this hook's sub-command model cannot see across. A path given
  to `xargs sed -i` as a literal, static trailing argument instead of via
  the pipe IS caught, since that argument sits directly in the visible
  sub-command text.
- Reading the protected path's content through a means this hook's
  tokenizer does not recognize as referencing it at all -- for example, a
  file descriptor already open before the command runs, or content piped
  in from a process substitution this hook's segment splitter does not
  model precisely.
- `chmod 000 <path>` or `ln -sf /tmp/x <path>` against the **Bash** hook
  specifically are now BLOCKED (round 6: neither verb is on the read-only
  allowlist, so referencing a protected path with either now fails
  closed) -- but permission changes and symlink replacement still do not
  write the file's own bytes, so an owner relying on this hook alone,
  with no OS-level permissions and no signed-commit verification, is
  still trusting a seatbelt, not a lock, against a session that has
  genuinely decided to defeat it.
- **Either hook script simply being MISSING** -- deleted, never installed,
  or misspelled in `~/.claude/settings.json`'s own `command` field. When a
  configured hook's command targets a script that does not exist, Node
  exits non-zero and Claude Code surfaces that as a non-blocking hook
  ERROR rather than hiding it entirely (#1187 escalation-rule round 6,
  fresh final reviewer, non-blocking N2: an earlier draft of this
  document said this happens "silently" -- it does not disappear
  invisibly, but the PRACTICAL effect is the same: the hook does not run,
  and nothing about that error STOPS the command it would have blocked).
  Nothing in either script can detect its own absence from the inside --
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
protected `notebook_path` still blocks -- and resolves symlinks before
comparing either one, per "The model" above.

**Real write-protection needs something no hook running inside the same
session can provide**: OS-level file permissions set by the owner, on a
different user account than the one agent sessions run as, or the
signed-commit verification `docs/HITL-RULE.md`'s "Where I'm pushing back"
section describes as the eventual end state. Until either exists, every
check in this document -- old and new -- is a deterrent against an
ACCIDENTAL tier-2 command or edit, not a barrier a session that has
decided to defeat it cannot cross.

It does **not** block, and an owner relying on it should know this:

- Any always-tier-2 COMMAND-SHAPE (the `gh api`/`npm publish`/`git push
  --force` list, unrelated to protected-path write detection) run through
  a wrapper script, a Makefile target, `npm run <script>` that shells out
  to one of these commands, or any other indirection the regex list does
  not literally match. `git push --force-with-lease` is deliberately not
  blocked at all.
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
- The full list of protected-path bypasses just enumerated above.

## Install steps

**Step 5 below deliberately never runs a real destructive command.**
An earlier draft of this section had the owner run `git push --force`,
delete a remote branch, move the rule file away, and overwrite both
settings files for real, on the theory that the hook would intercept
each one before it took effect -- but the sole thing stopping any of
those from actually happening was the hook itself working correctly,
which is precisely what step 5 exists to find out (#1187 escalation-rule
round 6, fresh final reviewer, blocking B4: if the hook were not
installed, misconfigured, or silently not firing, that check would
force-push the owner's own default branch, delete a real remote branch,
and overwrite real settings, for real). The fix below pipes the exact
same JSON Claude Code would send into each installed script directly and
reads its exit code -- nothing destructive ever runs, whether or not the
hook is working.

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
5. Verify the `Bash` hook WITHOUT running anything destructive -- pipe
   crafted tool-input JSON directly into the installed script and read
   its exit code (`2` = blocked, `0` = allowed):

   ```sh
   echo '{"tool_input":{"command":"git push --force origin main"}}' \
     | node ~/.claude/hooks/deny-tier2.mjs; echo "exit=$?"
   echo '{"tool_input":{"command":"git push origin :some/branch"}}' \
     | node ~/.claude/hooks/deny-tier2.mjs; echo "exit=$?"
   echo '{"tool_input":{"command":"gh api repos/OWNER/REPO/branches/claude/foo/protection"}}' \
     | node ~/.claude/hooks/deny-tier2.mjs; echo "exit=$?"
   echo '{"tool_input":{"command":"echo x > governance/decisions/hitl-escalation-rule.json"}}' \
     | node ~/.claude/hooks/deny-tier2.mjs; echo "exit=$?"
   echo '{"tool_input":{"command":"mv docs/HITL-RULE.md /tmp/"}}' \
     | node ~/.claude/hooks/deny-tier2.mjs; echo "exit=$?"
   echo '{"tool_input":{"command":"rm -rf docs"}}' \
     | node ~/.claude/hooks/deny-tier2.mjs; echo "exit=$?"
   echo '{"tool_input":{"command":"sed -i '\'''\'' /deny-tier2/d ~/.claude/settings.json"}}' \
     | node ~/.claude/hooks/deny-tier2.mjs; echo "exit=$?"
   echo '{"tool_input":{"command":"echo {} > .claude/settings.local.json"}}' \
     | node ~/.claude/hooks/deny-tier2.mjs; echo "exit=$?"
   ```

   All eight should print `exit=2`. Then confirm plain reads still pass
   (`exit=0`):

   ```sh
   echo '{"tool_input":{"command":"cat governance/decisions/hitl-escalation-rule.json"}}' \
     | node ~/.claude/hooks/deny-tier2.mjs; echo "exit=$?"
   echo '{"tool_input":{"command":"git diff HEAD -- docs/HITL-RULE.md > /tmp/d.txt"}}' \
     | node ~/.claude/hooks/deny-tier2.mjs; echo "exit=$?"
   ```

6. Verify the `Edit|Write|MultiEdit|NotebookEdit` hook the same,
   destructive-command-free way:

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

   The earlier three commands above should print `exit=2` (the middle one
   shows `notebook_path` alone is enough even with a harmless `file_path`
   present); the last should print `exit=0` -- `docs/HITL.md` is tier-1,
   not protected.
7. Periodically re-run steps 5-6. Neither hook can warn you if it stops
   running at all (see "Either hook script simply being MISSING" above) --
   the sole way to know both are still active is to test them, this way,
   never by running a command that only the hook would have stopped from
   causing real damage.

If you already have other `PreToolUse` hooks configured, add these as
additional entries under their respective `matcher`s rather than replacing
what is there -- Claude Code runs every matching hook.
