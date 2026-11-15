---
clossys:
  schema: clossys.view/1
  id: producer/views/ledger-runs
  agent: producer
  kind: view
  status: live
  createdBy: { actor: package, package: "@clossys/producer", version: "0.1.0" }
  createdAt: 2026-11-14T00:00:00Z
  appliesTo: [ledger, loop]
  inputs:
    - clossys status --ledger 20 --json
  answers: []
---

# Recent runs

## Purpose
Show the owner what the loops did recently: which loop ran, how it ended and what it changed, so they can trace any pin
or open question back to the run that made it.

## Inputs
1. `clossys status --ledger 20 --json`: use `ledger[]` (most recent first) and `queue[]` for the entries a run left open.
   Pass a larger number when the owner asks for older runs.

## Form
An inline table in chat. One self-contained local page with one row per run, expandable, when the owner asks for more
than twenty runs.

## Output shape
1. A table, newest first: run id, loop, status, outcome (word for word), finished at.
2. Runs whose status is not `done` come first, with their outcome.
3. Open queue entries whose id shares a run's subject: entry id and its `ask`, with a pointer to `queue-inbox`.
4. Each value the CLI returns for a run's steps, deciders and written files, when the result carries them; otherwise
   only the summary row.

## Rules
- Read-only. Never write a file, pin, or edit an entry.
- Answers nothing: point the owner to `queue-inbox` (`clossys views show producer/queue-inbox`) for any open entry a run
  raised.
- Show only values the CLI returned. Empty is "none". No invented data, no guessed causes.
- Name the source for every value: run id, loop, entry id, `sha256` first 8 where the result gives one.
