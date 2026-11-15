---
clossys:
  schema: clossys.view/1
  id: writer/views/copy-table
  agent: writer
  kind: view
  status: live
  createdBy: { actor: package, package: "@clossys/writer", version: "0.6.0" }
  createdAt: 2026-11-14T00:00:00Z
  appliesTo: [copy, voice, prose]
  inputs:
    - clossys slot writer/<slot-id>#<record> --json
    - clossys render writer/<slot-id>/<candidate> --json
  answers: [queue.pick, queue.approve]
---

# Copy table

## Purpose
Show the owner one copy record, or every record of one Writer slot, as a table they can read in one pass: the text per
locale, the limits and purposes from the brief, and the pinned text against any new candidate, so they can approve or
pick the words.

## Inputs
1. `clossys slot writer/<slot-id>#<record> --json`, where the ref is the queue entry's `subject`; leave out `#<record>`
   to show every record of the slot. Use `slot.contract` (fields, purposes, limits per locale), `pin`, `candidates` and
   `queue`.
2. `clossys render writer/<slot-id>/<candidate> --json` for the pinned candidate and each candidate an open queue item
   names, to get the text per locale from its specimens.

## Form
An inline table in chat. A local page only when the slot has more records than fit on one screen.

## Output shape
1. One line: the ref, the queue entry's `ask` word for word, and its `default`.
2. A table, one row per field of the record, one column per locale, then: purpose, limit, length, check result.
   The pinned text first; the candidate's text below it in the same cell, marked "new", only where it differs.
3. Under the table: each `rationale` row of the candidate (field, then why), and `briefCurrent` when it is false.
4. The question, with the allowed answers from the entry's `options` (or approve / reject for `queue.approve`).

## Rules
- Read-only. Never write a file, pin, or edit a candidate.
- The answer goes back only through `clossys answer <queue-item> <answer> --by owner --via chat --quote "<words>"`.
- Show only values the CLI returned. A locale with no text is "none". Never translate, shorten or rewrite the copy.
- Name the source for every value: slot id, record, candidate name, pin `decidedBy`, `sha256` first 8.
- A text over its limit is shown in full and marked "over by <n>", never cut.
