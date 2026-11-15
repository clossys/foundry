---
clossys:
  schema: clossys.view/1
  id: designer/views/slot-compare
  agent: designer
  kind: view
  status: live
  createdBy: { actor: package, package: "@clossys/designer", version: "1.0.0" }
  createdAt: 2026-11-10T00:00:00Z
  appliesTo: [token, asset, component, section, frame]
  inputs:
    - clossys slot <ref> --json
    - clossys render <candidate-ref> --compare <candidate-ref>
  answers: [queue.pick, queue.approve]
---

# Compare candidates for one Designer slot

## Purpose
Let the owner choose between two or more candidates of one Designer slot, or confirm the one the Designer judge picked,
by seeing them rendered side by side with their checks and the reason each was made.

## Inputs
1. `clossys slot <ref> --json`, where `<ref>` is the queue entry's `subject`. Use `candidates` (live only), `pin` and
   `queue` from the result.
2. `clossys render <candidate-ref> --compare <candidate-ref>` for the pinned (or package default) candidate against each
   newer candidate, at both default widths. If there are more than three candidates, compare the pinned one with the two
   newest that pass their checks, and list the rest.

## Output shape
1. One line: the slot id, its L0 > L1 > L2, and what the owner is asked (the queue entry's `ask`, word for word).
2. The images from the render result, pinned first, each labelled with candidate name and `sha256` first 8.
3. A table, one column per candidate:

   | Row | From |
   |---|---|
   | Status | `pin.state` for the pinned one; "candidate" otherwise |
   | Checks | `check.status`, then each name in `check.failed` |
   | Brief current | `briefCurrent` (say "written for an older brief" when false) |
   | Source rung | `source.kind` and its `ref` |
   | Why | each `rationale` row: purpose, then why |
   | Made by | `createdBy`: agent, model, tier |

4. The default: the queue entry's `default`, and what happens if the owner says "go with default".
5. The question, with the allowed answers from the entry's `options` (or approve / reject for `queue.approve`).

## Rules
- Read-only. Never write a file, pin, or edit a candidate.
- The answer goes back only through `clossys answer <queue-item> <answer> --by owner --via chat --quote "<words>"`.
- Show only values the CLI returned. Empty is "none". No invented data, no guessed contrast or sizes.
- Name the source for every value: slot id, candidate name, pin `decidedBy`, `sha256` first 8.
- A failing candidate is shown, marked "fails: <checks>", and is never offered as an answer.
