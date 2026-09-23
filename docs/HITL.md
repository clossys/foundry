# Human-in-the-loop escalation: first slice

This is the first slice of the agent decision/HITL escalation design agreed
at tier 1: the orchestrator's proposal at issue
[#1187](https://github.com/clossys/foundry/issues/1187), the decision-tier
rule at
[#1187 comment 5800142871](https://github.com/clossys/foundry/issues/1187#issuecomment-5800142871),
and the independent Fable second opinion at
[#1187 comment 5800683025](https://github.com/clossys/foundry/issues/1187#issuecomment-5800683025).
It covers scripts and governance only — no `packages/*` code changed, no
version bump, no CI workflow added or changed.

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
enforced" below.

## Where each tier is enforced

| What | Where | How |
|---|---|---|
| Tier-1 / tier-2 path classification | `governance/review-tiers.json` | Path globs, read by `land-stack.mjs`. Self-included: this file, and `scripts/land-stack.mjs` itself, are both tier-1 paths. |
| Tier-1 review requirement (two independent reviews) | `scripts/land-stack.mjs`'s `evaluateTier1Independence` | Reads `foundry-review-record` comments (`docs/contracts/review-record.json`) on the pull request at its exact current head. |
| Tier-2 owner-decision requirement | `scripts/land-stack.mjs`'s `evaluateTier2Decision` | Reads committed records under `governance/decisions/` (`docs/contracts/decision-record.json`) for a `decided`, `decidedBy: "owner"`, unexpired record linked to the pull request. |
| Decision log | `governance/decisions/*.json` | Append-only; one file per decision; validated by `node scripts/check-decision-records.mjs` (run by hand — see that script's own header for why it is not a `check:*` npm script yet). |
| Reviewer model qualification (draft) | `governance/model-qualifications/allowlist.json` | Every row is `status: "proposed"` until the owner approves it. Until approved, `land-stack.mjs` only reports which model/class combination a review used — it does not yet refuse a merge over an unqualified model. |
| Always-human commands | This document's deny-hook example below | **Not installed anywhere in this repository.** The owner installs it at Claude Code's user level, on their own machine, if they choose to. |

This is deliberately **not** a CI workflow. AGENTS.md's own rule —
"Model-assisted code review is manually initiated. Do not add a background
model reviewer or make repository workflows wait for provider-specific
review evidence" — stays true word for word: no workflow reads any of the
files above, no workflow calls a model, and no workflow waits on anything.
The tier-1/tier-2 bar applies only inside the merge-train conductor a
contributor runs from their own machine with their own authenticated `gh`.

## Honour-system limits — stated plainly

Every mechanism in this slice can be defeated by the thing it constrains,
because every agent session in this repository authenticates as **the same
GitHub account — the owner's own**. This is not a hidden gap; it is worth
being explicit about exactly where the honesty boundary sits.

- **`foundry-review-record` comments are trust-but-verify, not
  forgery-proof.** Nothing stops a session from posting two records under
  two different `instanceId`s for its own change. What raises the real cost
  of doing that is binding: a record must carry the pull request's *exact*
  current `headSha` (a stale record is dropped, never trusted), a distinct
  `instanceId` from the declared author record, and a `model`/`provider`
  pair that genuinely differs. Faking all of that *consistently*, across two
  records, is more work than actually running the second review — but it is
  not impossible, and this slice does not claim otherwise.
- **The decision log is append-only by convention, not by mechanism.**
  Nothing outside ordinary git history prevents a session from editing a
  past `governance/decisions/*.json` file directly. `scripts/check-decision-
  records.mjs` validates shape, expiry, and sunset, but it does not (yet)
  verify that a file's content matches what a prior commit actually said.
- **The tier-2 owner-decision requirement can be satisfied by a session
  writing its own decision record and claiming `decidedBy: "owner"`.**
  Nothing in this slice cryptographically ties a decision record to the
  owner's real identity. The gate raises the bar (a decision record is a
  durable, reviewable, committed artifact — a much larger and more visible
  lie than a merge with no evidence at all) without closing it.
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
- **A user-level deny hook is a seatbelt, not a lock (see below).** It runs
  in the same session it is meant to constrain, in a settings file that
  session (or any other on the same machine) could in principle edit.

None of this is a reason not to build the slice — the alternative is no
structure and no trail at all. It is a reason to say, in this document,
exactly what "enforced" does and does not mean here.

## User-level deny hook (ready to install — the owner installs this, not an agent)

This is a Claude Code **user-level** `PreToolUse` hook example. It blocks
the small set of commands that are always tier-2 (credentials, deployment
approval, repository settings, publish, and destructive force-pushes) at
the tool layer, before the command runs. It is a seatbelt: it runs inside
the same permission boundary as every other command a session issues, in a
file a session with shell access could in principle edit. Its value is
catching an *accidental* tier-2 command an agent didn't mean to run, not
resisting a session that has decided to defeat it.

**This repository does not install it, anywhere, for anyone.** No commit in
this pull request adds it to `.claude/settings.json` (repo-scoped) or any
other tracked file. It is documented here, in prose, as an example the
owner may copy into their own **user-level** settings if they choose to.

### What it blocks

- `gh api .../pending_deployments` — approving a deployment (npm-publish
  approval gate)
- `gh api .../rulesets` — reading or writing branch rulesets/repository
  settings
- `gh api .../environments` — environment configuration
- `npm publish` — direct publish, bypassing the qualification/publish gates
- `git push --force` / `git push -f` — force push
- `git push --delete` / `git push ... :branch` — remote branch deletion

### Example hook body

Save this as (for example) `~/.claude/hooks/deny-tier2.mjs`:

```js
#!/usr/bin/env node
// User-level PreToolUse hook: deny the always-human (tier-2) command shapes
// from docs/HITL.md in clossys/foundry. Reads the tool-call JSON Claude Code
// passes on stdin; exits 2 (block) with a reason on stderr for a match,
// exit 0 (allow) otherwise. This is a SEATBELT, not a lock -- see
// docs/HITL.md's "Honour-system limits" for what it does and does not do.

const DENY_PATTERNS = [
  /\bgh\s+api\b[^\n]*\/pending_deployments\b/i,
  /\bgh\s+api\b[^\n]*\/rulesets\b/i,
  /\bgh\s+api\b[^\n]*\/environments\b/i,
  /\bnpm\s+publish\b/i,
  /\bgit\s+push\b[^\n]*(--force\b|(?<!--force-with-lease)\s-f\b)/i,
  /\bgit\s+push\b[^\n]*(--delete\b|:[^\s/]+$)/i,
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
   reason printed above.

If you already have other `PreToolUse` hooks configured, add this as an
additional entry under the same `matcher` rather than replacing what is
there — Claude Code runs every matching hook.
