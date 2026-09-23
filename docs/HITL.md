# Human-in-the-loop escalation: first slice

This is an initial slice of the agent decision/HITL escalation design agreed
at tier 1: the orchestrator's proposal at issue
[#1187](https://github.com/clossys/foundry/issues/1187), the decision-tier
rule at
[#1187 comment 5800142871](https://github.com/clossys/foundry/issues/1187#issuecomment-5800142871),
and the independent Fable second opinion at
[#1187 comment 5800683025](https://github.com/clossys/foundry/issues/1187#issuecomment-5800683025).
Five rounds of independent review found logic gaps in earlier drafts of
this slice, not just honour-system limits — at `8e6d97ea`
([#1329 comment 5801039847](https://github.com/clossys/foundry/pull/1329#issuecomment-5801039847)),
`df15ab87`
([#1329 comment 5801406398](https://github.com/clossys/foundry/pull/1329#issuecomment-5801406398)),
round 4 at `4489f3ee`
([#1329 comment 5801753564](https://github.com/clossys/foundry/pull/1329#issuecomment-5801753564),
[#1329 comment 5801818986](https://github.com/clossys/foundry/pull/1329#issuecomment-5801818986)),
and round 5 at `5e620498`
([#1329 comment 5802284645](https://github.com/clossys/foundry/pull/1329#issuecomment-5802284645),
[#1329 comment 5802300009](https://github.com/clossys/foundry/pull/1329#issuecomment-5802300009)).
This document and `scripts/land-stack.mjs` were revised after each, and
every place a gap remains is named explicitly below rather than left
implicit. It covers scripts and governance only — no `packages/*` code
changed, no version bump, no CI workflow added or changed.

**This gate now ships in report-only mode by default** (round 5 — see
"Enforcement: report-only, then enforce" below). It computes and prints the
full tier verdict for every pull request it evaluates, but does not block a
merge unless `governance/review-tiers.json`'s `"enforcement"` field is
`"enforce"`.

## Escalation rule (owner-ratified 2026-09-23)

The rule below **supersedes** the informal decision-tier prose this
document opened with through round 6 (kept, unchanged, as "The three tiers"
further down, since it is what the CODE in this slice actually classifies
today — see "What this rule changes about the code, and what it does not"
at the end of this section for the gap between the two, and "Implementation
notes" right after the quoted text for where this repository is MORE
SPECIFIC than the rule itself). The coordinator presented it for
ratification in the coordinator chat on 2026-09-23 at approximately
14:35 PDT ("Final rule for your ratification … Recommendation: ratify"),
and the owner replied "go". That same exchange also authorized: "I'll have
the rule written into docs/HITL.md and the decision log, citing this chat,
and reviewed as a governance change" — that is the authorization for this
section and for the pull request that added it.
[`governance/decisions/hitl-escalation-rule.json`](../governance/decisions/hitl-escalation-rule.json)
is the durable, append-only record of that ratification — `channel:
"owner-chat", not independently verifiable`, per the rule's own Accepted
item 1, applied reflexively to its own adoption.

**The text below is reproduced VERBATIM — word for word, unedited — because
the owner ratified exactly this message, not a summary or expansion of it.**
An earlier draft of this section restated the rule in this drafting
session's own words instead of quoting it, which the closing "Changing
this rule itself" clause below treats as a rule change in its own right;
round 2 of independent review on this pull request found the deviations
and this is the fix. If this text and the decision record ever disagree,
the record is the source of truth.

> **Accepted:**
> 1. **A GitHub comment is not proof of your decision.** Every agent posts
>    as you, so an "Owner sign-off" comment an agent wrote proves nothing.
>    That includes the two I posted today for #1316 and #1329: they
>    reflect what you said in this chat, but GitHub can't show that. Your
>    decisions should be recorded from a channel agents can't write to.
>    That means this chat, or later commits signed with a hardware key
>    only you hold.
> 2. **The coordinator shouldn't pick the tier for its own work.** Tiers
>    are assigned mechanically, by the path rules in #1329. A reviewer can
>    raise a tier but never lower it. When it's unclear, use the higher
>    tier.
> 3. **Authority can be split into harmless-looking steps.** When you're
>    asked to switch a gate to enforce, the ask must show the combined
>    change since you last approved that gate, plus measured results from
>    its report-only run.
> 4. **"Your preference" would swallow everything if left open.** It's
>    narrowed to your standing settings: cadence, thresholds, risk
>    appetite, budgets. One-off choices within a setting you already chose
>    stay with the agents.
> 5. **Reviewer disagreement shouldn't default to you.** If reviewers
>    disagree on severity, take the stricter view and fix it. You get it
>    only when the disagreement is about values, or after 3 rounds that go
>    nowhere.
> 6. **Reviews need real independence.** Two reviewers who've both been
>    through seven rounds on the same PR share context. For governance,
>    security or gate changes, the last approval has to come from a fresh
>    strong-class reviewer with no history on the PR, and both verdicts
>    are given before either sees the other's.
> 7. **The notify mode needs guardrails, or it becomes rubber-stamping:**
>    - it's only for changes a single revert fully undoes, with nothing
>      external in between;
>    - at most 5 items per digest, ranked by risk, each with its revert;
>    - if you veto nothing for 8 weeks, the notify category gets
>      narrower.
> 8. **Your pushback changes a tier only when you explicitly reserve or
>    release an area.** That's the lesson from today, and I've saved it as
>    standing guidance.
>
> **Where I'm pushing back:**
> - **"All public text is external."** Taken literally, every review
>   comment would need your approval, and agents post hundreds a day
>   behind a safety check. The line should be text that speaks *for you*
>   or commits you to something: announcements, promises to third
>   parties, release notes, messages to people. Routine safety-checked PR
>   and issue comments stay with the agents.
> - **Hardware-signed commits for every owner decision, starting now.**
>   That's the right end state, but it needs a setup you haven't done.
>   Until then, records of your decisions cite this chat and are marked
>   "chat channel, not independently verifiable". That's honest about the
>   gap without blocking everything on a key.
> - **"Two approvals is the wrong stopping rule."** I'm adopting the
>   fresh-reviewer requirement for governance, security and gate changes
>   only. Requiring it everywhere would double review cost for routine
>   work, where today's evidence shows two reviewers working fine.
>
> **Final rule for your ratification.** This is an authority change, so
> it's legitimately your call:
>
> | Mode | When | What happens |
> |---|---|---|
> | **Your approval first** | Irreversible or public-for-you effects (publishing, deleting, money, credentials, workflow secrets or permissions, speaking for you); authority changes, judged on the combined change; changes to standing settings; value disagreements, or 3 rounds that go nowhere; anything you reserve | The agent sends one ask with a recommendation, a default and a deadline, batched for Friday unless urgent |
> | **Land, log and notify** | Changes a single revert fully undoes, with nothing external involved | Two reviews, a decision-log entry, and at most 5 digest items you can veto |
> | **Two reviews** | Everything else | Two independent reviews. For governance, security and gates: both strong-class, verdicts given before either sees the other's, and a fresh final reviewer |
> | **Autonomous** | Tier-0 paths | Logged |
>
> **Changing this rule itself:** agents may propose changes, but only you
> ratify them, in this chat or later by a signed commit. Agents can't
> write to the rule file or the deny hook. Landing and notifying never
> applies to this rule.

### Implementation notes (not part of the ratified text)

Everything below is this repository's own choice about HOW to carry out
the rule above, not a restatement of what the rule says — each is labeled
by which part of the ratified text it implements, kept separate from the
quote itself per the same discipline the quote's own provenance paragraph
states.

- **Implementation of Accepted item 1** (channel-sourcing): `docs/contracts/decision-record.json`
  and `scripts/check-decision-records.mjs` add a `channel` field, one of
  `"owner-chat"`, `"signed-commit"`, or `"github-comment"`. A decided,
  `decidedBy: "owner"` record, AT ANY TIER, must carry `channel:
  "owner-chat"` — `"github-comment"` is rejected outright, and
  `"signed-commit"` is rejected too, for now, because no hardware-key
  verifier exists yet to check that claim against anything (see "Channel
  enforcement" below for the full mechanism, including the fixed,
  content-hash-pinned allowlist that grandfathers the handful of decided
  owner records that predate this field).
- **Implementation of Accepted item 2** (mechanical tier assignment):
  `scripts/land-stack.mjs`'s `classifyTier` is path-based and
  union-over-paths/max-over-tiers (a change spread across many files never
  classifies below what one file alone would demand — see "The three
  tiers" below). This pull request also adds `docs/HITL.md` and
  `governance/decisions/hitl-escalation-rule*.json` to `tier2.globs`,
  specifically because the MECHANICAL path assignment would otherwise put
  the rule's own living copy at tier-0 and its decision record at tier-1 —
  see "Tier coverage for changing this rule" below.
- **Implementation of the "Final rule" table's "Two reviews" row, governance/security/gate carve-out**:
  not yet implemented. `evaluateTier1Independence` enforces two
  independent reviewers but has no notion of "strong-reasoning class",
  "verdicts given before either sees the other's", or "a fresh final
  reviewer with no history on the PR" for any path, governance/security/gate
  or otherwise. Tracked in #1350 and "Before switching to enforce" below.
- **Implementation of the "Land, log and notify" mode**: not implemented
  at all. No digest, no revert-tracking, no risk-ranking, no 8-week-shrink
  logic exists anywhere in this repository.
- **Implementation of "Changing this rule itself"**: `docs/HITL.md` and
  `governance/decisions/hitl-escalation-rule*.json` are now in
  `tier2.globs` (see above), and two `docs/HITL.md` deny-hook patterns
  (documentation only — see "User-level deny hook" below) name the same
  two paths. Neither is a verification that a change to either file was
  actually owner-ratified; both are the path-classification and
  documentation layer only. See "Honour-system limits" below for what
  neither can do.

### What this rule changes about the code, and what it does not

**Report-only mechanics are unchanged.** This ratification is a policy
document and a decision record; it does not touch `scripts/land-stack.mjs`'s
report-only default described below, beyond the two additions this pull
request makes and documents explicitly: the `channel`-based tier-2
authority restriction in `evaluateTier2Decision` (see "Channel enforcement"
below), and `tier2.globs`' two new entries.

The code in this slice implements a NARROWER slice of the rule above, not
every part of it:

- **The "Two reviews" mode** is what `scripts/land-stack.mjs`'s tier-1
  gate (`evaluateTier1Independence`) actually enforces today — minus the
  blind-verdict, fresh-final-reviewer, and model-diversity-record
  requirements the ratified rule adds for governance/security/gate work.
  Tracked in #1350 (see "Before switching to enforce" below).
- **"Autonomous: tier-0 paths, logged"** matches the code's own tier-0
  fast path (`runStatus` skips review-evidence reads entirely for a
  tier-0 classification — see "Where each tier is enforced" below), though
  "logged" here means only that `land-stack.mjs --status`'s own JSON output
  reports the tier, not a durable log of every tier-0 action taken.
- **"Your approval first"** partially maps to the existing tier-2
  owner-decision-record requirement (`evaluateTier2Decision`), but the
  code's tier-2 classification is PATH-based (`governance/review-tiers.json`'s
  `tier2.globs`), not a case-by-case judgment against the table row's own
  prose ("Irreversible or public-for-you effects … authority changes,
  judged on the combined change; changes to standing settings; value
  disagreements, or 3 rounds that go nowhere; anything you reserve"). A
  path landing in `tier2.globs` is treated as owner-approve-first; a
  change the RULE would put in this row by its own judgment, but that
  touches no `tier2.globs` path, is not currently caught by any code in
  this repository at all.
- **"Land, log and notify"** has NO code implementation in this slice —
  see "Implementation notes" above.
- **"The coordinator shouldn't pick the tier for its own work"** (Accepted
  item 2) matches `classifyTier`'s design in spirit — see "Implementation
  notes" above — but the code has no notion of "a reviewer raising a
  tier" as a distinct action from the mechanical classification itself.
- **Channel-sourcing (Accepted item 1) and the rule's own amendment lock
  ("Changing this rule itself")** are each implemented only PARTIALLY, and
  differently from each other — an earlier draft of this section
  overclaimed both as simply "implemented for the DECISION-RECORD schema".
  Corrected: channel-sourcing has real code enforcement, described fully
  in "Channel enforcement" below, but `channel` itself remains an
  AGENT-DECLARED, honour-system field until a signed-commit verifier
  exists — the validator can reject an admitted `"github-comment"`, but it
  cannot detect a session that simply declares `"owner-chat"` without one
  actually having happened. The amendment lock has NO enforcement beyond
  the path classification described in "Implementation notes" above and
  the deny-hook's own, separately-limited protection (see "User-level
  deny hook" below) — nothing verifies that a change to `docs/HITL.md` or
  to the decision record was actually ratified by the owner.
- **"Your pushback changes a tier only when you explicitly reserve or
  release an area"** (Accepted item 8) has no structured "reservation" or
  "release" artifact in this repository yet — today an owner reservation
  or release would itself need to become a new decision record (or a
  superseding record of this rule's own, which "Changing this rule
  itself" reserves to ratification) to be durable.

### Channel enforcement

Implements Accepted item 1 strictly, per round 2 of independent review on
this pull request (both reviewers, blocking):

- A decided, `decidedBy: "owner"` record, AT ANY TIER (not only tier-2),
  must carry `channel: "owner-chat"` or `channel: "signed-commit"`.
  `scripts/check-decision-records.mjs`'s `validateDecisionRecordShape`
  enforces this as a shape-validation finding.
- `channel: "github-comment"` is NEVER valid for `decidedBy: "owner"`, at
  any tier or status — Accepted item 1's own text makes no tier exception
  ("Every agent posts as you, so an 'Owner sign-off' comment an agent
  wrote proves nothing").
- `channel: "signed-commit"` is REJECTED TOO, for now: no hardware-key
  signature verifier exists in this repository, so a record claiming this
  channel cannot be checked against anything, and accepting the claim as
  though it were the verified fact it will eventually be would defeat the
  point of the field entirely. This is a temporary, infrastructure-driven
  restriction, tracked as a future item in "Before switching to enforce"
  below and in #1350 — not a permanent rule that `"signed-commit"` is
  meaningless.
- `scripts/land-stack.mjs`'s `evaluateTier2Decision` separately requires
  `record.channel === "owner-chat"` for a record to count as LIVE tier-2
  authority — this is not redundant with the validator above. A record on
  the fixed, content-hash-pinned `LEGACY_CHANNEL_EXEMPT` allowlist (three
  records that predate this field entirely: `coderabbit-advisory-reviewer`,
  `operation-interaction-role-authority`, and the original, now-superseded
  `weekly-release-calendar`) PASSES shape validation with no `channel` at
  all — it stays valid AS HISTORY, since it is immutable and this rule
  cannot reach back and invalidate it — but it authorizes NOTHING:
  `evaluateTier2Decision` excludes every channel-less record from its
  candidate pool regardless of what the validator allows.
- **`channel` is agent-declared and honour-system**, exactly like every
  other self-declared field in this design (see "Honour-system limits"
  below), UNTIL signed commits are verified. The validator can catch an
  HONEST admission of `"github-comment"`; it cannot tell a genuine
  `"owner-chat"` decision from a session that simply writes that value.
  `operation-interaction-role-authority.json` illustrates the boundary:
  its original record (sourced only from GitHub comments on #505/#511,
  predating this rule) is on the legacy allowlist and authorizes nothing;
  the owner re-confirmed that same decision directly in the coordinator
  chat on 2026-09-23 ("your earlier decision on operation and interaction
  role authority (#505/#511) was recorded only from GitHub comments …
  re-confirm it" / owner: "yes"), and
  [`governance/decisions/operation-interaction-role-authority-owner-chat.json`](../governance/decisions/operation-interaction-role-authority-owner-chat.json)
  — `channel: "owner-chat"`, `supersedes: ["operation-interaction-role-authority"]`,
  the same decision content unchanged — is the resulting, now-valid
  authorization. `coderabbit-advisory-reviewer.json` (tier-1, owner,
  also GitHub-comment-sourced) has NOT been re-confirmed and remains
  history-only, authorizing nothing, until the owner does the same for it.

### Tier coverage for changing this rule

By `classifyTier`'s mechanical, path-based rule, `docs/HITL.md` alone
(with no globs matching prose) would classify tier-0, and
`governance/decisions/hitl-escalation-rule.json` alone (matched only by
the broad `governance/**` glob, since `governance/decisions/**` carries no
`tier1RecordExempt` carve-out) would classify tier-1 — round 2 of
independent review on this pull request (both reviewers, blocking) found
that this contradicted "Changing this rule itself" directly: an edit to
the rule's own living text, or its durable record, could otherwise land
with two ordinary reviewers, never reaching the owner. `docs/HITL.md` and
`governance/decisions/hitl-escalation-rule*.json` (a glob, covering any
future superseding record that follows this repository's supersession
naming convention — see `governance/review-tiers.json`'s own `$comment`
for the full reasoning) are now in `tier2.globs`.

## The three tiers

**This is the CODE-LEVEL classification `scripts/land-stack.mjs` actually
enforces today** (kept, unchanged, from before the ratified "Escalation
rule" above existed) — not a restatement of the ratified rule itself. The
decision-tier rule (#1187 comment 5800142871) it derives from predates
ratification; see "What this rule changes about the code, and what it does
not" at the end of the Escalation rule section above for exactly how the
two relate. It defines three tiers of agent decision:

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
| Enforcement mode (report-only by default) | `governance/review-tiers.json`'s `"enforcement"` field, read from the pull request's base commit | `scripts/land-stack.mjs`'s `runStatus` always computes the full tier verdict and every refusal reason and always prints them, but `applyEnforcement` only lets a refusal actually block a merge when `enforcement` is the literal string `"enforce"`; any other value (including the field's absence) is `"report-only"` and a would-be refusal is reported with an explicit `[report-only; would refuse under enforce mode]` prefix but returns `ok: true`. Default is `"report-only"`. REPORT-ONLY MUST NEVER BLOCK OR CRASH A LANDING (round 6, blocking, both reviewers): `runStatus` determines `enforcement` FIRST, independently of everything else, defaulting to `"report-only"` when even the tier-config read itself fails (a stacked PR whose base predates this file, for example) — then wraps the ENTIRE tier evaluation (the changed-file completeness cross-check, PR-file/comment/decision-record fetches, classification, everything through the raw verdict) in one try/catch. Under report-only, any failure in there — a `changedFiles` mismatch, an empty file list, a missing base-branch tier config, any API error, a malformed decision record, any other unexpected exception — becomes a reported, non-blocking warning and the landing proceeds exactly as it would with no gate at all. Under enforce, the same failures fail closed (an actual refusal). See "Enforcement: report-only, then enforce" below. |
| Tier-1 / tier-2 path classification | `governance/review-tiers.json` | Path globs, read by `land-stack.mjs` from the pull request's **base commit** via the GitHub Contents API (`repos/{owner}/{repo}/contents/{path}?ref={baseSha}`) — never from the local checkout — so a pull request can never narrow its own tier-1 globs or add its own decision record in the same diff it needs graded. Classifies BOTH the new and previous name of a renamed file (`changedFilePathsForClassification`), so moving a tier-1/tier-2 file to an unwatched path cannot itself dodge the tier it would otherwise carry. `tier1.globs` is now the BROAD `scripts/**` and `.github/**` (not a hand-picked script list), and `scripts/land-stack.test.mjs` has a test, `findUnclassifiedWorkflowPaths`, that scans every real `.github/workflows/*.yml` file for a referenced script/config path and fails if any of them classifies tier-0 — a structural guard against this porousness recurring, not just a one-time fix. |
| No-op head commit | `scripts/land-stack.mjs`'s `isNoOpHeadCommit` | Any tier-1/tier-2 pull request whose HEAD COMMIT changes zero files (most commonly `git commit --allow-empty`) refuses outright, regardless of what the rest of the diff or review evidence says — a no-op commit would otherwise be enough on its own to give a rejected PR a fresh head and clear a sticky rejection with no real change at all. |
| Change-then-revert past a sticky reject | `scripts/land-stack.mjs`'s `isTreeIdenticalToRejectedHead` (round 5, should-fix) | A no-op COMMIT is refused (above), but a commit that changes a file and then a LATER commit that reverts it produces a genuinely different, non-empty head commit — `isNoOpHeadCommit` alone does not catch it. `runStatus` now also fetches the git TREE sha (not the commit sha) of the current head and of every prior authorized reject's headSha (capped at 10 candidates) and refuses the merge if the current tree matches any rejected tree exactly — a content-identical head, however it was produced, never counts as "a real change" for the purpose of clearing a sticky reject. **Known limitation:** this compares whole-tree identity, not the specific files a reviewer rejected — a change-then-revert of files OUTSIDE what the reviewer actually objected to, combined with a genuine unrelated fix, produces a different tree and is not caught; this closes the pure "revert to exactly what was rejected" case, not every way to launder a rejected diff into looking new. |
| Decided-record immutability | `scripts/land-stack.mjs`'s `evaluateChangedDecisionRecords` | A pull request that changes the CONTENT (by parsed value, not raw text) of a `governance/decisions/*.json` record whose base-branch version already has `status: "decided"` is refused — a decision can be changed only by a new record whose `supersedes` names the old one, never by editing it in place. A record still `"open"` on the base branch may be freely edited. |
| Self-inclusion | This file, `scripts/land-stack.mjs` (and its test), `docs/contracts/decision-record.json`, `scripts/check-decision-records.mjs` (and its test), `package-scope.json`, and `scripts/lib/**` are all **tier-2**, not tier-1 — a tier-1 change (two agent reviewers) could otherwise narrow `tier2.globs` (for example, drop `governance/model-qualifications/**` from it) and remove the owner-only boundary without the owner. See "Bootstrapping this gate" below for the one case this cannot cover: this pull request's own first landing. |
| `governance/decisions/**` classification | `governance/review-tiers.json`'s `tier1.globs` (`governance/**`) | **Tier-1, not tier-0.** Deliberately NOT listed in `tier1RecordExempt` (the carve-out for pure record files) — adding or changing any decision record needs the same two-independent-reviewer bar as any other governance path — closing a self-issue-then-spend loophole (see "What changed after the 8e6d97ea review" below). |
| Record authorship | `scripts/land-stack.mjs`'s `defaultAnnotateCommentAuthorization` / `isAuthorizedCollaboratorPermission` | A `foundry-review-record` comment counts toward tier-1 ONLY when its author's collaborator permission on this repository (`repos/{owner}/{repo}/collaborators/{username}/permission`) is `admin` or `write` (`"authorized"`). A confirmed `read`/`none`, or an unresolved login, is `"unauthorized"` — never counts toward anything, approval or rejection, and is never itself suspicious (a stranger cannot block the PR by posting garbage). A FAILED permission lookup (the check itself errored, not a confirmed "no") is the third, distinct state `"unknown"` and refuses the whole gate outright, for any record — collapsing it into `"unauthorized"` would silently drop a genuine reject this module simply could not verify. This is a public repository; without any of this, a comment from any GitHub account with no relationship to it at all satisfied tier-1 independence. |
| Record block parsing | `scripts/land-stack.mjs`'s `findReviewRecordBlocks` and `hasUnaccountedMarkerContent` | A POSITIVE grammar, not a strip-then-scan regex (round 5 replaced `stripQuotedAndFencedContent` — see "What changed after the round-5 reviews" below): a record counts only when its `<!-- foundry-review-record` opener sits at literal column 0 (no leading whitespace at all — an indented opener, including one inside a classic 4-space-indented code block, never matches), outside any fenced code block (backtick or tilde, any indent), `<details>`, or `<pre>` region, with its `-->` closer present. The JSON body is parsed with `JSON.parse`, so any indentation inside the block is fine — nothing is stripped or rewritten to make it parse. A marker (`foundry-review-record`, matched CASE-INSENSITIVELY — round 6, second reviewer: a differently-cased opener was previously invisible to the parser entirely) that appears in an AUTHORIZED comment but never resolves to a valid block — fenced, quoted, indented past what the grammar accepts, malformed JSON, or JSON that parses but is not a plain object (an array, `null`, a string, or a number — round 6, blocking, first reviewer, item (c)-1: a reject wrapped in `[{ …, "state": "reject" }]` is spread by `{ ...parsed }` into index keys with no `role`/`state` at all otherwise) — REFUSES THE GATE via a `_parseError` marker, the same as an edited-at-head record does; it is never silently dropped. A reject must never vanish just because it shares a comment with an earlier genuine block (round 6, blocking, both reviewers): `hasUnaccountedMarkerContent` separately checks, for every comment that produced at least one valid block, whether the raw body still contains MORE marker-opener occurrences than `findReviewRecordBlocks` accounted for (a fenced or quoted second marker alongside a genuine one), or ends with a fence/`<details>`/`<pre>` region still open (including a ONE-LINE `<details>...</details>`, whose same-line close this module's line-based tracker never sees, silently swallowing everything after it) — either signal adds an extra `_parseError`, refusing the gate rather than treating the comment as fully accounted for. An unauthorized comment's marker is never suspicious this way (see "Honour-system limits" below for the DoS this closes). A bare-word PROSE mention of the marker name (no `<!--` opener at all) also currently refuses the gate under the same `_parseError` fallback — harmless under report-only, but listed as a must-fix before enforce (see "Before switching to enforce" below). |
| Tier-1 review requirement | `scripts/land-stack.mjs`'s `evaluateTier1Independence` | Reads `foundry-review-record` comments (`docs/contracts/review-record.json`) on the pull request at its exact current head, from AUTHORIZED comments only. Refuses outright if any edited-at-head or unparseable record block exists at all (`findSuspiciousRecordComments`) — rather than silently dropping it and continuing. AMBIGUOUS-HEADSHA HANDLING, PRECISE (round 6, blocking, first reviewer, items (c)-2/3/4 — an earlier version of this row overclaimed the exact conditions): for any record whose state is NOT a recognized approval-path spelling (`approved`/`commented`/`declared`) — a reject spelling, or any other unrecognized value, WHATEVER its `role` — `isConfirmedDifferentHeadSha` is the sole test for "safely stale, ignore it": a full, well-formed 40-character hex SHA that provably does not equal the current head. A missing `headSha`, a non-hex value, the literal string `"HEAD"`, or a prefix shorter than 7 characters is NEVER treated as stale just because it fails to match the current head. From there the two spellings split: a RECOGNIZED reject spelling that clearly matches the current head (the same lenient 7+-character-prefix rule `findStickyRejections` uses) is NOT flagged suspicious here — it is the legitimate case, handled below with its own sticky reason; a TRULY UNRECOGNIZED state is suspicious even at a clean, exact match to the current head, since nothing else in this module interprets it as meaningful evidence. Refuses outright, and STICKY (never superseded by any later record, from the same `instanceId` or otherwise, however that later record is dated), if any authorized record at (or an unambiguous 7+ character prefix of) the current head has a reject-shaped state, matched case-insensitively AND spelling-insensitively (`findStickyRejections` via `normalizeStateSpelling`: `reject`, `rejected`, `changes-requested`, and `changes_requested` all count as the same reject state — round 5, both reviewers) — regardless of what else about the record (missing `depth`, missing `model`) is wrong. Requires exactly one author record. Otherwise requires one `primary` and one `secondary` record, both `state: "approved"` (`"commented"` never counts), differing in model or provider, ordered by the comment's own `created_at` (not the self-declared `submittedAt`) when an instance supersedes its own earlier record. |
| Tier-0 fast path | `scripts/land-stack.mjs`'s `runStatus` | A genuinely tier-0 classification skips fetching PR comments, resolving any collaborator permission, and reading the base-branch decision log entirely — no path in a tier-0 diff can match `governance/decisions/**` (that glob alone is tier-1), so none of those reads would find anything to check. This also means one malformed record anywhere in the decision log no longer breaks `--status` for every pull request, tier-0 included. |
| Tier-2 owner-decision requirement | `scripts/land-stack.mjs`'s `evaluateTier2Decision` | Reads decision records from the pull request's base commit for one that is itself schema-valid (checked against its real filename on the base branch, not against its own self-reported `id`), `tier: "tier-2"`, `status: "decided"`, `decidedBy: "owner"`, not superseded, not a relaxation past its sunset, unexpired (an unparseable `expiry` counts as expired), and linked to the PR EITHER by number PLUS a matching patch-id (`links.pullRequests` + `links.patchIds`) OR by a path glob that is either a literal path or exactly one of `tier2.globs` verbatim, on a record whose own `expiry` is non-null (`isOverbroadPathGlob`, computed against the real tier config). The patch-id is `git patch-id --verbatim` of the pull request's own net diff against its merge base, recomputed fresh at gate time (never trusted from a cached value) — see "Tier-2 authorization survives restacks: patch-id, not head sha" below for why this replaced a head-sha pin in round 5. A PR-scoped record with no patch-id pin, or a path-scoped record with `expiry: null`, authorizes nothing at all. **Known limitation, not solved:** a merge-train batch pull request carries a different PR number, head sha, AND patch-id than any original constituent PR a decision record might name — this gate checks the batch PR's own single patch-id against its own single merge base; it does not decompose a batch into per-constituent patch-ids or resolve one PR's authorization through another's. A batch containing a tier-2 change needs its own decision record (naming the batch's own patch-id) or its own fresh review, even when an original constituent PR was already authorized. |
| Changed-decision-record validation | `scripts/land-stack.mjs`'s `evaluateChangedDecisionRecords`, reusing `scripts/check-decision-records.mjs`'s own `validateDecisionRecordShape` | Runs on **every** pull request, any tier: any `governance/decisions/**` file the PR adds, edits, deletes, or renames must be schema-valid, checked against its content at the PR's own **head** commit. A path deleted or renamed OUT of `governance/decisions/` is treated the same as a malformed record (decision records are append-only — superseded, never deleted or renamed away). |
| Changed-file completeness | `scripts/land-stack.mjs`'s `verifyChangedFilesComplete` | Files are paginated directly against `repos/{owner}/{repo}/pulls/{n}/files` (never `gh pr view --json files`, which silently truncates at 100 entries) and cross-checked against the PR's own `changedFiles` count; an empty list, a short list, OR a non-number `changedFiles` value all refuse the merge rather than classifying blind. |
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
enforces. Making it unconditional would need a required status check
computed by a workflow, which is precisely the CI-workflow shape AGENTS.md's
rule rules out for model-review evidence; this slice accepts that trade
rather than working around the rule it is trying to honor.

## What changed after the 8e6d97ea review

An independent review found the initial draft of this slice weaker than both
the cited decision-tier rule and this document's own text, in ways that were
implementation bugs, not disclosed honour-system limits. Fixed in this
revision:

- A rejecting or changes-requested reviewer was silently outvoted by a later
  approving pair. It is now checked first and refuses the merge — though
  "unconditionally" turned out to still have three real holes; see "What
  changed after the df15ab87 review" below for how those were closed too.
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

## What changed after the df15ab87 review

A second independent review, re-probing the exported functions directly
rather than reading the tests, confirmed every fix above and found five
further gaps, plus several smaller ones:

- **Renames escaped classification.** Only the new `filename` from the
  Pulls API was ever classified; the OLD path (`previous_filename`) was
  not. Moving `scripts/land-stack.mjs` to `scripts/old/land-stack.mjs`, or
  a workflow file to a `.off` extension, classified as tier-0. Both names
  are now fed into classification (`changedFilePathsForClassification`),
  and a rename out of `governance/decisions/` is treated the same as a
  deletion.
- **Anyone could supply review records.** `parseReviewRecordComments` never
  looked at who posted a comment — on this public repository, two records
  from an account with no relationship to this repository at all satisfied
  tier-1. Only a comment from an `admin`/`write` collaborator (checked
  live, via the Collaborators API, on every comment's author) counts now.
- **"Never outvoted" still failed open three ways.** An edited comment
  containing a reject was dropped entirely (the approve-pair around it then
  looked clean); a reject missing `depth`/`model` was silently ignored by
  the same strict validity gate an approval needs; and a later,
  same-`instanceId` record with a later self-declared `submittedAt` could
  supersede an earlier reject. All three are closed: `findSuspiciousRecordComments`
  refuses the whole gate on any edited-at-head or unparseable block before
  anything else is checked; `findStickyRejections` finds a reject
  independently of `isValidReviewRecord`'s strict gate and independently of
  the "latest wins" supersession logic (a reject is never superseded by a
  later record, self-declared timestamp or not); and ordinary
  supersession — for approvals — is now ordered by the comment's own
  `created_at`, which the poster does not control, rather than
  `submittedAt`, which they do.
- **The overbroad-glob check used a fixed canary list.** `governance/**`,
  `.github/**`, `scripts/lib/**`, and a bare `*.yml` glob all passed as
  "not overbroad" against a small fixed set of example paths.
  `isOverbroadPathGlob` is now computed against the REAL tier config: a
  `links.paths` entry must be a literal path, or exactly equal to one of
  `tier2.globs`'s own entries — nothing else.
- **One corrected decision record still misquoted its source.** The
  `weekly-release-calendar` record attributed the Friday/Saturday/Sunday
  calendar text to the wrong comment (the general cadence rule, not the
  comment that actually states the calendar's specifics). Corrected to cite
  #1187 comment 5799538912; the owner's subsequent direct sign-off on PR
  #1316 (comment 5801304853) is also now reflected — this record is
  `status: "decided"` again, this time genuinely.

Plus several smaller fixes: `gh pr merge --match-head-commit` for the
status-to-merge race; a non-number `changedFiles` now refuses rather than
skipping its own cross-check; API paths are now URL-encoded per segment; a
decision record's `id` is checked against its real filename on the base
branch, not against itself; the deny hook now also covers a slash-named
branch in a branch-protection API call and branch deletion via the raw Git
refs API; and the `launcher-starter-executable-tooling` and
`verify-standards-stale-bot-reviews` decision records' `notes` were
corrected to stop narrating a specific in-progress state that was already
stale by the time it was committed, and to stop describing an unmerged pull
request's change as "Implemented," respectively.

The second review's own full text
([#1329 comment 5801406398](https://github.com/clossys/foundry/pull/1329#issuecomment-5801406398))
is the authoritative account; this section summarizes it, not the reverse.

## What changed after the round-4 reviews

Two more independent reviews at the SAME head found a real
denial-of-service hole in the previous round's own fix, gate-critical
paths this repository's workflows execute with no tier coverage at all,
and further attribution errors. Both are cited together here since they
overlapped substantially:

- **The `findSuspiciousRecordComments` fix from the previous round never
  checked authorization at all.** Both reviews independently found the
  SAME hole: any unauthorized (non-collaborator) account could post one
  unparseable or edited `foundry-review-record` comment and permanently
  refuse every tier-1/tier-2 pull request — including, as one review
  pointed out, via the review threads' OWN illustrative example blocks.
  Fixed two ways: `findSuspiciousRecordComments` now checks `_authorization
  === "authorized"` before treating anything as suspicious, and
  `stripQuotedAndFencedContent` removes fenced code, inline code, blockquoted,
  and indented occurrences of the marker before scanning, so a comment that
  merely QUOTES the syntax (illustrating it, discussing it, or citing this
  contract's own example) is invisible to the parser entirely.
- **Gate-critical paths this repository's own workflows execute were
  tier-0.** `.github/scripts/*.mjs`, two `.github/*policy*.json` files,
  `.root-entry-policy.json`, `scripts/push-tree-identical.mjs`, and the
  whole publish path (`scripts/publish-*.mjs` and four more named scripts)
  needed no review record at all under the previous, hand-maintained
  `tier1.globs` list — the same porousness Fable's second opinion warned
  about from the start. `tier1.globs` is now the broad `scripts/**` and
  `.github/**`; the publish path is separately tier-2. A new test,
  `findUnclassifiedWorkflowPaths`, scans every real workflow file for a
  referenced script/config path and fails if any of them still classifies
  tier-0, so this cannot silently regress.
- **A reject still failed open three more ways.** A `reject` did not match
  a short (7+ character) or uppercase `headSha`; a `reject` with NO
  `headSha` at all was silently un-matched rather than refusing the gate;
  and a failed permission lookup for a reject's author collapsed into a
  confirmed "unauthorized" rather than refusing the gate over the
  ambiguity. All three closed: `isCurrentHeadShaForReject` matches
  case-insensitively and by prefix; a headSha-less authorized reject is now
  `findSuspiciousRecordComments`-suspicious; and a third authorization
  state, `"unknown"` (distinct from both `"authorized"` and
  `"unauthorized"`), refuses the whole gate for any record whose permission
  lookup itself failed.
- **A tier-2 authorization tied to a PR number alone authorized whatever
  head that PR carried later, and a path-scoped one with `expiry: null` was
  a standing blank cheque.** `evaluateTier2Decision` now requires a
  PR-scoped authorization to also pin the exact head sha it was decided
  about (`links.headShas`), and a path-scoped one to carry a non-null
  `expiry`. `governance/decisions/weekly-release-calendar.json` — the sole
  live tier-2 authorization in the tree — now pins the owner's sign-off to
  its actual head, `348e385bc43b266481d5ae48d451d01a54a53e2e`, and two more
  attribution errors in that record were corrected (the out-of-band
  minor/major mechanics come from PR #1316's own body, not a #1187 comment;
  the Friday/Saturday/Sunday sentence appears only in PR #1316's body,
  citing but not quoting #1187 comment 5799002037 verbatim — the real
  source of the day-specific calendar text is the separate comment
  5799538912, already cited directly).
- **A decided decision record could still be edited in place**, and a
  no-op head commit (`git commit --allow-empty`) could clear a sticky
  reject with no real change at all. Both closed:
  `evaluateChangedDecisionRecords` now refuses any content change (by
  parsed value) to a record whose base-branch version is already
  `"decided"`, and `isNoOpHeadCommit` refuses any tier-1/tier-2 pull
  request whose head commit changes zero files.
- **`runStatus` did tier-2-shaped work for every pull request, tier-0
  included** — fetching comments, resolving permissions, and reading the
  whole base-branch decision log regardless of tier, so one malformed
  record anywhere in the log could break status checks for every PR. Now
  skipped entirely for a genuinely tier-0 classification, and the
  base-branch decision log is read only when the PR is actually tier-2.
- **Documentation drift**: `docs/contracts/review-record.json` said
  supersession was ordered by `submittedAt` and that an edited comment was
  simply "ignored" (both stale by two rounds); `governance/review-tiers.json`
  and `governance/model-qualifications/allowlist.json` both still claimed
  `land-stack.mjs` enforces the model allowlist, which it does not in this
  slice; this document's own enforcement table named the wrong config key
  for decision-record classification. All corrected in place, alongside two
  more small attribution errors in `governance/decisions/verify-standards-stale-bot-reviews.json`
  (a fabricated `provider` value) and `governance/decisions/coderabbit-advisory-reviewer.json`
  (describing an unmerged PR's fix as already landed).

Both reviews' own full text
([#1329 comment 5801753564](https://github.com/clossys/foundry/pull/1329#issuecomment-5801753564),
[#1329 comment 5801818986](https://github.com/clossys/foundry/pull/1329#issuecomment-5801818986))
is the authoritative account; this section summarizes it, not the reverse.

## What changed after the round-5 reviews

The coordinator's own round-5 decision shipped this gate as report-only
first (see "Enforcement: report-only, then enforce" below); two more
independent reviews at that head found the previous round's record-parsing
fix had traded one failure mode for a worse one, and that the head-sha pin
introduced in round 4 could not survive this repository's own branch
protection:

- **`stripQuotedAndFencedContent` silently dropped genuine rejects.** Both
  reviews independently found the round-4 fix for the illustrative-example
  DoS (stripping fenced/quoted/indented text before scanning for the
  marker) regressed past what it fixed: 4-space or tab-indented JSON had
  its field lines deleted by the stripping regex, leaving `{}` — which
  parses cleanly and matches nothing, so a genuinely indented reject
  vanished with no signal at all. A reject fenced or quoted was silently
  ignored the same way. And editing a reject INTO a fence or quote bypassed
  the edited-at-head suspicion check entirely, since no record survived
  stripping to compare `updated_at` against. Replaced with
  `findReviewRecordBlocks`, a positive grammar that never deletes or
  rewrites text — it only recognizes a genuine, unfenced, column-0 opener —
  and treats "marker text present but no valid block found" as a parse
  error that refuses the gate, never as silence. See "Record block parsing"
  in the table above.
- **A PR-scoped tier-2 authorization pinned to a head sha could not survive
  its own record landing.** Reviewer 2 found this was not a theoretical
  edge case but the normal path: committing the decision record itself
  advances `main`, which is exactly what puts the authorized (not-yet-
  merged) pull request into a `BEHIND` state under this repository's
  strict, up-to-date branch protection, forcing a restack that changes its
  head sha the moment the authorization is committed. `links.headShas` is
  replaced with `links.patchIds` (`git patch-id --verbatim` of the PR's net
  diff against its merge base) — round 6 corrected the claim that this
  survives EVERY restack unconditionally; see "Tier-2 authorization
  survives restacks: patch-id, not head sha" below for what actually
  survives, and `governance/decisions/weekly-release-calendar.json`'s own
  `notes` for the worked example against PR #1316.
- **Tier-2's publish-path globs caught test files, not just the scripts
  that publish.** Both reviewers measured this directly against the last
  200 real landings on `main`: round 4's `scripts/publish-*.mjs` /
  `scripts/deprecate-*.mjs`-style wildcards also matched every
  `*.test.mjs` sibling of those scripts, and round 4's four ELIGIBILITY-gating
  scripts (`validate-candidate-publish.mjs`, `select-publishable-packages.mjs`,
  `run-candidate-qualification.mjs`, `set-scope.mjs`) were tier-2 despite
  none of them containing a literal `npm publish`/`deprecate`/`unpublish`
  invocation. Measured via `git log --first-parent --merges` against the
  last 200 real landings on `main`, each diffed against its own first
  parent (corrected methodology — see "What changed after the round-6
  reviews" below for why the round-5 disposition's own first pass at this
  number was itself wrong): round-4's globs put roughly 167 of the last
  200 real landings (about 84%, this same measurement) <!-- facts-gate:ignore -->
  at tier-2 (owner-only); round-5's
  precise, literal globs — naming only `scripts/publish-qualified-directory.mjs`,
  `scripts/publish-qualified-set.mjs`, `scripts/deprecate-registry-version.mjs`,
  `scripts/deprecate-legacy-packages.mjs`, and the three workflow files that
  run them — put 40 of the same 200 (20%, same measurement) <!-- facts-gate:ignore -->
  at tier-2, with the
  eligibility-gating scripts and every `*.test.mjs` file now correctly
  landing at tier-1 via the broad `scripts/**` glob instead. See
  `governance/review-tiers.json`'s own `tier2.$comment` for the full grep
  trail, and "Before switching to enforce" below for what still drives
  that same 20% (same `git log --first-parent --merges` measurement) <!-- facts-gate:ignore -->.
- **Reject-spelling coverage was too narrow.** `changes_requested`,
  `changes-requested` (hyphen), and `rejected` — spellings a reviewer might
  plausibly type — are now all recognized as the same reject state,
  case-insensitively, via `normalizeStateSpelling`.
- **A change-then-revert head commit was not caught by the existing no-op
  check.** `isNoOpHeadCommit` (round 4) refuses an EMPTY head commit; it
  does not refuse a head commit that changes a file and reverts it in a
  later commit, which is a genuinely non-empty commit. `isTreeIdenticalToRejectedHead`
  compares the current head's git TREE sha against every prior authorized
  reject's tree sha and refuses a match, regardless of how many commits
  produced it.
- **`weekly-release-calendar.json`'s own prose overclaimed.** Its `decision`
  field stated flatly that "PR #1316 lands through the merge train carrying
  this sign-off," written under the head-sha design where that PR could
  not, in fact, land through this gate once its own authorizing record was
  committed (the restack described above would have broken the pin
  immediately). Corrected to describe the actual patch-id-based flow: the
  record lands, the PR restacks, and its patch-id — not its head sha — is
  what still matches.

Both reviews' own full text
([#1329 comment 5802284645](https://github.com/clossys/foundry/pull/1329#issuecomment-5802284645),
[#1329 comment 5802300009](https://github.com/clossys/foundry/pull/1329#issuecomment-5802300009))
is the authoritative account; this section summarizes it, not the reverse.

## What changed after the round-6 reviews

Round 6 was intended as the final round before this gate lands
report-only. Two more independent reviews at `63db7b09` verified every
round-5 fix by direct attack (patch-ids recomputed live against #1316,
restacks and content edits simulated in scratch repositories, `runStatus`
driven with injected fakes) and confirmed nothing regressed — the earlier
"81 → 75 tests" comparison in round 5's own disposition was also shown to
be an artifact of comparing a two-file total (81) against a one-file total
(75): the real count went from 81 to 90 (75 + 15), with three removed
titles each replaced by a direct successor, not a net loss of coverage.
Three real gaps remained, all now fixed:

- **Report-only could still block or crash a landing.** Both reviewers
  drove `runStatus` directly with `enforcement: "report-only"` and found
  four concrete ways the promise did not hold: a `changedFiles` mismatch
  returned early, before `applyEnforcement` ever ran; a base branch
  lacking `governance/review-tiers.json` (any stacked pull request, and
  PR #1316 itself today) made `runStatus` throw outright; a PR-files or
  PR-comments API error threw; and a single malformed decision record
  anywhere on the base branch threw from `JSON.parse` inside
  `defaultReadDecisionRecords`. None of these existed before this slice —
  `--merge` depended on nothing but `gh pr view` and the ruleset. Fixed by
  determining `enforcement` first and independently (defaulting to
  `"report-only"` even when the config read itself is what fails), then
  wrapping the whole tier evaluation in one try/catch that fails open
  under report-only and closed under enforce. See "Enforcement:
  report-only, then enforce" above.
- **`git patch-id --stable` ignores whitespace, so a semantic
  whitespace-only edit kept an owner's authorization.** Reviewer 2's
  repro: a PR adds `if [ "$OWNER_APPROVED" = "true" ]; then npm publish;
  fi`; editing it to `[ "$OWNER_APPROVED"="true" ]` (removing the spaces
  around `=`, which turns a string comparison into an always-true
  non-empty-string test — a real, exploitable change) left the `--stable`
  patch-id identical. Reproduced directly in this session too: two
  diffs differing only by that whitespace produced the SAME `--stable`
  id and two DIFFERENT `--verbatim` ids. `defaultFetchPatchId` now uses
  `git patch-id --verbatim`, which is still line-number-insensitive
  (survives an ordinary restack) but is no longer whitespace-blind.
  `governance/decisions/weekly-release-calendar.json` is re-pinned with
  PR #1316's verbatim patch-id, `d5d54f8f0af09275cdfe985793140d8c295bf94f`,
  computed via `gh api repos/clossys/foundry/compare/claude/release-batching...348e385bc43b266481d5ae48d451d01a54a53e2e -H "Accept: application/vnd.github.v3.diff" | git patch-id --verbatim` and independently cross-checked against a local `git diff` of the same two commits (byte-identical diff text, same id), against merge base `484cf77a513016c192106c3f2bc87a13fce09a84`.
- **A reject could still vanish silently in two parser cases.** The
  `_parseError` fallback only fired when a comment produced ZERO valid
  blocks — so a comment with one genuine block (say, an author's
  `commented` record) plus a FENCED reject reported `ok: true` for the
  fenced reject, and a ONE-LINE `<details><summary>…</summary>…</details>`
  left `detailsDepth` stuck open (the line-based tracker only decrements on
  a line that STARTS WITH `</details>`, so a same-line close is never
  seen), silently swallowing a genuine record later in the same comment.
  `hasUnaccountedMarkerContent` now runs whenever at least one valid block
  WAS found, and adds an extra `_parseError` if the raw body's marker-opener
  count exceeds the blocks found, or if the scan ends with a fence/
  `<details>`/`<pre>` region still open — deliberately choosing "refuse the
  gate" over implementing exact same-line HTML open/close tracking, the
  same fail-closed trade-off this module makes throughout.

Also corrected, not redesigned (see "Before switching to enforce" below
for the items this explicitly defers rather than fixes in this round):
the tier-2 measurement methodology itself was wrong in the round-5
disposition (`git log --merges -n 200` without `--first-parent` counts
"merge origin/main into this PR branch" commits as if they were landings,
which inflated the earlier 163/53 figures); the corrected, reviewer-verified
method (`git log --first-parent --merges` against real landings on `main`,
diffing each merge against its own first parent) gives 167/40, i.e.
84%/20% by that same first-parent measurement <!-- facts-gate:ignore -->,
for the round-4/round-5 globs respectively — see the tier-2 globs bullet
above. The patch-id restack claim ("restacking does not change the content
of the diff being hashed") was also too strong; corrected in "Tier-2
authorization survives restacks" above, along with
`weekly-release-calendar.json`'s false premise that its own landing on
`main` was what would force #1316 `BEHIND` (#1316's base was never `main`).

Both reviews' own full text
([#1329 comment 5802744422](https://github.com/clossys/foundry/pull/1329#issuecomment-5802744422),
[#1329 comment 5802783419](https://github.com/clossys/foundry/pull/1329#issuecomment-5802783419))
is the authoritative account; this section summarizes it, not the reverse.

## Enforcement: report-only, then enforce

This gate ships **report-only by default** (coordinator decision, round 5,
matching this repository's report-then-enforce pattern elsewhere).
`scripts/land-stack.mjs` always computes the full tier verdict — tier
classification, independence checks, decision-record lookups, every
refusal reason — and always prints it, for every pull request it
evaluates. Whether a would-be refusal actually blocks the merge depends on
a single switch: `governance/review-tiers.json`'s `"enforcement"` field,
read from the pull request's BASE commit (never the head, so a pull
request can never flip its own enforcement switch in the same diff being
graded), same as every other tier config value this gate reads.

- `"enforcement": "report-only"` (the default, and what a missing or
  unrecognized value also means): a refusal that WOULD have blocked the
  merge is instead reported with its full reason, prefixed
  `[report-only; would refuse under enforce mode]`, and the gate returns
  `ok: true` — the merge proceeds. Nothing about the underlying reasoning
  changes; only whether it blocks.
- `"enforcement": "enforce"`: refusals block exactly as described
  everywhere else in this document.

**Report-only genuinely never blocks or crashes a landing (round 6,
blocking, both reviewers).** An earlier draft of this promise held only
for the PURE-LOGIC refusals `applyEnforcement` was built to soften (a
missing reviewer pair, a missing decision record); it did NOT hold for the
new I/O this slice introduced — a `changedFiles` mismatch returned early,
bypassing `applyEnforcement` entirely; a missing `governance/review-tiers.json`
on the base (a stacked PR whose base predates this file), a PR-files or
PR-comments API error, or a malformed decision record on the base branch
all threw an uncaught exception, which crashes `--status`/`--merge`
outright regardless of `enforcement`. `runStatus` now determines
`enforcement` FIRST and independently (defaulting to `"report-only"` even
when the tier-config read itself is what fails), then wraps the entire
tier evaluation — file fetch, completeness check, classification,
comment/permission/decision-record reads, everything through the raw
verdict — in one try/catch. Under report-only, any failure in there
becomes a reported, non-blocking warning (`ok: true`, the error folded
into the reason) and the landing proceeds exactly as it would on `main`
today, with no gate at all. Under enforce, the same failures fail closed.
See "What changed after the round-6 reviews" below for the reviewers' own
findings, and `scripts/land-stack.test.mjs` for a test of each failure
mode in both enforcement modes, driven through `runStatus` with injected
fakes.

**Rollout plan:** the owner observes a week of real report-only verdicts
against real merge-train activity — does the tier split look right, does
any change that should have needed a decision record almost land without
one, does anything misclassify — before flipping the switch. **Changing
this value is itself a tier-2 change**: `governance/review-tiers.json` is
already in `tier2.globs` as the enforcement surface itself, and flipping
`"enforcement"` to `"enforce"` is a content change to that file like any
other, so it needs its own owner decision record the same as narrowing a
tier-2 glob would. This is deliberate — turning a gate ON so that it can
start blocking real merges is exactly the kind of consequential,
hard-to-reverse-in-practice change tier 2 exists for, even though turning
it back off afterward would be comparatively cheap.

`scripts/land-stack.test.mjs` exercises BOTH modes: `applyEnforcement`'s
own unit tests cover report-only (never blocks, but preserves the full
reason with its prefix) and enforce (passes a refusal through unchanged)
directly, and at least one `runStatus`-level test drives a real refusal
end to end under `enforcement: "enforce"` — a report-only-only test suite
could not have caught a wiring bug that left the enforce path unreachable
in practice.

## Tier-2 authorization survives restacks: patch-id, not head sha

Round 4 pinned a PR-scoped tier-2 authorization (`links.pullRequests` +
`links.headShas`) to the exact head sha the owner reviewed, reasoning that
an authorization tied to a PR number alone would otherwise cover whatever
head that PR carried later, not the commit actually decided about. Round 5
(reviewer 2, blocking) found that pin unsatisfiable in the normal case, not
just an edge case: **committing the decision record itself is what breaks
it.** The record lives in `governance/decisions/`, a tier-1 path; landing
it advances `main`; this repository's branch protection requires an open
pull request's base to be up to date before merge, so the very act of
landing the authorization puts the pull request it names into a `BEHIND`
state, forcing a restack; a restack — merge or rebase — changes the head
sha; the pin, computed against the pre-restack head, no longer matches
anything. A head-sha-pinned PR-scoped authorization for a not-yet-merged
PR is, by this construction, unsatisfiable the moment it is used for real.

**The fix pins the change's CONTENT instead of its position:**
`git patch-id --verbatim` computes a hash of a diff that ignores LINE
NUMBERS (so context shifting up or down the file does not change it), but
it DOES hash the surrounding CONTEXT LINES the diff carries — it is not
blind to everything around the PR's own changed lines. (`--verbatim`, not
`--stable`: see `defaultFetchPatchId`'s own doc comment and "Patch-id must
be whitespace-sensitive" below for why `--stable`'s whitespace-blindness
made it the wrong choice for files where whitespace is semantically
load-bearing, like YAML workflows and shell `run:` blocks — exactly the
tier-2 surface this pins.)

**Patch-id and restacks: what actually survives (corrected, round 6 — both
reviewers, blocking).** An earlier draft of this document claimed a
restack never changes the patch-id, full stop ("restacking does not change
the content of the diff being hashed"). That is too strong, and both
round-6 reviewers found the counter-example directly, in a scratch repo:
merging a `main` commit that changes an UNRELATED file, or a FAR-AWAY line
of the same file the PR also touches, leaves the patch-id unchanged. But
merging a `main` commit that changes a line WITHIN, or immediately
adjacent to, one of the PR's own diff hunks changes the patch-id, because
that line is part of the context the diff (and therefore the hash) carries
— even though the PR's own lines never moved. This is the CORRECT,
fail-closed behavior, not a bug: the merged content genuinely differs from
what the owner reviewed, so re-authorization is the right outcome, exactly
as a stale head-sha pin was meant to force. It does mean a patch-id pin is
narrower than "survives every restack" — it survives every restack THAT
DOES NOT TOUCH THE PR'S OWN HUNK CONTEXT, which is most restacks in
practice but not all of them, and is NOT something this gate can predict
in advance; it can only recompute and report a match or a refusal at merge
time.

The flow, worked end to end:

1. A pull request is reviewed and the owner decides to authorize it, at
   some head.
2. `git patch-id --verbatim` of that PR's net diff against its merge base
   (`gh api repos/{owner}/{repo}/compare/{base}...{head}` with the diff
   media type, piped to `git patch-id --verbatim`) is computed and recorded
   in a NEW decision record's `links.patchIds`.
3. That decision record is committed — landing through the merge train
   like any other tier-1 governance change, which advances `main`.
4. The authorized pull request, now `BEHIND` because the record's own
   commit moved `main` forward, restacks (merge or rebase) onto the new
   `main`. Its head sha has changed.
5. `scripts/land-stack.mjs`'s tier-2 gate recomputes the patch-id FRESH at
   merge time — it never trusts a value cached from review time. If the
   restack's base-branch changes did not touch lines within or adjacent to
   the PR's own hunks, the patch-id still matches `links.patchIds` and the
   PR merges, carrying the original authorization forward through the
   restack it was itself forced into. If the base-branch changes DID reach
   the PR's own hunk context, the patch-id no longer matches, the gate
   correctly refuses, and the owner authorizes a fresh decision record
   against the new patch-id — the pin lapsed because the merged content
   genuinely changed, not because of a bug.

`governance/decisions/weekly-release-calendar.json` is the worked example
— see its own `notes` field for PR #1316's actual, live situation, which
turned out to already illustrate this boundary rather than the easy case:
PR #1316's base branch is `claude/release-batching`, not `main`, and
#1316 is (independently of anything in this HITL slice) already one
commit behind that base, via a commit that touches files #1316 itself
also changes — so its own pin is expected to need re-computation before it
can land, exactly the "base changes reached the PR's hunk context" case
above, not the "false premise" an earlier draft of this record stated (that
record incorrectly said its OWN landing on `main` was what would force
#1316 `BEHIND` — #1316's base was never `main`).

**Known limitations, documented rather than left implicit:**
- For a merge-train BATCH pull request stacking several already-reviewed
  constituent pull requests, this gate checks the batch PR's own single
  patch-id against its own single merge base — it does not decompose the
  batch into per-constituent patch-ids and verify each constituent's
  authorization independently. A batch built from several individually
  tier-2-authorized constituents will not generally reduce to any single
  recorded patch-id; batching several tier-2 changes under one FRESH
  decision record, computed against the actual assembled batch, is the
  documented path today, not a shortcoming this slice claims to have
  closed.
- **Batch churn** (round 6, reviewer 1, non-blocking, worth stating):
  landing that fresh batch record itself moves `main` again, forcing the
  batch to restack — the same dynamic as any other tier-2 PR, but batches
  are the MOST exposed to it, since a batch's net diff typically spans more
  files and more lines than any single constituent PR, so it is more
  likely that some later, unrelated `main` change reaches into one of its
  hunks' context before the batch lands.

## Before switching to enforce

This is a checklist, not a blocker for landing report-only — each item is
tracked (see the linked issue), documented here rather than fixed in this
round, and should be resolved or explicitly accepted before
`governance/review-tiers.json`'s `"enforcement"` flips to `"enforce"`.

1. **Prose mentions of the marker name refuse the gate.** The `_parseError`
   fallback triggers on the bare substring `foundry-review-record`
   appearing ANYWHERE in a comment body, not only on a genuine `<!--`
   opener — round 6, one of the independent reviews ran the new parser
   over this very pull request's own review thread (every human comment
   treated as authorized) and found 4 of 12 comments produce
   `_parseError`, 2 of those from a comment that only NAMES the mechanism
   in prose, never opens it. Harmless today: a `_parseError` refusal is
   only ever REPORTED under `"report-only"`, never blocking. It would
   make `"enforce"` unusable on any pull request whose own discussion
   names the mechanism, which is likely to be common on this repository's
   own governance/tooling PRs. **Fix before enforce:** trigger the
   fallback only on the `<!--` opener sequence followed by the marker
   name, not on the bare word.
2. **The tier-2 publish path's import closure is only partly tier-2, while
   `scripts/lib/**` alone drives most tier-2 landings.** Measured
   independently by both round-6 reviews, using two different methods that
   land close together: real landings on `main` diffed against their own
   first parent (the `git log --first-parent --merges` method) put tier-2
   at 40 of the last 200 (20%) <!-- facts-gate:ignore -->, with
   `scripts/lib/**` alone accounting for 28 of those 40; the same 200
   pull requests' own file lists (a second, independent method: each PR's
   own reported file list rather than a diff-tree) put it at 35 of 200
   (17.5%) <!-- facts-gate:ignore -->. Separately,
   the four literal tier-2 publish/deprecate scripts statically import
   seven tier-1 modules that run INSIDE the tier-2 flow
   (`validate-candidate-publish`, `select-publishable-packages`,
   `plan-qualified-publish-set`, `registry-version-lookup`,
   `verify-post-publish-public-npm-artifact`,
   `check-qualification-record-present`, `check-release-catalog`) — a
   tier-1 change to any of them can alter, or add to, what the tier-2 job
   holding the publish token actually does, and the "literal `npm
   publish`" grep this round ran is a one-time check, not something this
   gate re-verifies on every PR. An alternative, measured with the same
   PR-file-list method as the 35/200 figure above (an apples-to-apples
   comparison): make tier-2 the CLOSURE of the publish/deprecate roots —
   the executables plus those seven modules plus eight specific
   `scripts/lib/` files the closure actually reaches — and move the REST
   of `scripts/lib/**` to tier-1. That measures 21 of 200, i.e. 10.5% by the same PR-file-list method as above <!-- facts-gate:ignore -->,
   instead of 35 of 200, i.e. 17.5% restated from above <!-- facts-gate:ignore -->,
   and covers what the tier-2
   flow actually executes rather than a whole directory by convention.
   **Decide before enforce:** keep the current broad `scripts/lib/**`
   (simpler, more conservative, costs more owner review) or adopt the
   closure-based scope (cheaper, needs a guard test — "a
   workflow-reference-style test asserting the closure stays tier-2" — to
   keep it from silently drifting stale as the closure changes).
3. **The workflow-reference path extractor still mangles a
   `.trusted-scripts/`-relative path.** `extractWorkflowReferencedPaths`
   turns `$GITHUB_WORKSPACE/.trusted-scripts/scripts/check-*.mjs`
   (`.github/workflows/ci.yml`, `.github/workflows/conversation-safety-head.yml`
   both reference paths this shape, since those jobs deliberately check
   out a second, pinned copy of `scripts/` under `.trusted-scripts/` for
   exactly the tamper-resistance `ci.yml`'s own comments describe) into a
   non-existent `scripts/scripts/...` path when computing what
   `findUnclassifiedWorkflowPaths` should check. Harmless TODAY only
   because `tier1.globs` is the broad `scripts/**`, so the mangled path
   still happens to classify tier-1 by accident, not because the extractor
   got it right — which means `findUnclassifiedWorkflowPaths`'s own guard
   (asserting every workflow-referenced script path classifies at least
   tier-1) cannot actually fail on this class of bug today, silently
   passing over a real path the extractor never correctly identified.
   **Fix before enforce** (or before `tier1.globs` is ever narrowed away
   from the broad `scripts/**`, whichever comes first): teach the
   extractor to strip a `.trusted-scripts/` (or `$GITHUB_WORKSPACE/.trusted-scripts/`)
   prefix back to the real `scripts/` path it refers to, and add a test
   fixture exercising it.
4. **An unreadable base-branch tier config fails open even when `main`'s
   config says `"enforce"`** (round 6, second reviewer, blocking — see
   "Bootstrapping this gate" below for the mechanism). `runStatus`
   determines `enforcement` before it can catch anything, so when the
   config read itself is what fails — a transient Contents API error, or a
   pull request whose base branch is not `main` and predates this file,
   as PR #1316's `claude/release-batching` base currently does —
   `enforcement` cannot be resolved from a value that never loaded and
   defaults to `"report-only"` regardless of what `main`'s own config
   actually says. This is a reasoned, deliberate choice for report-only
   (nothing should crash the conductor while report-only is the default
   for everything), but it is a real fail-open under `"enforce"` that has
   not been designed for. **Needs a design before enforce**, for example:
   cache the last successfully-read `enforcement` value and fall back to
   THAT (not a hardcoded default) on a read failure, rather than always
   falling back to `"report-only"`; or, specifically when the pull
   request's own base branch IS `main`, treat a read failure as `"enforce"`
   (fail closed) rather than `"report-only"` (fail open), since a
   Contents-API error reading a file that almost certainly exists on
   `main` is a stronger signal of a transient problem than of a genuinely
   missing config. Either design needs its own tests exercising the
   failure path under each resulting mode.

One more worth stating plainly rather than tracking separately (round 6,
second reviewer, non-blocking): `headSha` must always be written as the
FULL 40-character SHA (`docs/contracts/review-record.json` says so
explicitly); a reject posted with a SHORT prefix of an already-stale head
can never be confirmed as a genuinely different commit, so it stays
ambiguous and keeps refusing the gate at every later head too, not just
its own, until the comment carrying it is edited to the full SHA or
deleted — fail-closed, and harmless under report-only, but worth knowing
before relying on `"enforce"`.

The four items below are new: gaps between the owner-ratified "Escalation
rule" above and what `scripts/land-stack.mjs` actually enforces today
(see that section's own "What this rule changes about the code, and what
it does not" for the full mapping). None of them is a bug in the code
that exists — they are refinements the ratified rule ADDS on top of the
original decision-tier rule, not yet implemented, so there is nothing to
"fix" before enforce so much as something to BUILD. Listed here because
the same principle applies: shipping `"enforce"` on the existing tier-1
gate should not be read as also having shipped these.

5. **The fresh-final-reviewer requirement (Accepted item 6) is not
   implemented.** The ratified text: "For governance, security or gate
   changes, the last approval has to come from a fresh strong-class
   reviewer with no history on the PR." Nothing in `scripts/land-stack.mjs`
   tracks which reviewer instances have already posted on a given pull
   request, so nothing could enforce "fresh" even in principle today —
   `evaluateTier1Independence` only checks that the two independent
   records differ from each other and from the author, not that either is
   new to the thread. **Needs before enforce, for governance/security/gate
   paths specifically:** a way to identify reviewer history on a PR
   (likely a third, distinct `role` or a `historyOnPr` field on the review
   record) and a rule that refuses a qualifying pair whose "final" record
   has posted before.
6. **Blind verdicts (Accepted item 6) are not implemented or checkable.**
   The ratified text: "both verdicts are given before either sees the
   other's." This describes a PROCESS constraint on how a reviewing
   session forms its opinion, not a fact the review record's own JSON
   shape can carry or that `land-stack.mjs` could verify after the fact
   from GitHub's API alone — there is no timestamp-of-first-read a comment
   records. **Needs a design before enforce**: most likely an
   honour-system field (`blindVerdict: true`, self-declared, the same
   class of self-declared field `docs/contracts/decision-record.json`'s
   own `relaxesGateOrPolicy` note already discusses) rather than a
   mechanically-verifiable one, documented as such rather than implied to
   be checked.
7. **"Both reviewers strong-class" (Accepted item 6, and the "Two
   reviews" table row) is not implemented or checkable.** Nothing in
   `scripts/land-stack.mjs` or `docs/contracts/review-record.json` checks
   a reviewer's `model`/`provider` against any notion of "strong-reasoning
   class" — the schema records those fields but never validates them
   against a qualification list. **Needs before enforce:** a model
   allowlist that actually feeds this check (see
   `governance/model-qualifications/allowlist.json`, drafted but not yet
   read by any gate), or an equivalent honour-system declaration,
   documented as such.
8. **Model-diversity recording is not a structured, checkable fact.**
   Every review record already carries `model` and `provider`
   (`docs/contracts/review-record.json`), and `evaluateTier1Independence`
   already REQUIRES the qualifying pair to differ in `model` or
   `provider` — so pairwise diversity for tier-1 independence is checked
   today. What is not implemented is anything BEYOND that pairwise check:
   there is no aggregate report of model diversity across a PR's full
   review history, no structured field distinguishing "record model
   diversity" as its own concern from the independence check it currently
   rides on, and nothing that would let a later governance/security/gate
   rule (such as the fresh-final-reviewer requirement in item 5 above)
   reason about diversity across MORE than two records. **Needs before
   enforce, if a use beyond pairwise independence is needed:** a
   structured summary this repository does not currently produce.
9. **The land-log-and-notify digest cap of 5 items, ranked by risk, is
   not implemented.** The ratified text (Accepted item 7): "at most 5
   items per digest, ranked by risk, each with its revert" — and the
   "Land, log and notify" table row: "Two reviews, a decision-log entry,
   and at most 5 digest items you can veto." No digest artifact, no
   revert-tracking, and no risk-ranking exists anywhere in this
   repository. **Needs before enforce (or before this mode is used at
   all):** the whole land-log-and-notify mechanism is new work, not a fix
   to something existing; scope it as its own slice.
10. **The 8-week notify-scope narrowing is not implemented.** The
    ratified text (Accepted item 7): "if you veto nothing for 8 weeks,
    the notify category gets narrower." Depends entirely on item 9 above
    existing first (there is no notify category to narrow without a
    digest), so this is downstream of that work, not a separate gap to
    close independently.
11. **"An enforce ask must include measured report-only results" (Accepted
    item 3) is not automated.** The ratified text: "When you're asked to
    switch a gate to enforce, the ask must show the combined change since
    you last approved that gate, plus measured results from its
    report-only run." Nothing in this repository currently generates that
    combined-change summary or gathers report-only measurements
    automatically — any future ask to flip `governance/review-tiers.json`'s
    `"enforcement"` to `"enforce"` would need to assemble this by hand.
    **Needs before enforce:** tooling that diffs the tier-2 surface since
    the last owner approval and summarizes a period of report-only
    verdicts (false positives and misses), so the ask itself is not the
    first place this evidence gets assembled.
12. **The rule's own living copy and record were, until this pull
    request, mechanically classified below owner-approve-first.** Fixed
    in this same pull request — see "Tier coverage for changing this
    rule" above — listed here only so the gap this closes is on record,
    not because it remains open.

Filed as a single tracking issue listing all twelve items (searched for
duplicates first, none found): issue
[#1350](https://github.com/clossys/foundry/issues/1350).

## Bootstrapping this gate

**Corrected in round 6** (second reviewer, blocking): this section
previously described `defaultReadReviewTierConfig` as throwing on a
missing base-ref config, which was true before round 6's report-only
fail-open fix and is no longer true. What follows is the CURRENT behavior.

`governance/review-tiers.json` does not exist on `main` until this very
pull request merges it. Every pull request `land-stack.mjs` classifies
before that merge — including this one — reads a base ref where the file
404s. `readReviewTierConfig` still throws internally (the underlying read
failure is not hidden), but `runStatus` now catches that throw in the same
try/catch that wraps the whole tier evaluation (see "Enforcement:
report-only, then enforce" above): with no config to read, `enforcement`
cannot be determined and defaults to `"report-only"`, so the resulting
tier-evaluation failure is reported as a warning and `land-stack.mjs
--status`/`--merge` return `ok: true` rather than throwing or refusing.
**This pull request CAN now pass `land-stack.mjs --status` against
itself**, under report-only, precisely because there is no prior tier
config to classify it against — that absence is exactly what report-only
is built to tolerate. The initial landing of this file is therefore no
longer *necessarily* a plain `gh pr merge` bypassing this gate entirely; a
plain `gh pr merge` remains available (the documented skip path above) and
remains how an owner would choose to land it under enforce, but it is no
longer the sole path once report-only is what everything defaults to.

**This same fallback is an ENFORCE-MODE gap, not just a bootstrap
convenience** (round 6, second reviewer, blocking — folded into the
"Before switching to enforce" checklist below as item 4): if
`main`'s own `governance/review-tiers.json` says `"enforce"` but the
Contents API read of it fails for any reason — a transient error, or a
pull request whose base branch is not `main` and predates this file, as
PR #1316's `claude/release-batching` base currently does — `enforcement`
still cannot be determined from a value that never loaded, and the
landing proceeds as report-only regardless of what `main` actually says.
This is a deliberate, reasoned design for report-only (nothing should ever
crash the merge-train conductor while report-only is what the whole gate
defaults to), but it is a real, undocumented-until-now fail-open under
enforce that needs a decision before the switch flips — see item 4 below.

Every later change to `governance/review-tiers.json`, once a version of it
exists on `main` to read, goes through the gate normally.

## Honour-system limits — stated plainly

Every agent session in this repository authenticates through **the same
GitHub account — the owner's own**. The authorization check above
(`isAuthorizedCollaboratorPermission`) closes the gap where a completely
unrelated, unauthenticated-to-this-repository GitHub account could forge a
`foundry-review-record` — a real gap on a public repository, and the one the
`df15ab87` review found. It does **not**, and by construction cannot, close
the gap below it: every agent session run under the owner's own account
already holds `admin`/`write` permission, so the authorization check cannot
tell two DIFFERENT agent sessions (or the same session posting twice) apart
from each other. That deeper honesty boundary is what the rest of this
section is about. (Distinct from the section above: everything here is a
limit this design accepts on purpose, not a bug it missed.)

- **`foundry-review-record` comments from the owner's own account are
  trust-but-verify, not forgery-proof.** Nothing stops a session
  authenticated as the owner from posting two records under two different
  `instanceId`s for its own change — the authorization check does not, and
  cannot, distinguish this from two genuinely independent sessions. What
  raises the real cost of doing that is binding: a record must carry the
  pull request's *exact* current `headSha` (a stale record is dropped, never
  trusted), a distinct `instanceId` from the declared author record, a
  `model`/`provider` pair that genuinely differs, and the required
  primary/secondary depth pairing. Faking all of that *consistently*, across
  two records, is more work than actually running the second review — but
  it is not impossible, and this slice does not claim otherwise.
- **An edited or unparseable record block from an AUTHORIZED comment
  refuses the WHOLE tier-1 gate, not just that one record — but only at the
  current head, and only once detected.** `findSuspiciousRecordComments`
  compares a GitHub comment's `created_at` and `updated_at`; a difference
  at the pull request's current head, on a comment confirmed to be an
  admin/write collaborator's, refuses the merge outright, forcing a human
  to remove or repost the comment rather than the gate silently working
  around it. An UNAUTHORIZED comment is never suspicious this way, however
  garbled — the round-4 review found an earlier draft of this check ignored
  authorization entirely, so any stranger could permanently block every
  tier-1/tier-2 PR by posting one malformed comment. This closes the
  specific attack the `df15ab87` review probed too: editing an authorized
  `reject` comment no longer makes the pair around it look clean, because
  ANY edit (from an authorized account) refuses the gate, not just the
  edited record's own verdict. The honest limit: it is a blunt instrument
  for an authorized comment (a typo fix refuses the gate exactly as hard as
  a changed verdict would), and it only ever looks at the CURRENT head — a
  comment edited, then a new commit pushed, then reverted back to the same
  head, is a sequence this slice has no way to reconstruct from the
  comment's current `updated_at` alone.
- **A `reject`/`changes-requested` record is sticky, but only for the exact
  head it names, and only clears via a commit that actually changes
  something.** `findStickyRejections` makes a reject unrecoverable by any
  later record at that SAME head, matched case-insensitively and by an
  unambiguous 7+ character SHA prefix — the sole way to clear it is a
  genuinely new head whose own commit changes at least one file
  (`isNoOpHeadCommit` refuses a no-op commit like `git commit
  --allow-empty` outright, for any tier-1/tier-2 PR, so a no-op push cannot
  be used to manufacture a fresh, reject-free head on its own). There is no
  decision-record override path defined or implemented in this slice at
  all; clearing a sticky reject today means pushing a real change, full
  stop, and the NEXT head then merges on two fresh approvals with no owner
  involvement — "reject escalates to the owner" holds only within one
  head, not across a push. This is deliberately one-directional: there is
  no mechanism here for an owner to un-stick a reject without also changing
  the code.
- **Deleting a reviewer's comment clears their reject (honour-system
  limit, round 5).** A sticky reject exists only as long as the comment
  that carries its `foundry-review-record` block still exists — `land-stack.mjs`
  reads the PR's CURRENT comments each time it runs, not a durable log of
  every comment ever posted. A GitHub comment can be deleted by its own
  author (or by anyone with sufficient repository permission) at any time;
  once deleted, `findStickyRejections` has nothing left to find, and the
  reject it enforced is gone as though it had never been posted. Nothing in
  this slice detects or refuses a deleted authorized comment the way it
  refuses an EDITED one (`findSuspiciousRecordComments` compares
  `created_at`/`updated_at` on comments that still exist; a deleted comment
  is simply absent from the next fetch, indistinguishable from one that was
  never posted). This is the same honour-system boundary as everything else
  in this section: every session authenticates as the owner's own account,
  so this is not a stranger silently un-blocking a PR, but it is a real gap
  an owner relying on this gate should know about.
- **`relaxesGateOrPolicy` on a decision record is self-declared.** Nothing
  verifies that a record's own characterization of its change (whether it
  loosens a real control) matches what the change actually does. A record
  can declare `false` to avoid the sunset requirement while, in substance,
  relaxing something. See `docs/contracts/decision-record.json`'s own note
  on this field for the same point.
- **The decision log is append-only through this gate, not through git
  itself.** `land-stack.mjs`'s `evaluateChangedDecisionRecords` now refuses
  any pull request that edits the content of an already-`"decided"`
  record — that closes the path through the merge-train conductor. It does
  NOT close every path: nothing outside this one gate prevents a session
  with direct push access, or a merge performed by any other route (a
  plain `gh pr merge`, the web UI — see above), from editing a past
  `governance/decisions/*.json` file directly. `scripts/check-decision-
  records.mjs` validates shape, expiry, and sunset on the committed tree,
  but it does not verify that a file's content matches what a prior commit
  actually said either.
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
  entirely.** Repeated from above because it is a major honour-system
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
- `gh api ... .../branches/<branch>/protection` — branch-protection reads or
  edits via the REST API directly, including a slash-named branch such as
  `claude/foo` (an earlier pattern stopped at the initial `/` and missed this)
- `gh api -X DELETE .../git/refs/heads/<branch>` or `gh api --method DELETE
  .../git/refs/heads/<branch>` (both forms) — deleting a branch via the raw
  Git refs API, a second path to the same end `git push --delete` already
  covers
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
- A Bash-level, best-effort attempt at a direct shell overwrite of
  `governance/decisions/hitl-escalation-rule.json` or `docs/HITL.md` (the
  escalation rule's own decision record and its living copy) via
  redirection (`>`/`>>` immediately before the path), `sed -i`,
  `truncate`, `rm`/`git rm`, `cp`, `mv`, `tee`, `install`, `dd of=`, or
  `perl -pi` — matched loosely on the BASENAME alone (`hitl-escalation-rule.json`
  or `HITL.md`, not the full path), so a `cd governance/decisions &&
  echo x > hitl-escalation-rule.json` shell sequence is still caught even
  though the command line never spells out the directory. This is a
  SEATBELT ON TOP OF, not a replacement for, the immutability
  `scripts/land-stack.mjs`'s `evaluateChangedDecisionRecords` already
  enforces through the normal PR flow (a `"decided"` record's content can
  never change in place, only be superseded by a new record).
- The same, for this hook's own installed script (matched loosely, by any
  path ending `deny-tier2.mjs`) and for `~/.claude/settings.json` (which
  registers the hook in the first place — protecting the script without
  protecting the file that turns it on would not be real protection at
  all).

**THIS IS BEST-EFFORT AND HONOUR-SYSTEM, NOT REAL WRITE-PROTECTION —
STATED PLAINLY RATHER THAN CLAIMED OTHERWISE** (#1187 escalation-rule
round 2, both reviewers, blocking: an earlier version of this section said
a session "cannot defang its own seatbelt by editing the file that
implements it" and called the missing Edit/Write coverage "intentional,
not a gap" — both false). Measured directly against the patterns below,
ALL of these are ALLOWED, not blocked, against either the rule record or
the hook script:

- `echo x | tee <path>` (writes via a command this hook's write-verb list
  did not originally include, now added, but `tee`'s own many argument
  forms are not exhaustively covered)
- `git checkout <ref> -- <path>` or `git restore --source=<ref> <path>`
  (restoring a file from history is not, itself, one of the matched verbs)
- `python3 -c "open(path,'w')…"`, `node -e "writeFileSync(path,…)"`, or any
  other interpreter one-liner — this hook only ever matches shell command
  TEXT, never what a spawned interpreter then does
- A path held in a shell variable set on a previous line (`F=hitl-escalation-rule.json;
  echo x > "$F"`) — the pattern never sees the literal filename on the
  matched line at all
- `chmod 000 <hook script>` or `ln -sf /tmp/x <hook script>` — neither
  writes the file's own bytes, so neither matches a write-verb pattern,
  but both can still defeat the hook (permission-denied or a redirected
  symlink)
- `sed -i '' /deny-tier2/d ~/.claude/settings.json` or any other edit to
  `~/.claude/settings.json` that removes the hook's own registration —
  matched no better or worse than the rule record and the hook script
  themselves, by the same best-effort verb list, with the same gaps

**Claude Code's own Edit, Write, MultiEdit, and NotebookEdit tools are
NEVER matched by a `Bash`-matcher hook at all** — not narrowed to them
being "intentional", simply true: a `PreToolUse` hook only sees the tool
calls its own `matcher` names. For the repository files this hook
protects (the decision record, `docs/HITL.md`), an Edit-tool change is
also the NORMAL, PR-reviewed path a legitimate change already takes — the
gap matters less there. For `~/.claude/hooks/deny-tier2.mjs` and
`~/.claude/settings.json`, which live OUTSIDE any repository, entirely, an
Edit-tool change goes through NO diff, NO reviewer, and NO gate at all —
there is no "normal path" to fall back on for either file. A second
`PreToolUse` entry below, matched on `Edit|Write|MultiEdit|NotebookEdit`
and checking `tool_input.file_path` directly (a field those tools' own
call shape always carries, so this check is exact, not a regex guess
against free-form shell text), closes exactly that gap for all four
protected paths.

**Real write-protection needs something no hook running inside the same
session can provide**: OS-level file permissions set by the owner, on a
different user account than the one agent sessions run as, or the
signed-commit verification the escalation rule's own Accepted item 1
describes as the eventual end state. Until either exists, every pattern
in this document — old and new — is a deterrent against an ACCIDENTAL
tier-2 command, not a barrier a session that has decided to defeat it
cannot cross.

It does **not** block, and an owner relying on it should know this:

- Any of the above run through a wrapper script, a Makefile target, `npm
  run <script>` that shells out to one of these commands, or any other
  indirection the regex list does not literally match.
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
- The full list of bypasses just enumerated above, for the two
  write-protection patterns specifically.

**Fixed false positives on read-only commands (round 2, both reviewers,
non-blocking, cheap to fix):** an earlier version of the write-protection
patterns matched a write VERB or redirect operator ANYWHERE earlier in the
same line as the protected path, so `cat <rule> 2>/dev/null`, `jq . <rule>
> /tmp/copy.json`, `git diff HEAD -- <rule> > /tmp/d.txt`, and `rm -f
/tmp/x && cat <rule>` were all wrongly blocked — none of them writes the
protected file at all. The patterns below now require the write verb (or
redirect operator) to be directly adjacent to the path, with no `&&`,
`;`, or `|` command separator in between, so a redirect or removal
elsewhere on the line, or an unrelated command chained before a plain
read, no longer matches.

### Example hook body

Save this as (for example) `~/.claude/hooks/deny-tier2.mjs`:

```js
#!/usr/bin/env node
// User-level PreToolUse hook (Bash matcher): deny the always-human
// (tier-2) command shapes from docs/HITL.md in clossys/foundry. Reads the
// tool-call JSON Claude Code passes on stdin; exits 2 (block) with a
// reason on stderr for a match, exit 0 (allow) otherwise. This is a
// SEATBELT, not a lock -- see docs/HITL.md's "What it does and does not
// block" for the named gaps, and "THIS IS BEST-EFFORT AND HONOUR-SYSTEM"
// for what write-protection specifically cannot guarantee.

// Builds write-protection patterns for one protected file, matched by
// BASENAME alone (so a relative-path or cd'd-into-the-directory command
// still matches). The write verb/operator must sit DIRECTLY next to the
// path -- no "&&", ";", or "|" command separator in between -- so an
// unrelated command earlier or later on the same line, or a redirect
// into a DIFFERENT file, does not false-positive (#1187 escalation-rule
// round 2, both reviewers, non-blocking: an earlier version matched a
// write verb ANYWHERE earlier on the line, which wrongly blocked plain
// reads like `cat <path> 2>/dev/null` or `rm -f /tmp/x && cat <path>`).
function writeProtect(basenamePattern) {
  const gap = "[^&;|\\n]*"; // flags/args only, never crossing a command separator
  const path = `(?:\\S*/)?${basenamePattern}\\b`;
  return [
    new RegExp(`\\b(?:sed\\s+-i|truncate|rm|git\\s+rm|cp|mv|tee|install|dd\\s+of=|perl\\s+-pi)\\b${gap}${path}`, "i"),
    new RegExp(`(?:>>?)\\s*${path}`, "i"), // redirect operator immediately before the path
  ];
}

const DENY_PATTERNS = [
  /\bgh\s+api\b[^\n]*\/pending_deployments\b/i,
  /\bgh\s+api\b[^\n]*\/rulesets\b/i,
  /\bgh\s+api\b[^\n]*\/environments\b/i,
  // branches/<branch>/protection -- <branch> can itself contain a "/"
  // (e.g. claude/foo), so this must NOT stop at the first slash the way
  // [^/\s]+ would (#1187 review at df15ab87, should-fix nit).
  /\bgh\s+api\b[^\n]*\/branches\/\S+\/protection\b/i,
  // Deleting a branch via the raw Git refs API instead of `git push
  // --delete` -- a second way to the same always-tier-2 end this hook's
  // git-push patterns below do not see at all (#1187 review at df15ab87,
  // should-fix nit). Matches both gh's short (`-X`) and long (`--method`)
  // form -- an earlier pattern caught only `-X DELETE` and missed `--method
  // DELETE`, which exits 0 (#1187 review round 4, should-fix nit 8).
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
  // Write-protection: the escalation rule's own decision record and its
  // living copy, this hook's own installed script, and the settings file
  // that registers it -- BEST-EFFORT, honour-system, Bash-command-text
  // matching only. See docs/HITL.md for the full list of known bypasses
  // this cannot catch (tee, cp, mv, interpreters, a path held in a
  // variable, chmod/symlink games, and any edit made through Claude
  // Code's own Edit/Write/MultiEdit/NotebookEdit tools, which the SECOND
  // hook entry below -- a different matcher -- exists to cover instead).
  ...writeProtect("hitl-escalation-rule\\.json"),
  ...writeProtect("HITL\\.md"),
  ...writeProtect("deny-tier2\\.mjs"),
  // "settings.json" is matched by bare basename, deliberately broader
  // than only ".claude/settings.json" -- a false positive here (blocking
  // an unrelated settings.json write) is cheap; missing the one write
  // that disables this hook is not.
  ...writeProtect("settings\\.json"),
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

Save a SECOND script as (for example) `~/.claude/hooks/deny-tier2-edit.mjs` — this one matches
Claude Code's `Edit`, `Write`, `MultiEdit`, and `NotebookEdit` tools directly, checking
`tool_input.file_path` (a field those tools' own call shape always carries) against the
same four protected paths, rather than trying to infer a file path out of free-form shell
text:

```js
#!/usr/bin/env node
// User-level PreToolUse hook (Edit|Write|MultiEdit|NotebookEdit matcher):
// deny an edit whose OWN file_path targets one of the same protected
// paths the Bash hook above covers by best-effort text matching. This
// hook is EXACT, not a regex guess -- tool_input.file_path is the real
// path the tool is about to write, supplied by Claude Code itself.

const PROTECTED_BASENAMES = [/hitl-escalation-rule\.json$/i, /HITL\.md$/i, /deny-tier2(-edit)?\.mjs$/i, /settings\.json$/i];

let input = "";
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", () => {
  let payload;
  try {
    payload = JSON.parse(input);
  } catch {
    process.exit(0); // fail open on unparseable input, same as the Bash hook
  }
  const filePath = typeof payload?.tool_input?.file_path === "string" ? payload.tool_input.file_path : "";
  if (!filePath) process.exit(0);

  const hit = PROTECTED_BASENAMES.find((re) => re.test(filePath));
  if (hit) {
    process.stderr.write(
      `Blocked by user-level deny hook (docs/HITL.md, clossys/foundry): editing this path is tier-2 (owner only). Path: ${filePath}\n`,
    );
    process.exit(2);
  }
  process.exit(0);
});
```

### Install steps

1. Save both scripts above: `~/.claude/hooks/deny-tier2.mjs` and
   `~/.claude/hooks/deny-tier2-edit.mjs`. Make both executable:
   `chmod +x ~/.claude/hooks/deny-tier2.mjs ~/.claude/hooks/deny-tier2-edit.mjs`.
2. Open your **user-level** Claude Code settings —
   `~/.claude/settings.json` (create it if it does not exist; this is your
   personal machine-wide settings file, not anything tracked in this or any
   other repository).
3. Add TWO `PreToolUse` hook entries — one matching `Bash`, one matching
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
   governance/decisions/hitl-escalation-rule.json`, `sed -i s/x/y/
   ~/.claude/hooks/deny-tier2.mjs`, and `sed -i '' /deny-tier2/d
   ~/.claude/settings.json` to confirm the slash-branch, repo-edit,
   refs-DELETE, and the write-protection cases all block. Then try `cat
   governance/decisions/hitl-escalation-rule.json` and `git diff HEAD --
   docs/HITL.md > /tmp/d.txt` to confirm plain reads are NOT blocked.
6. Verify the `Edit|Write|MultiEdit|NotebookEdit` hook: ask a session to
   edit `docs/HITL.md` or `governance/decisions/hitl-escalation-rule.json`
   directly with the Edit tool (not a shell command). It should be blocked
   before the edit is applied, with the path printed above — this is the
   coverage the `Bash`-only hook cannot provide for
   `~/.claude/hooks/deny-tier2.mjs` and `~/.claude/settings.json`
   specifically, since neither lives inside a reviewed repository.

If you already have other `PreToolUse` hooks configured, add these as
additional entries under their respective `matcher`s rather than replacing
what is there — Claude Code runs every matching hook.
