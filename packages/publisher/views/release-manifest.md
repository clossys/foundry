---
clossys:
  schema: clossys.view/1
  id: publisher/views/release-manifest
  agent: publisher
  kind: view
  status: live
  createdBy: { actor: package, package: "@clossys/publisher", version: "0.13.0" }
  createdAt: 2026-11-14T00:00:00Z
  appliesTo: [release]
  inputs:
    - clossys slot publisher/release.<publication> --json
  answers: [queue.approve]
---

# Release manifest

## Purpose
Show the owner the release candidate of one publication: its routes, what changed against the last ready version and
whether every gate passed, so they can sign it off as ready or send it back.

## Inputs
1. `clossys slot publisher/release.<publication> --json`, where the ref is the queue entry's `subject`. Use `pin` (the
   last ready version), `candidates` (the newest one is the release candidate, with its gate results as `check`),
   `rationale` and `queue`.

## Form
An inline summary in chat: the gate table and the pin diff. One self-contained local page only when the pin diff has
more than twenty rows.

## Output shape
1. One line: publication, release candidate name and `sha256` first 8, the last ready version (or "none"), the queue
   entry's `ask` word for word.
2. Gates: one row per gate with its result. Any gate that is not `pass` is listed first.
3. Routes, as the candidate result lists them.
4. The pin diff against the last ready version: ref, old candidate, new candidate, each with `sha256` first 8. Unchanged
   pins are counted, not listed.
5. The question: ready or not ready (the entry's `options`), and its `default`.

## Rules
- Read-only. Never write a file, pin, or edit a candidate.
- The answer goes back only through `clossys answer <queue-item> <answer> --by owner --via chat --quote "<words>"`.
- Show only values the CLI returned. Empty is "none". No invented data.
- Name the source for every value: slot id, candidate name, pin `decidedBy`, `sha256` first 8.
- A release with a failing gate is shown with "not ready" as the only answer offered.
