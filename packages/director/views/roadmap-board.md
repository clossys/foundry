---
clossys:
  schema: clossys.view/1
  id: director/views/roadmap-board
  agent: director
  kind: view
  status: live
  createdBy: { actor: package, package: "@clossys/director", version: "0.6.0" }
  createdAt: 2026-11-14T00:00:00Z
  appliesTo: [brief]
  inputs:
    - clossys status --agent director --detail --json
    - clossys slot director/<slot-id> --json
  answers: [queue.pick, queue.approve]
---

# Roadmap board

## Purpose
Show the owner the Director's roadmap slots by horizon: what is pinned for each, its scope, and what downstream work
reads it, so they can confirm a direction or pick between Director candidates.

## Inputs
1. `clossys status --agent director --detail --json`: every Director slot with its state, and the open queue items for
   Director slots.
2. `clossys slot director/<slot-id> --json` for each roadmap slot (the slots whose L1 is the roadmap) and for any slot an
   open queue item names: `slot.brief`, `slot.ia`, `pin`, `candidates`, `consumedBy` and `queue`.

## Form
A board: one column per horizon (the L2 of each roadmap slot), one card per slot. In chat, an inline table with the
horizon as the first column. A local page is worth it only when there are more than a dozen slots.

## Output shape
1. Per horizon, in `slot.ia` order: one card per slot with slot id, `slot.brief.purpose`, the pinned candidate name and
   `pin.state` ("sample" when the package default resolves), and its `consumedBy` list.
2. Cards with an open queue item come first in their column, with the entry id and its `ask` word for word.
3. A short list of slots whose state is unresolved or failing, with the failing check names.
4. For a queue item: the pinned candidate against each live candidate, with `check.status`, `briefCurrent` and each
   `rationale` row.
5. The question, with the allowed answers from the entry's `options` (or approve / reject for `queue.approve`).

## Rules
- Read-only. Never write a file, pin, or edit a candidate.
- The answer goes back only through `clossys answer <queue-item> <answer> --by owner --via chat --quote "<words>"`.
- Show only values the CLI returned. Empty is "none". No invented data, no guessed dates or owners.
- Name the source for every value: slot id, candidate name, pin `decidedBy`, `sha256` first 8.
