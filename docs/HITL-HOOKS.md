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
`docs/HITL.md`. A local edit or a local shell command only matters once
it is PUSHED, and every push to a protected path goes through tier-2
classification and review regardless of whether either hook below is
installed at all. Text analysis of an arbitrary Bash command can never be
airtight -- there is always another shell construct, another verb,
another indirection -- and a false positive in either hook, since both
are **user-level**, hits every repository on the owner's machine, not
just this one. Given that:

- **The Bash hook (`deny-tier2.mjs`) is OPTIONAL, best-effort defence in
  depth.** It catches an accidental tier-2 shell command before it runs,
  nothing more, and the owner decides whether installing it is worth its
  false-positive risk on unrelated repositories.
- **The Edit hook (`deny-tier2-edit.mjs`) is the RECOMMENDED one of the
  two.** It compares an EXACT path Claude Code itself supplies (not
  parsed or guessed from free-form shell text), so it has none of the
  Bash hook's text-analysis gaps or false-positive surface, and it is
  cheap to install alongside it.

**This file, and everything under `scripts/hooks/`, are classified
tier-2 for PR REVIEW purposes** by `governance/review-tiers.json`'s
`tier2.globs` (`scripts/hooks/**`, a directory glob, not four literal
filenames -- a new file later added under this directory, such as a
shared helper or a third hook, is tier-2 too by construction, without
needing a separate addition to that list). **The two DENY HOOKS
themselves protect a narrower, fixed list of four basenames each**
(`deny-tier2.mjs`, `deny-tier2-edit.mjs`, and their two `.test.mjs`
files, matched literally) -- an `Edit`/`Write` of some hypothetical FIFTH
file later added under `scripts/hooks/`, such as a shared helper module,
would NOT be blocked by either hook, even though it would still need
tier-2 review to be MERGED (#1187 escalation-rule round 7, fresh final
reviewer, N4: an earlier draft of this document conflated the two --
"every file under `scripts/hooks/` is protected" is true of the PR gate,
not of the deny hooks' own protected-path lists).

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
   match one (a bare `*`/`?` with no other literal character is skipped
   -- it gives no discriminating signal, so an ordinary `for f in
   packages/*` loop stays allowed), as a quote-split reconstruction
   (`docs/HITL-'RULE'.md`), or as a `$VAR`/`$( )`/backtick expansion this
   hook cannot resolve AND that leaves nothing concrete in the basename
   position at all -- **that sub-command is allowed ONLY if its verb is
   on a small, closed, read-only allowlist**: `cat`, `less`, `more`,
   `head`, `tail`, `grep`/`egrep`/`fgrep`/`rg`, `wc`, `cmp`, `file`,
   `stat`, `ls`, `find` without `-exec`/`-execdir`/`-delete`/`-fprint`/
   `-fprintf`/`-ok`/`-okdir`, `diff`/`git show`/`log`/`diff`/`blame`/
   `cat-file` without `--output`/`--output=...`, `jq` without
   `-i`/`--in-place`, and `node --check`/`-c` (ONLY as the token
   immediately after `node` -- node stops parsing its own flags at
   the script path) or `node --test` (anywhere). **Every other verb --
   including `cp`/`mv`/`rsync`/`install`, and one this hook has never
   seen before -- is BLOCKED.** This is what "fails closed on unknown
   verbs" means: the previous model treated an unrecognized verb as safe
   by default; this one treats it as unsafe by default.
3. **Separately, recursive or destructive operations on an ANCESTOR
   directory of a protected path are blocked**, even when no protected
   basename is named on the command line at all: `rm -r`/`-rf`, `git rm
   -r`, `git clean` (forced), `git checkout`/`restore`/`reset`/`stash` of
   an ancestor pathspec, `mv`/`git mv` of an ancestor, `rsync --delete`
   into an ancestor, and `ln -s` aliasing an ancestor. The ancestor set is
   `docs`, `governance`, `governance/decisions`, `scripts`,
   `scripts/hooks`, `.claude`, `~/.claude`, and `~/.claude/hooks` -- the
   literal parent directories of today's protected files, not an
   arbitrary or growing list, so `rm -rf dist` or `rm -rf node_modules`
   are unaffected. Every spelling of an ancestor path is normalized
   before comparing: a trailing `/`, a trailing `/.`, a leading `./`,
   doubled slashes, an absolute path (checked by its last one or two
   components), `~`/`$HOME`-relative and the real, resolved home
   directory, and a still-relative operand joined onto the directory a
   preceding `cd` in the SAME command established.
4. **A `>`/`>>`/`>|`/`>&`/`&>` redirect target is ALWAYS a write**,
   unconditionally, whatever the sub-command's own verb is --
   `cat /tmp/x > docs/HITL-RULE.md` blocks even though `cat` is otherwise
   read-only, because here it is being used as a write instrument.
   Conversely, **a `<` (or `<<`) target is ALWAYS a read** and is exempt
   from the read-only-verb requirement entirely -- `tee /tmp/out <
   docs/HITL-RULE.md` only reads the protected file and writes an
   unrelated one, so it is allowed.
5. **A protected path used AS THE COMMAND ITSELF is blocked too** -- most
   commonly an artifact of `$( )`/backtick splitting putting the real
   payload in the verb slot instead of an argument, e.g. `` $(echo rm)
   docs/HITL-RULE.md ``.
6. **The Edit hook resolves symlinks before comparing**: `deny-tier2-edit.mjs`
   calls `realpathSync` on the target path (falling back to resolving
   only the existing portion of the path, via its parent directory, when
   the target does not exist yet) and checks the RESOLVED path against
   the protected basenames too, not only the path string Claude Code
   passed. A symlink alias under an unrelated name, or reached through a
   symlinked ancestor directory, still resolves to the real protected
   file and still blocks.

This is **deliberately more conservative than rounds 3-5**: a verb that
was previously allowed because no denylist pattern happened to match it
-- `perl -Mstrict -ne 'print' <path>` (no `-i`, effectively read-only in
practice), `sed -n '1,5p' <path>`, `git checkout <ref> -- <path>`, `chmod
000 <path>` -- is now BLOCKED, because `perl`, `sed`, `chmod`, and `git
checkout` are simply not on the small read-only allowlist. Round 7
tightens this further: `cp <path> /tmp/x` and `rsync <path> /tmp/x`
(reading a protected path as a SOURCE) were allowed in round 6 as a
special case, "only the LAST argument is the destination" -- but every
operand of `cp`/`mv`/`rsync`/`install` can be a destination (a directory
target, a flag placed after the real destination, `-t`, or
`--remove-source-files` deleting the source), so that special case was
wrong and is now GONE: none of the four is ever treated as read-only
anymore. That is the point of the redesign, not an accident: a
hand-picked "these flags of this verb are safe" carve-out is exactly the
kind of enumeration that kept needing another round's fix. If you need to
read a protected file, use `cat`/`less`/`head`/`tail`/`grep` instead.

**Note (round 6 named this as a known tradeoff; round 7 narrowed it
after it caused real false positives):** round 6's rule treated ANY
unresolved `$VAR` as a protected-path reference for any non-read-only
verb, which blocked routine agent commands -- `gh pr comment ... --body
"$BODY"`, `git -C "$WT" status`, `echo "$HOME"`, `rm -rf "$TMPDIR/foo"`,
a `for f in packages/*` loop -- on every repository on the machine, not
just this one. Round 7 narrows the rule to three refinements, all with
tests in `scripts/hooks/deny-tier2.test.mjs`:

- `$VAR` first resolves against variables assigned earlier in the SAME
  command, then against `process.env` -- the hook runs with the same
  environment a real command would, so `HOME`/`PATH`/`TMPDIR`/`PWD` and
  similar routinely resolve to their real values instead of being
  "unknown" at all.
- An unresolved reference only counts as risky when, after removing it,
  NOTHING concrete is left in the basename position (the unresolved part
  effectively WAS the filename) and the value doesn't end in `/` (a
  directory reference, not a filename) -- `"$S/out.txt"` and `"$OUT/"`
  both stay allowed regardless of what `$S`/`$OUT` resolve to, because
  the CONCRETE part of the token already rules out a protected file;
  a bare `$F` alone does not.
