---
clossys:
  schema: clossys.view/1
  id: producer/views/queue-inbox
  agent: producer
  kind: view
  status: live
  createdBy: { actor: package, package: "@clossys/producer", version: "0.1.0" }
  createdAt: 2026-11-14T00:00:00Z
  appliesTo: [queue.pick, queue.approve, queue.clarify, queue.fix]
  inputs:
    - clossys status --queue open --json
    - clossys slot <subject> --json
  answers: [queue.pick, queue.approve, queue.clarify, queue.fix]
---

# Open decisions

## Purpose
Show the owner every open queue entry that waits on them, oldest first, and hand each one to the view that fits it.

## Inputs
1. `clossys status --queue open --json`: use `queue[]` where `decider` is `owner`.
2. For the entry the owner opens: `clossys slot <subject> --json`, then the agent view named in the table below
   (`clossys views show <agent>/<view-id>`).

## Form
An inline table in chat. A local page is not needed for this view.

## Output shape
1. A table: id, queue, ask (word for word), subject, default, age (from `raisedAt`).
2. For each row, the view to open, by view id: a Designer slot, `slot-compare` (a theme slot, `theme-board`); a Writer
   record, `copy-table`; a Publisher page, `page-preview`; a Publisher release, `release-manifest`; a Director slot,
   `roadmap-board`.
3. Entries waiting on an agent: a count per agent only.
4. A `queue.clarify` entry has no options: ask the owner the question in its `ask` and record their words as the answer.

## Rules
- Read-only. Never write a file, pin, or edit an entry.
- The answer goes back only through `clossys answer <queue-item> <answer> --by owner --via chat --quote "<words>"`.
- Show only values the CLI returned. Empty is "none". No invented data.
- Name the source for every value: entry id, subject ref, pin `decidedBy`, `sha256` first 8.
