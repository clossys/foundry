# Cursor dispatch

Claude Max plans the program and files GitHub issues. Cursor Cloud Agents
execute single issues on GLM 5.3 Flash. This document is the dispatch
contract for this repository.

## Who does what

- Claude Max (Sonnet 5.5 master session): waves, issues, CI triage, merges.
- Cursor Cloud Agent: one issue per run, on GLM 5.3 Flash.
- Human: accepts the end-of-wave review before the next wave opens.

## How Cursor picks up a ticket

Cursor has no issue-opened trigger. Dispatch is a comment:

1. The master session files the issue with a written done-check (commands
   that must pass, behavior to verify) and a time-box (S = about 30 minutes,
   M = about 90 minutes) based on the issue's size.
2. The master session adds the `cursor-glm` label.
3. The master session comments on the issue:

   > Implement this issue on GLM 5.3 Flash. Run the tests. Open a pull
   > request. Post exactly one terminal comment on this issue — "DONE" with
   > the pull request link, or "BLOCKED" with what stops you — then stop.
   > If a test will not pass, the BLOCKED comment is the whole report; do
   > not retry inside the run. Do not merge. Include your run URL in the
   > ack.

   The comment begins with a mention of the Cursor GitHub App (the agent
   handle); that mention is the trigger. The handle itself is not restated
   in this file — this repository does not name peer accounts in committed
   text (see the foreign-reference gate); the master session composes the
   dispatch comment at run time.

4. Cursor clones the repo, works the issue once, pushes a branch, opens a
   pull request, posts the terminal comment, and stops. One run is one-way:
   it ends at the push plus one terminal comment.

## Terminal comment contract

Every run ends with exactly one terminal comment on the issue:

- `DONE: <pull request URL>` — the run finished and pushed.
- `BLOCKED: <one paragraph>` — the run stopped before pushing; the reason
  is the full report.

The terminal comment is the handoff artifact. After posting it the session's
job is over; it holds no state and owes nothing further. Durable state lives
in the ticket (labels, open/closed) and the pull request — never in the
session.

## Liveness: wait or re-trigger

The master session judges every dispatch at the issue's time-box, against
this signal ladder, cheapest signal first:

1. Terminal comment present → act on it (merge, retry once, split, or
   escalate). No ambiguity.
2. No terminal comment, but a pull request from the run exists → the run
   effectively finished; judge the pull request on CI and reconcile the
   missing comment yourself.
3. Ack present, no pull request, no terminal comment, and the time-box has
   expired → the run terminated unsuccessfully (stuck-terminated). Re-dispatch
   once on the same issue, or close the ticket and file a better-scoped one.
4. Signals show the run still ACTIVE well past the time-box → one nudge
   mention on the pull request. A premature nudge is harmless: Cursor allows
   only one active run per agent and refuses a second with `agent_busy`
   rather than forking a duplicate.

Never re-trigger while a dispatch is plausibly inside its time-box, and never
re-trigger without reading the signals above. Two unsuccessful runs on one
issue is the ceiling; the third attempt goes to Opus 5.5.

## Follow-ups and continuation

A run never continues itself. The master session owns the continue-versus-
close decision, reading the terminal comment and CI:

- Small fixable failure → one new agent-handle mention on the pull request
  (composed by the master session at run time) starts one new bounded run,
  which reads the existing thread first and ends at its own push and terminal
  comment.
- Wrong shape → close the ticket, file a better-scoped one, dispatch the new
  ticket fresh. The failed ticket stays open in history as the audit trail —
  never silently replaced.

The lane re-opens only through a new mention from the master session. Cursor
agents never post an agent-handle mention in comments they write — an
agent-posted mention would start another run, and that is the one real loop
risk in this setup. Forbidden.

## Reconciliation duty (comment permissions are best-effort)

The agent's terminal comment can fail: GitHub App issue-write is per-org and
has returned 403 on one installation before. The dispatch comment's
"terminal comment" clause is therefore best-effort, and the master session
carries the reconciliation duty instead — it dispatched the issue and watches
CI anyway, so it locates the run's pull request itself (branch search by
issue reference) and updates the issue with the outcome it observes. The
loop works identically whether or not the agent's comment permission works.

## Qualification

Label and comment only issues that are:

- Cloud-safe: foundry is public OSS, but never paste unpublished security notes (see `SECURITY.md`) or registry credentials into a session. Never name a peer account or consumer in committed text - the foreign-reference gate scans it.
- Small: a single issue with objective acceptance criteria and a time-box.
- Mergeable by CI: `npm run build` and `npm test --workspaces` cover the change.

Anything architectural, anything that has failed GLM Flash twice, or
anything load-bearing escalates to Claude (Opus 5.5) instead of a retry.

## Bounds

- Cursor agents never merge and never open the next wave.
- Cursor agents never post an agent-handle mention.
- One terminal comment per run; no state held outside the ticket.
- The master session is the only session that merges.

## Secrets

Foundry needs no registry token; installs resolve anonymously from the public registry. Never restate the agent-handle literal in committed text (see the foreign-reference gate); the dispatch comment is composed by the master session at run time.