- Even when a reference IS risky by that test, it only blocks for a
  verb this hook already treats as generically write-capable (`rm`,
  `mv`, `cp`, `tee`, `sed`, `perl`, `dd`, `truncate`, `install`, `ln`,
  `rsync`, or a destructive `git` subcommand) -- for every OTHER verb
  (`gh`, `npm`, an unrecognized one, ...) an unresolved reference alone
  is not enough to block. A `for VAR in ITEM1 ITEM2 ...` loop also binds
  `VAR` to a representative literal from its own item list (or to a
  matching one, if the list itself names a protected path), so a later
  `$VAR` in the loop body is resolved instead of treated as unknown.

This still does not make the check precise -- an owner who finds it too
aggressive in practice for their own workflow should say so; the fix is
a narrower rule again, not silently reverting to the denylist model
round 6 replaced.

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
matching the tier-2 glob), the four literal files `scripts/hooks/deny-tier2.mjs`,
`scripts/hooks/deny-tier2-edit.mjs`, and their two `.test.mjs` files
(each script protects the other, and both protect their own tests --
NOT "every file under `scripts/hooks/`"; see the note above), and
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
- **Exec vectors on an otherwise-allowlisted verb** (#1187
  escalation-rule round 7, fresh final reviewer, B1, documented rather
  than fixed -- low value relative to the effort of closing them): `rg
  --pre <cmd>` (runs `<cmd>` as a preprocessor), `LESSOPEN='|<cmd> %s'
  less <path>` (runs `<cmd>` when `less` opens the file), and
  `GIT_EXTERNAL_DIFF=<cmd> git diff` (runs `<cmd>` in place of git's own
  diff engine). Each turns a read-only-looking invocation into an
  arbitrary command execution the hook has no way to see from the
  command text alone.
