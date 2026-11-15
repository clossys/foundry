---
clossys:
  schema: clossys.view/1
  id: publisher/views/page-preview
  agent: publisher
  kind: view
  status: live
  createdBy: { actor: package, package: "@clossys/publisher", version: "0.13.0" }
  createdAt: 2026-11-14T00:00:00Z
  appliesTo: [page]
  inputs:
    - clossys preview <publication> --once --json
    - clossys preview <publication> --with <candidate-ref> --json
    - clossys slot publisher/page.<page-id> --json
  answers: [queue.approve]
---

# Page preview

## Purpose
Let the owner see one page running for real, built from the pins, optionally with one or more unpinned candidates swapped
in, so they can judge a change in place before approving it.

## Inputs
1. `clossys slot publisher/page.<page-id> --json`: the page's `pin`, its placed units and `queue`.
2. `clossys preview <publication> --json` to serve the pinned build, or `clossys preview <publication> --with
   <candidate-ref> --json` with each candidate an open queue item asks about. Use `url`, `routes`, `overrides` and
   `sample` from the result. `--once` builds without serving, for a check that the build passes.

## Form
The running page itself, opened at the `url` the preview prints, with a short summary in chat. Nothing else is built.

## Output shape
1. One line: the page, its route from `routes`, the `url`, and the `buildId`.
2. The overrides in use: each `overrides` ref with `sha256` first 8, or "none: pins only".
3. The sample refs still in use (`sample`): each one is a package default the owner has not replaced yet.
4. When a queue item asked for this preview: its `ask` word for word, its `default`, and the allowed answers.

## Rules
- Read-only. Never write a file, pin, or edit a candidate. A preview never pins anything.
- The answer goes back only through `clossys answer <queue-item> <answer> --by owner --via chat --quote "<words>"`.
- Show only values the CLI returned. Empty is "none". No invented data, no screenshots described from memory.
- Name the source for every value: slot id, candidate name, pin `decidedBy`, `sha256` first 8.
- Stop the preview server when the owner is done.
