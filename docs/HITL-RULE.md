# HITL escalation rule (the rule file)

This is **the rule file** the ratified escalation rule's own closing
clause refers to when it says agents can't write to it: `docs/HITL.md`
(this document's own sibling, the living implementation-mapping and gate
documentation) links here rather than containing this text itself, so
that ordinary edits to `docs/HITL.md` (fixing a typo, updating a
cross-reference, documenting a new gate) never touch tier-2, owner-only
territory, and so that "the rule file" is one specific, small file a
protection mechanism can actually name.

This file, and any record under `governance/decisions/hitl-escalation-rule*.json`
that supersedes the one below, are classified **tier-2** by
`governance/review-tiers.json`'s `tier2.globs`, and are listed in the
protected paths of the user-level deny hook described in
[`docs/HITL-HOOKS.md`](HITL-HOOKS.md) (also tier-2, for the same reason
this file is — see that file's own header). As of round 8, `tier2.globs`
also names the WHOLE `governance/decisions/**` directory directly (#1187
escalation-rule round 9, fresh final reviewer, non-blocking: an earlier
draft of this paragraph described only the narrower
`hitl-escalation-rule*.json` glob, which by itself would miss a
same-rule-superseding record under a name that doesn't match that
naming convention) — see `governance/review-tiers.json`'s own `$comment`
for why.

## Escalation rule (owner-ratified 2026-09-23)

The rule below **supersedes** the informal decision-tier prose this
document opened with through round 6 (kept, unchanged apart from one
2026-09-23 pointer to the amendment below, as `docs/HITL.md`'s
"The three tiers" section — moved there in round 3 along with the rest of
this document's non-rule content — since it is what the CODE in this
slice actually classifies today — see "What this rule changes about the
code, and what it does not" at the end of this section for the gap
between the two, and "Implementation notes" right after the quoted text
for where this repository is MORE SPECIFIC than the rule itself). The
coordinator presented it for
ratification in the coordinator chat on 2026-09-23 at approximately
14:35 PDT ("Final rule for your ratification … Recommendation: ratify"),
and the owner replied "go". That same exchange also authorized: "I'll have
the rule written into docs/HITL.md and the decision log, citing this chat,
and reviewed as a governance change" (docs/HITL.md was this rule's home at
the time; it moved into this file, docs/HITL-RULE.md, in round 3 — see
"Tier coverage for changing this rule" below) — that is the authorization
for this section and for the pull request that added it.
[`governance/decisions/hitl-escalation-rule.json`](../governance/decisions/hitl-escalation-rule.json)
is the durable, append-only record of that ratification — `channel:
"owner-chat", not independently verifiable`, per the ratified text's own
"Where I'm pushing back" section (NOT Accepted item 1, which is about
channel-sourcing generally but does not contain this exact phrase),
applied reflexively to its own adoption.

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

**Amended 2026-09-23, updated 2026-09-24 (not part of the ratified text
above).** The quoted text above is kept exactly as ratified, as history.
Two parts of it are superseded by the owner-ratified review-convergence
amendment, as its decision record reads it: the "3 rounds that go
nowhere" trigger (Accepted item 5, and the "Your approval first" table
row) is replaced by the amendment's round budget and triggers, and the
table's "batched for Friday unless urgent" is replaced by the amendment's
same-day escalation ask. The Friday supersession is that record's reading
of item 5, not words the owner ratified. On 2026-09-24 the owner answered
"Restore it" to a follow-up question about the urgency exception dropped
in that reading: an ask that is genuinely urgent and about credentials or
publishing may still be raised at any time; every other ask stays under
item 5's twice-a-day limit. See
[Amendment (2026-09-23): review convergence](#amendment-2026-09-23-review-convergence)
below. Everything else above stands unchanged.

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
  classifies below what one file alone would demand — see `docs/HITL.md`'s
  "The three tiers" section). This file (`docs/HITL-RULE.md`),
  `docs/HITL-HOOKS.md`, and `governance/decisions/hitl-escalation-rule*.json`
  are all in `tier2.globs`, specifically because the MECHANICAL path
  assignment would otherwise put the rule's own living copy at tier-0, the
  deny hook that is meant to protect it at tier-1, and the decision
  record at tier-1 — see "Tier coverage for changing this rule" below.