- **Bulk writes into an ancestor directory that never name a protected
  basename or use one of the "ancestor" verbs in part 3 above** (#1187
  escalation-rule round 7, fresh final reviewer, N1, documented rather
  than fixed): `cp -r src/. docs/`, `rsync -a src/ docs/` (no
  `--delete`, so part 3's rsync check doesn't apply), `tar -xf x.tar -C
  docs`, `unzip -o x.zip -d docs`, `find docs -type f -delete` (a
  `-delete` flag makes `find` itself the destructive verb, outside the
  ancestor-directory model), `ls docs | xargs -I{} rm docs/{}`, `git
  ls-files docs | xargs rm`, and whole-tree git operations that can
  rewrite a protected file without naming it at all -- `git apply`,
  `patch -p1 <diff`, `git stash pop`, `git reset --hard <ref>`, `git
  checkout <ref> -- .`.
- **Shell-in-a-string, where the hook only catches it by coincidence**
  (#1187 escalation-rule round 7, fresh final reviewer, N2, documented
  rather than fixed): `bash -c '...'`, `sh -c "..."`, `zsh -c '...'`,
  `eval '...'`, and `env -S "..."` each hand an entire second command
  line to a nested shell as a STRING argument. This hook does not
  recursively re-parse that string as its own command -- `bash -c 'echo
  x > docs/HITL-RULE.md'` only blocks because the trailing `/` happens to
  leave a matching basename inside the string it never actually parses;
  `bash -c 'echo x > docs/HITL-RULE.md; true'` is allowed, since the
  string as a whole no longer LOOKS like a bare protected-path reference
  to this hook's argument-token scan.
- **A command substitution or backtick expansion embedded INSIDE a
  path**, as opposed to being the whole token (#1187 escalation-rule
  round 7, fresh final reviewer, N3, documented rather than fixed): `echo
  x > docs/$(printf HITL)-RULE.md` is allowed, because `splitCommand`'s
  bare `(`/`)` boundary rule cuts the token at the `$(`, leaving
  `docs/$` (which resolves to nothing recognizable) and `-RULE.md` as
  separate fragments in separate sub-commands, never reassembled into
  the real target path. This is the same class as the "value returned
  from another program" gap already listed below, and a full fix needs
  the parser to recognize `$(`/backtick as an opening marker rather than
  a bare, unconditional boundary character.
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

   The earlier three commands above should print `exit=2` (the third one
   shows `notebook_path` alone is enough to block even with a harmless
   `file_path` also present); the fourth and last should print `exit=0`
   -- `docs/HITL.md` is tier-1, not protected (#1187 escalation-rule
   round 7, fresh final reviewer, N5: an earlier draft of this sentence
   said "the middle one", which actually describes the THIRD command,
   not the second).
7. Periodically re-run steps 5-6. Neither hook can warn you if it stops
   running at all (see "Either hook script simply being MISSING" above) --
   the sole way to know both are still active is to test them, this way,
   never by running a command that only the hook would have stopped from
   causing real damage.

If you already have other `PreToolUse` hooks configured, add these as
additional entries under their respective `matcher`s rather than replacing
what is there -- Claude Code runs every matching hook.
