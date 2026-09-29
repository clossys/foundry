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

1. The master session files the issue with a written done-check
   (commands that must pass, behavior to verify).
2. The master session adds the `cursor-glm` label.
3. The master session comments on the issue:

   > @cursor Implement this issue on GLM 5.3 Flash. Run the tests. Open a
   > pull request. Comment the pull request link on this issue. If you get
   > stuck or a test will not pass, post one comment saying what blocks you
   > and stop. Do not merge.

4. Cursor clones the repo, works the issue once, pushes a branch, opens a
   pull request, and stops. One run is one-way: it ends at the push.

## One-way runs, stuck sessions, and follow-ups

- A run ends the moment it pushes its branch and opens its pull request.
  Nothing watches the run afterwards and neither side polls.
- A stuck run does not loop. The dispatch comment instructs the agent to post
  exactly one blocker comment and stop; that run then counts as finished,
  unsuccessfully. Even a silent stuck run terminates — the worst case is one
  wasted run, not a forever loop.
- The master session treats a blocker comment as a CI signal: fix the
  environment or the issue and re-dispatch once, split the issue smaller, or
  escalate to Opus 5.5. Two unsuccessful runs on one issue is the ceiling.
- The lane re-opens only through a new `@cursor` mention. The master session
  may comment `@cursor Fix the CI failures. Do not merge.` on the pull
  request; that starts one new bounded run, which reads the existing thread
  first and ends at its own push.
- Cursor agents never mention `@cursor` or any other agent handle in comments
  they post. An agent-posted mention would start another run; that is the one
  real loop risk in this setup, and it is forbidden.

## Qualification

Label and comment only issues that are:

- Cloud-safe: foundry is public OSS, but never paste unpublished security
  notes (see `SECURITY.md`) or registry credentials into a session.
- Small: a single issue with objective acceptance criteria.
- Mergeable by CI: `npm run build` and `npm test --workspaces` cover the
  change.

Anything architectural, anything that has failed GLM Flash twice, or
anything load-bearing escalates to Claude (Opus 5.5) instead of a retry.

## Bounds

- Cursor agents never merge and never open the next wave.
