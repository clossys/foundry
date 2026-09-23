# Human-in-the-loop escalation: first slice

This is the first slice of the agent decision/HITL escalation design agreed
at tier 1: the orchestrator's proposal at issue
[#1187](https://github.com/clossys/foundry/issues/1187), the decision-tier
rule at
[#1187 comment 5800142871](https://github.com/clossys/foundry/issues/1187#issuecomment-5800142871),
and the independent Fable second opinion at
[#1187 comment 5800683025](https://github.com/clossys/foundry/issues/1187#issuecomment-5800683025).
An independent review at `8e6d97ea`
([#1329 comment 5801039847](https://github.com/clossys/foundry/pull/1329#issuecomment-5801039847))
found several logic gaps in the first draft of this slice, not just
honour-system limits; this document and `scripts/land-stack.mjs` were
revised to close them, and every place a gap remains is named explicitly
below rather than left implicit. It covers scripts and governance only — no
`packages/*` code changed, no version bump, no CI workflow added or changed.

## The three tiers

The decision-tier rule (#1187 comment 5800142871) defines three tiers of
agent decision:

- **Tier 0 — act autonomously.** Reversible, inside established rules,
  verified by gates: ordinary code in author lanes, reviews, merges under the
  existing merge-train rules, mechanical conflict resolution, cancelling or
  re-running CI, closing issues with PR evidence, worktree/temp cleanup.
- **Tier 1 — independent second opinion, then act on consensus.** Decisions
  that change a gate, policy, or process; conflict resolution beyond the
  mechanical whitelist; anything where the proposing agent would benefit from
  the outcome; design choices between real options. Needs a first reviewer
  plus a stronger-model second opinion, both testing the change adversarially,
  neither the author. If both recommend acceptance with no unresolved
  finding, act; if they disagree or either says reject, escalate to the
  owner.
- **Tier 2 — owner only (HITL).** Credentials and two-factor steps,
  repository settings/rulesets/required checks/environments, irreversible
  external actions (publishing, deprecating, one-way version-scheme
  changes), spending money or changing plans, business/strategy/priority
  trade-offs, and anything the owner has explicitly reserved.

This slice enforces tier-1 and tier-2 classification for **pull requests
merged through this repository's own merge-train conductor**
(`scripts/land-stack.mjs`). It does not touch CI. See "Where each tier is
enforced" below, and see "What this gate does not cover at all" for the
paths that skip it entirely.

## Where each tier is enforced

| What | Where | How |
|---|---|---|
| Tier-1 / tier-2 path classification | `governance/review-tiers.json` | Path globs, read by `land-stack.mjs` from the pull request's **base commit** via the GitHub Contents API (`repos/{owner}/{repo}/contents/{path}?ref={baseSha}`) — never from the local checkout — so a pull request can never narrow its own tier-1 globs or add its own decision record in the same diff it needs graded. |
| Self-inclusion | This file, `scripts/land-stack.mjs` (and its test), `docs/contracts/decision-record.json`, `scripts/check-decision-records.mjs` (and its test), `package-scope.json`, and `scripts/lib/**` are all **tier-2**, not tier-1 — a tier-1 change (two agent reviewers) could otherwise narrow `tier2.globs` (for example, drop `governance/model-qualifications/**` from it) and remove the owner-only boundary without the owner. |
| `governance/decisions/**` classification | `governance/review-tiers.json`'s `tier1RecordExempt` | **Tier-1, not tier-0.** Adding or changing any decision record needs the same two-independent-reviewer bar as any other governance path — closing a self-issue-then-spend loophole (see "What changed after the 8e6d97ea review" below). |
| Tier-1 review requirement | `scripts/land-stack.mjs`'s `evaluateTier1Independence` | Reads `foundry-review-record` comments (`docs/contracts/review-record.json`) on the pull request at its exact current head. Requires exactly one author record; refuses immediately (never outvoted) if any independent reviewer's state is `reject` or `changes-requested`; otherwise requires one `primary` and one `secondary` record, both `state: "approved"` (`"commented"` never counts), differing in model or provider. |
| Tier-2 owner-decision requirement | `scripts/land-stack.mjs`'s `evaluateTier2Decision` | Reads decision records from the pull request's base commit for one that is itself schema-valid, `tier: "tier-2"`, `status: "decided"`, `decidedBy: "owner"`, not superseded, not a relaxation past its sunset, unexpired (an unparseable `expiry` counts as expired), and linked to the PR by number or by a non-overbroad path glob. |
| Changed-decision-record validation | `scripts/land-stack.mjs`'s `evaluateChangedDecisionRecords`, reusing `scripts/check-decision-records.mjs`'s own `validateDecisionRecordShape` | Runs on **every** pull request, any tier: any `governance/decisions/**` file the PR adds or edits must be schema-valid, checked against its content at the PR's own **head** commit. |
| Changed-file completeness | `scripts/land-stack.mjs`'s `verifyChangedFilesComplete` | Files are paginated directly against `repos/{owner}/{repo}/pulls/{n}/files` (never `gh pr view --json files`, which silently truncates at 100 entries) and cross-checked against the PR's own `changedFiles` count; an empty or short list refuses the merge rather than classifying blind. |
| Merge-time head match | `gh pr merge --match-head-commit <sha>` in `runMerge` | Closes the window between the status check above and the actual merge call — a push landing in between is refused rather than silently merged uncovered by any of the checks above. |
| Decision log | `governance/decisions/*.json` | Append-only; one file per decision; validated by `node scripts/check-decision-records.mjs` (run by hand — see that script's own header for why it is not a `check:*` npm script yet) and, for any record a pull request itself touches, inline inside the merge-train gate (see above). |
| Reviewer model qualification (draft) | `governance/model-qualifications/allowlist.json` | Every row is `status: "proposed"` until the owner approves it. **`land-stack.mjs` does not read this file or report on it at all in this slice** — an earlier draft of this document claimed it did; that was wrong and has been removed. Wiring model-qualification reporting or enforcement into the gate is a later slice's work. |
| Always-human commands | This document's deny-hook example below | **Not installed anywhere in this repository.** The owner installs it at Claude Code's user level, on their own machine, if they choose to. It is a seatbelt with named gaps — see "What it does and does not block" below. |

This is deliberately **not** a CI workflow. AGENTS.md's own rule —
"Model-assisted code review is manually initiated. Do not add a background
model reviewer or make repository workflows wait for provider-specific
review evidence" — stays true word for word: no workflow reads any of the
files above, no workflow calls a model, and no workflow waits on anything.
The tier-1/tier-2 bar applies only inside the merge-train conductor a
contributor runs from their own machine with their own authenticated `gh`.

**A plain `gh pr merge`, run directly with no `--status`/`--merge` flag
through `land-stack.mjs`, or a merge performed through the GitHub web UI,
skips this entire gate.** Nothing in this slice prevents either — the gate
is code a contributor chooses to run, not a server-side check GitHub itself
enforces. The only way to make it unconditional is a required status check
computed by a workflow, which is precisely the CI-workflow shape AGENTS.md's
rule rules out for model-review evidence; this slice accepts that trade
rather than working around the rule it is trying to honor.

## What changed after the 8e6d97ea review

An independent review found the first draft of this slice weaker than both
the cited decision-tier rule and this document's own text, in ways that were
implementation bugs, not disclosed honour-system limits. Fixed in this
revision:

- A rejecting or changes-requested reviewer was silently outvoted by a later
  approving pair. It is now checked first and refuses the merge
  unconditionally, matching "a reject is never outvoted."
- A `"commented"` review counted as an approval, and reviewer depth
  (`primary`/`secondary`) was never checked, so two `primary` approvals
  passed. Both are now enforced.
- `gh pr view --json files` silently truncates at 100 changed files —
  measured directly against real merge-train PRs over that size. File
  fetching now paginates the real Pulls API and refuses to classify on an
  incomplete or empty list.
- `governance/decisions/**` was tier-0 (no review of any kind), so a session
  could add a self-authorizing `decidedBy: "owner"` decision record with
  zero review, then spend it on a real tier-2 change in a later PR. It is
  now tier-1, and `evaluateTier2Decision` additionally refuses a record that
  is itself malformed, superseded, past its sunset, not `tier: "tier-2"`, or
  whose `expiry` fails to parse.
- Tier config and decision records were read from the local checkout, which
  a merge-train or restack worktree — or a pull request's own branch — can
  contain. They are now read from the pull request's base commit via the
  GitHub API.
- Three backfilled decision records stated things their cited sources did
  not show (one had an invented comment link; two described in-progress or
  not-yet-approved work as decided). All three are corrected — see their own
  `notes` fields for exactly what changed and why.

The independent review's own full text
([#1329 comment 5801039847](https://github.com/clossys/foundry/pull/1329#issuecomment-5801039847))
is the authoritative account of every finding; this section summarizes it,
not the reverse.

## Honour-system limits — stated plainly

Every mechanism in this slice can be defeated by the thing it constrains,
because every agent session in this repository authenticates as **the same
GitHub account — the owner's own**. This is not a hidden gap; it is worth
being explicit about exactly where the honesty boundary sits. (Distinct from
the section above: everything here is a limit this design accepts on
purpose, not a bug it missed.)

- **`foundry-review-record` comments are trust-but-verify, not
  forgery-proof.** Nothing stops a session from posting two records under
  two different `instanceId`s for its own change. What raises the real cost
  of doing that is binding: a record must carry the pull request's *exact*
  current `headSha` (a stale record is dropped, never trusted), a distinct
  `instanceId` from the declared author record, a `model`/`provider` pair
  that genuinely differs, and the required primary/secondary depth pairing.
  Faking all of that *consistently*, across two records, is more work than
  actually running the second review — but it is not impossible, and this
  slice does not claim otherwise.
- **A comment edited after it was posted is dropped, not specially
  detected as suspicious.** `parseReviewRecordComments` compares a GitHub
  comment's `created_at` and `updated_at`; if they differ, every
  `foundry-review-record` block in that comment is treated as invalid and
  ignored entirely, the same as an unparseable one. This closes the specific
  gap of a reviewer approving, then quietly rewriting their verdict after
  the fact — but it is a blunt instrument: a comment edited only to fix a
  typo is discarded exactly as hard as one whose verdict changed, and the
  discarded record is not otherwise flagged as suspicious.
- **`relaxesGateOrPolicy` on a decision record is self-declared.** Nothing
  verifies that a record's own characterization of its change (whether it
  loosens a real control) matches what the change actually does. A record
  can declare `false` to avoid the sunset requirement while, in substance,
  relaxing something. See `docs/contracts/decision-record.json`'s own note
  on this field for the same point.
- **The decision log is append-only by convention, not by mechanism.**
  Nothing outside ordinary git history prevents a session from editing a
  past `governance/decisions/*.json` file directly. `scripts/check-decision-
  records.mjs` validates shape, expiry, and sunset, but it does not (yet)
  verify that a file's content matches what a prior commit actually said.
- **The tier-2 owner-decision requirement can be satisfied by a session
  writing its own decision record and claiming `decidedBy: "owner"`.**
  `governance/decisions/**` is now tier-1 (two independent reviewers), which
  raises the bar from "zero review" to "two reviewers, neither the owner,
  approving a record that claims owner authority" — a durable, reviewable,
  committed artifact that says something false, not a private lie. It does
  not make the claim itself unforgeable: nothing in this slice
  cryptographically ties a decision record to the owner's real identity.
- **The one identity mechanism agents genuinely cannot forge is a
  hardware-backed, owner-signed commit.** An agent's commits in this
  repository are unsigned; the owner's real signing key needs a physical
  touch or passphrase no session holds. A future slice could require every
  commit touching a tier-2 path to verify against
  `governance/allowed-signers` (checked on the pull request's head commits,
  not the merge commit — GitHub signs merge commits with its own web-flow
  key, which would defeat the point). **This is optional and not
  implemented in this slice** — it needs the owner to set up a hardware key
  and a signers file first. Until then, every control described above is
  honour system: it structures and raises the cost of dishonesty, and
  leaves a durable, auditable trail when things go right, but it does not
  make dishonesty impossible.
- **A direct `gh pr merge`, or the GitHub web UI, skips this gate
  entirely.** Repeated from above because it is the largest honour-system
  gap of all: nothing about this slice is a server-side enforcement
  mechanism.
- **A user-level deny hook is a seatbelt, not a lock (see below).** It runs
  in the same session it is meant to constrain, in a settings file that
  session (or any other on the same machine) could in principle edit, and it
  covers a fixed, named list of command shapes — not every way to
  accomplish the same end.

None of this is a reason not to build the slice — the alternative is no
structure and no trail at all. It is a reason to say, in this document,
exactly what "enforced" does and does not mean here.

## User-level deny hook (ready to install — the owner installs this, not an agent)

This is a Claude Code **user-level** `PreToolUse` hook example. It blocks a
fixed, named list of command shapes that are always tier-2 (credentials,
deployment approval, repository/branch-protection settings, publish, and
destructive force-pushes or branch deletes) at the tool layer, before the
command runs. It is a seatbelt: it runs inside the same permission boundary
as every other command a session issues, in a file a session with shell
access could in principle edit. Its value is catching an *accidental*
tier-2 command an agent didn't mean to run, not resisting a session that has
decided to defeat it.

**This repository does not install it, anywhere, for anyone.** No commit in
this pull request adds it to `.claude/settings.json` (repo-scoped) or any
other tracked file. It is documented here, in prose, as an example the
owner may copy into their own **user-level** settings if they choose to.

### What it does and does not block

It blocks, tested directly against each pattern:

- `gh api .../pending_deployments` — approving a deployment (npm-publish
  approval gate)
- `gh api .../rulesets` — reading or writing branch rulesets
- `gh api .../environments` — environment configuration
- `gh api -X PUT .../branches/.../protection` — branch-protection edits via
  the REST API directly
- `gh secret set` — repository/environment secret writes
- `gh repo edit` — repository settings edits
- `gh pr merge ... --admin` — an admin-override merge that bypasses required
  checks
- `npm publish`, `npm unpublish`, `npm dist-tag` — direct publish,
  unpublish, or dist-tag moves, bypassing the qualification/publish gates
- `git push --force` / `git push -f` (but not `--force-with-lease`, treated
  as the safer, intentionally-scoped variant)
- `git push origin +main` (or any `+refspec` force-push shorthand)
- `git push --delete <branch>` or `git push origin :<branch>` (including a
  branch name containing a slash, such as `claude/foo`)

It does **not** block, and an owner relying on it should know this:

- Any of the above run through a wrapper script, a Makefile target, `npm
  run <script>` that shells out to one of these commands, `node -e "..."`,
  or any other indirection the regex list does not literally match.
  `git push --force-with-lease` is deliberately not blocked at all.
- The same actions performed through the GitHub web UI, a different tool
  entirely (Claude in Chrome, a browser), or any MCP server with its own
  credentials.
- A plain `gh pr merge` (no `--admin`) or a direct push to a branch with no
  force flag — this hook is about the specific always-tier-2 command
  *shapes* in `docs/HITL.md`, not a general merge gate; `scripts/land-stack.mjs`
  is the merge gate, and it has its own, separately documented, skip paths
  (see "Where each tier is enforced" above).
- Anything typed directly into a terminal outside a Claude Code session, or
  run by a different agent or human entirely.

### Example hook body

Save this as (for example) `~/.claude/hooks/deny-tier2.mjs`:

```js
#!/usr/bin/env node
// User-level PreToolUse hook: deny the always-human (tier-2) command shapes
// from docs/HITL.md in clossys/foundry. Reads the tool-call JSON Claude Code
// passes on stdin; exits 2 (block) with a reason on stderr for a match,
// exit 0 (allow) otherwise. This is a SEATBELT, not a lock -- see
// docs/HITL.md's "What it does and does not block" for the named gaps.

const DENY_PATTERNS = [
  /\bgh\s+api\b[^\n]*\/pending_deployments\b/i,
  /\bgh\s+api\b[^\n]*\/rulesets\b/i,
  /\bgh\s+api\b[^\n]*\/environments\b/i,
  /\bgh\s+api\b[^\n]*\/branches\/[^/\s]+\/protection\b/i,
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
      `Blocked by user-level deny hook (docs/HITL.md, clossys/foundry): this command shape is tier-2 (owner only). Pattern: ${hit}\n`,
    );
    process.exit(2);
  }
  process.exit(0);
});
```

### Install steps

1. Save the script above to `~/.claude/hooks/deny-tier2.mjs` and make it
   executable: `chmod +x ~/.claude/hooks/deny-tier2.mjs`.
2. Open your **user-level** Claude Code settings —
   `~/.claude/settings.json` (create it if it does not exist; this is your
   personal machine-wide settings file, not anything tracked in this or any
   other repository).
3. Add a `PreToolUse` hook entry matching the `Bash` tool:

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
         }
       ]
     }
   }
   ```

4. Restart or reload Claude Code so it picks up the new user-level setting.
5. Verify it: ask a session to run `git push --force origin main` in any
   repository. It should be blocked before the command executes, with the
   reason printed above. Also try `git push origin :some/branch` and `gh
   repo edit --description x` to confirm the slash-branch and repo-edit
   cases both block.

If you already have other `PreToolUse` hooks configured, add this as an
additional entry under the same `matcher` rather than replacing what is
there — Claude Code runs every matching hook.