- **Implementation of the "Final rule" table's "Two reviews" row, governance/security/gate carve-out**:
  not yet implemented. `evaluateTier1Independence` enforces two
  independent reviewers but has no notion of a required strong-class
  reviewer, "verdicts given before either sees the other's", or a fresh
  strong-class reviewer with no history on the PR (Accepted item 6's own
  words: "the last approval has to come from a fresh strong-class
  reviewer with no history on the PR") for any path,
  governance/security/gate or otherwise (#1187 escalation-rule round 8,
  strong-class reviewer, blocking B7: an earlier draft put "strong-class"
  in quotation marks as "strong-reasoning class" — a paraphrase, not the
  ratified text's own term — corrected to the exact word the rule uses;
  #1187 escalation-rule round 9, both reviewers, blocking: a later draft
  of this SAME sentence then quoted "a fresh final reviewer with no
  history on the PR", splicing the table's "a fresh final reviewer" onto
  item 6's "with no history on the PR" as if it were one phrase from one
  place — corrected here to item 6's own unspliced words, unquoted
  everywhere else it isn't a direct quote). Tracked in #1350 and
  `docs/HITL.md`'s "Before switching to enforce" section.
- **Implementation of the "Land, log and notify" mode**: not implemented
  at all. No digest, no revert-tracking, no risk-ranking, no 8-week-shrink
  logic exists anywhere in this repository.
- **Implementation of "Changing this rule itself"**: this file
  (`docs/HITL-RULE.md`), `docs/HITL-HOOKS.md`, and
  `governance/decisions/hitl-escalation-rule*.json` are all in
  `tier2.globs` (see above), and the deny-hook script described in
  `docs/HITL-HOOKS.md` (`scripts/hooks/deny-tier2-edit.mjs`, real and
  tested, not documentation only -- the companion Bash-matched hook was
  removed by owner decision in round 8; see `docs/HITL-HOOKS.md`'s own
  history section) names all three paths in its protected-path list.
  Neither the tier classification nor the hook is a verification that a
  change to any of these files was actually owner-ratified; both are the
  path-classification and best-effort protection layer only. See
  `docs/HITL.md`'s "Honour-system limits" section for what neither can
  do.

### What this rule changes about the code, and what it does not

**Report-only mechanics are unchanged.** This ratification is a policy
document and a decision record; it does not touch `scripts/land-stack.mjs`'s
report-only default, described in `docs/HITL.md`'s "Enforcement:
report-only, then enforce" section, beyond the additions this pull
request makes and documents explicitly: the `channel`-based tier-2
authority restriction in `evaluateTier2Decision` (see "Channel enforcement"
below), and `tier2.globs`'s new entries for this file, `docs/HITL-HOOKS.md`,
the decision record, and the deny-hook script (#1187 escalation-rule
round 9, fresh final reviewer, non-blocking: singular as of round 8 --
the companion Bash-matched script was removed).

The code in this slice implements a NARROWER slice of the rule above, not
every part of it:

- **The "Two reviews" mode** is what `scripts/land-stack.mjs`'s tier-1
  gate (`evaluateTier1Independence`) actually enforces today — minus the
  blind-verdict and fresh-final-reviewer requirements the ratified rule
  adds for governance/security/gate work (#1187 escalation-rule round 8,
  strong-class reviewer, blocking B7: an earlier draft of this bullet
  also named a "model-diversity-record" requirement here; the ratified
  text contains no such requirement, and the phrase has been removed --
  see `docs/HITL.md` item 8, retracted for the same reason). Tracked in
  #1350 (see `docs/HITL.md`'s "Before switching to enforce" section).
- **The "Autonomous" row** ("Autonomous | Tier-0 paths | Logged" — three
  separate table cells, not one quoted sentence; #1187 escalation-rule
  round 9, fresh final reviewer, blocking B1: an earlier draft flattened
  and re-cased them into a single quoted phrase, "Autonomous: tier-0
  paths, logged") matches the code's own tier-0 fast path (`runStatus`
  skips review-evidence reads entirely for a tier-0 classification — see
  `docs/HITL.md`'s "Where each tier is enforced" section), though
  "Logged" here means only that `land-stack.mjs --status`'s own JSON output
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
  this repository at all. The row's 3-round trigger is superseded by the
  review-convergence amendment's budget and triggers (see
  [Amendment (2026-09-23): review convergence](#amendment-2026-09-23-review-convergence));
  no code in this repository counts review rounds under either version.
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
  the deny-hook's own, separately-limited protection (see
  [`docs/HITL-HOOKS.md`](HITL-HOOKS.md)) — nothing verifies that a change
  to this file (`docs/HITL-RULE.md`) or to the decision record was
  actually ratified by the owner.
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
  must carry `channel: "owner-chat"` — the sole value both structurally
  legal (`CHANNELS` names three values) AND currently accepted for such a
  record (see the next two bullets for why `"github-comment"` and
  `"signed-commit"` are each, for different reasons, never accepted
  today). `scripts/check-decision-records.mjs`'s `validateDecisionRecordShape`
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
  restriction, tracked as a future item in `docs/HITL.md`'s "Before
  switching to enforce" section and in #1350 — not a permanent rule that
  `"signed-commit"` is
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
  other self-declared field in this design (see `docs/HITL.md`'s
  "Honour-system limits" section), UNTIL signed commits are verified. The
  validator can catch an
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

By `classifyTier`'s mechanical, path-based rule, this file
(`docs/HITL-RULE.md`) alone, and `docs/HITL-HOOKS.md` alone, would each
classify tier-0 (no glob matches prose that isn't named explicitly), and
`governance/decisions/hitl-escalation-rule.json` alone (matched only by
the broad `governance/**` glob, since `governance/decisions/**` carries no
`tier1RecordExempt` carve-out) would classify tier-1 — round 2 of
independent review on this pull request (both reviewers, blocking) found
that this contradicted "Changing this rule itself" directly: an edit to
the rule's own living text, its deny hook, or its durable record, could
otherwise land with two ordinary reviewers, never reaching the owner.
`docs/HITL-RULE.md`, `docs/HITL-HOOKS.md`, and
`scripts/hooks/deny-tier2-edit.mjs` are all in `tier2.globs` directly (the
companion Bash-matched `deny-tier2.mjs` named here in earlier rounds was
removed by owner decision in round 8; see `docs/HITL-HOOKS.md`'s own
history section). `governance/decisions/hitl-escalation-rule*.json` was
also named directly, and round 8 additionally made the WHOLE
`governance/decisions/**` directory tier-2 (see `governance/review-tiers.json`'s
own `$comment` for the full reasoning on both) — closing the gap where a
DIFFERENTLY-named record, one that supersedes this rule without following
the `hitl-escalation-rule*` naming convention the narrower glob depends
on, would otherwise still classify tier-1. `docs/HITL.md` itself is
deliberately NOT in `tier2.globs` — it is named explicitly in
`tier1.globs` instead (without that entry it would classify tier-0, the
same gap this section describes for the files above), since it documents
the gate mechanics generally and does not itself carry the rule text, the
hook definition, or the record.

## Amendment (2026-09-23): review convergence

The owner ratified this amendment in owner chat on 2026-09-23, selecting
the answer "Ratify as written (Recommended)" to a structured question
that asked for ratification of the list below. Later the same day, the
owner answered three follow-up questions in owner chat, on the caps (Q1),
on how the record declares `relaxesGateOrPolicy` (Q2), and on recording
deadline defaults (Q3).
[`governance/decisions/hitl-review-convergence.json`](../governance/decisions/hitl-review-convergence.json)
is the durable record. It quotes every question, answer and selected
option's description, and the list, all verbatim, with `channel:
"owner-chat"`, not independently verifiable, as the rule above requires
of every owner-chat record. That record is the source of truth if this
section and it ever disagree. It does not edit or replace
`governance/decisions/hitl-escalation-rule.json`: that record, and the
rule quoted above, stay in force except for the two parts named below.

The ratification's option description speaks of amending `docs/HITL.md`.
The ratified text sits here instead because the rule moved from
`docs/HITL.md` into this file in round 3 of #1354; `docs/HITL.md` links
here.

**The ratified list, reproduced VERBATIM**, with one invisible markup
comment on one line (see "Implementation status" below). It is written in
the coordinator's voice, addressed to the owner: *you* and *your* mean
the owner, *me* and *my* mean the coordinator.

> 1. **Charter before round 1.** Required for gate, governance, security or release paths, or over about 300 lines across the stack. It states the goal, adversary, non-goals, what "done" means, the blocking bar and the round budget. Five clauses are always on and can't be removed: harm, authority or permission effects, false claims, rule fidelity, and correctness. Reviewers first review the charter itself; they can add clauses, never remove them, and a charter defect blocks.
> 2. **Structured findings.** Each blocking finding cites a charter clause. The reviewer, not the author, labels it a new class or a known class, and a known class must cite its earlier instance. A finding with no clause becomes an issue.
> 3. **Budget.**
>    - The default is 2 rounds. A charter can ask for more, and that request is approved with the charter.
>    - In round 2, the same reviewers check their own findings, and one fresh strong-class final reviewer joins, as your rule requires. New findings block only under the always-on clauses.
>    - One automatic extra round is allowed only when blockers strictly shrink and every blocker is a new harm-class finding. Otherwise the PR goes to you.
> 4. **Triggers.** An item goes to you when any of these happens:
>    - the budget is exhausted;
>    - the review-run cap is hit;
>    - it stalls, with no progress since the last push, CI and queue time excluded;
>    - there's a value dispute.
>
>    Reviewer disagreement doesn't go to you. The stricter view wins, as your rule already says. A repeat of a known class makes me close that class by design, or document it as residual risk; it doesn't reach you either.
> 5. **Escalation packet.** One question, with options, my recommendation, a default and a deadline. It's asked same-day, at most twice a day, with related items merged.
>    - **Default for ordinary PRs:** park it and ship the parts that have converged.
>    - **Authority or governance PRs:** park the whole PR, never a partial landing.
>    - **Live-harm fixes:** ship the smallest fix and file the rest. <!-- facts-gate:ignore -->
> 6. **Records.** Your answers, budget grants and deadline defaults are all recorded. A deadline default is recorded as `decidedBy: default`, so it can never count as your authority.
> 7. **Beyond reviews.** CI reruns, rebase churn and queue ejections get their own caps. A clean mechanical rebase, verified by a range-diff, keeps its review clearance.
> 8. **Tooling.** `review-loop-status` starts report-only, with its own charter. A quote-fidelity test checks that quoted rule text is word for word, and that reviewers receive the rule and charter verbatim.
> 9. **Metrics.** Reviewed at the Friday cut:
>    - rounds to converge;
>    - escalations;
>    - your decision latency;
>    - agent runs per merged PR;
>    - escaped defects;
>    - park rate.
>
>    Pairing speed with escaped defects keeps the speed targets from pushing reviewers to approve.

### What the amendment changes in the rule above (not part of the ratified text)

This subsection and the two after it are this repository's own
explanation, and where they settle an ambiguity they say so. They add no
authority beyond the list above and the owner's answers recorded in
`governance/decisions/hitl-review-convergence.json`; where they seem to,
those govern.

- **The 3-round trigger.** Accepted item 5 ("after 3 rounds that go
  nowhere") and the "Your approval first" table row ("or 3 rounds that go
  nowhere") are superseded by the list's item 3 (the round budget) and
  item 4 (the triggers). Value disputes still go to the owner, and
  reviewer disagreement still does not; item 4 restates both.
- **Ask timing (the record's reading).** The table's "batched for Friday
  unless urgent" is superseded by item 5: an escalation ask goes out the
  same day, at most twice a day, with related items merged. Item 5 itself
  has no urgency exception, but on 2026-09-24 the owner separately
  restored one for urgent asks that are not about a review: an ask that
  is genuinely urgent and about credentials or publishing may be raised
  at any time, outside the twice-a-day limit; every other ask stays under
  it. The owner saw the timing change called out when ratifying: the
  amendment followed a red-team whose recommendations were adopted,
  except that asks go same-day rather than being batched to Friday.
- **Everything else stands**, including the fresh strong-class final
  reviewer for governance, security and gate changes (item 3 keeps it),
  the channel rule, and "Changing this rule itself". The quoted rule
  text above is not edited.

### Owner-set values and interim recording (owner answers, 2026-09-23)

**Caps and stall window.** Set by the owner on 2026-09-23 in answer to
Q1, as budgets and thresholds are the owner's standing settings under
Accepted item 4. Each value is in Q1's own words:

- review-run cap (item 4): "6 agent review runs per PR";
- stall (item 4): "60 min with no new push or verdict, CI and queue time
  excluded";
- CI flake reruns (item 7): "capped at 1 per failing check per head, so a
  second failure is treated as real and diagnosed";
- rebase or merge-main churn (item 7): "capped at 2 per PR per day";
- queue ejections (item 7): "capped at 2 per PR, after which it's
  diagnosed before re-queueing".

They apply now and are reviewed with data at the Friday cut. Changing
them is an owner decision, like any other standing setting.

**Deadline defaults, until the validator accepts `decidedBy: default`.**
Per the owner's answer to Q3, a deadline default is recorded as a pull
request or issue comment labelled `hitl:default`, and it never counts as
authority. The label name is this repository's choice; the owner's answer
says a labelled comment. Adding `decidedBy: default` to the
decision-record validator is follow-up owner-tier work, tracked in
#1408.

### Implementation status (not part of the ratified text)

- **Nothing in the list is enforced by code yet.** No script checks for a
  charter, counts rounds, applies a trigger, caps CI reruns or rebases,
  or collects the metrics. They bind agent work as process only. The
  option the owner selected also says the coordinator will "apply the
  budget to live work immediately, starting with #1354".
- **A clean rebase and the tier-1 gate.** Item 7 keeps review clearance
  across a clean mechanical rebase, but the tier-1 evidence gate in
  `scripts/land-stack.mjs` reads review records at the exact current head
  only (see `docs/HITL.md`'s "Where each tier is enforced"). So after any
  rebase it does not pass until valid review records exist at the new
  head. The gate does not look for, read, or verify a range-diff. Item 7's
  range-diff verification is a reviewer obligation that no code currently
  checks, and no code distinguishes a clean mechanical rebase from any
  other new head.
- **Larger round budgets (this repository's reading).** Item 3 says a
  request for more rounds is approved with the charter, and item 6 lists
  budget grants among what is recorded. Because budgets are the owner's
  standing settings under Accepted item 4, a larger budget is approved by
  the owner together with the charter, and recorded as a decision record
  under `governance/decisions/`.
- **The fresh reviewer in the extra round (this repository's reading).**
  A reviewer counts as fresh only if they have no history on the PR
  before the round they join. The round-2 fresh final reviewer has
  history by the time of item 3's one automatic extra round, so they are
  no longer fresh then. Accepted item 6 still applies: for governance,
  security or gate changes, the last approval has to come from a fresh
  strong-class reviewer with no history on the PR.
- **Charter template.** [`docs/templates/pr-charter.md`](templates/pr-charter.md)
  holds the empty charter fields and links to item 1 above. It does not
  copy item 1 or the always-on clauses, so the list is quoted in one
  place in the docs.
- **Follow-up work, not in the pull request that added this section:**
  the `review-loop-status` script and the quote-fidelity test named in
  item 8, issue or pull-request template changes under `.github/`, and
  the validator change in #1408.
- **One markup comment inside the quote.** The line quoting item 5's
  live-harm default ends with an HTML comment, `facts-gate:ignore`, so
  the strategist facts gate (`npm run check:strategist-subject`) does
  not read the ratified wording as an untraced superlative claim. It
  renders as nothing and changes no word of the quote. A byte-for-byte
  comparison has to strip HTML comments first; the decision record's
  copy has no comment.
- **Tier and hook coverage of the amendment record.**
  `governance/decisions/hitl-review-convergence.json` is tier-2 through
  the `governance/decisions/**` glob in `governance/review-tiers.json`.
  Its name does not match the narrower `hitl-escalation-rule*.json` glob,
  and it is not in the protected basenames of the deny hook described in
  [`docs/HITL-HOOKS.md`](HITL-HOOKS.md). Widening the hook is a change to
  the hook itself and is left to a separate pull request.
