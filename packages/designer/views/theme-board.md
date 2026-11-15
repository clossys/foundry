---
clossys:
  schema: clossys.view/1
  id: designer/views/theme-board
  agent: designer
  kind: view
  status: live
  createdBy: { actor: package, package: "@clossys/designer", version: "0.12.0" }
  createdAt: 2026-11-14T00:00:00Z
  appliesTo: [token, designer/themes.*]
  inputs:
    - clossys status --agent designer --detail --json
    - clossys slot designer/<theme-slot-id> --json
    - clossys render designer/<theme-slot-id>/<candidate> --json
  answers: [queue.pick, queue.approve]
---

# Theme board

## Purpose
Show the owner every theme token in use, in light and dark, with the contrast pairs and the pin each value comes from,
so they can approve a theme change or pick between theme candidates.

## Inputs
1. `clossys status --agent designer --detail --json`: the Designer slots whose id starts with `themes.`, and the open
   queue items for them.
2. `clossys slot designer/<theme-slot-id> --json` for each of those slots: `pin`, `candidates`, `contract` and `queue`.
3. `clossys render designer/<theme-slot-id>/<candidate> --json` for the pinned candidate and for any candidate an open
   queue item names, to get the light and dark specimens.

## Form
One self-contained local page: a swatch grid per theme slot, light and dark side by side, and the contrast table
below. For a quick answer in chat, an inline table of the same rows without swatches.

## Output shape
1. One line per theme slot: slot id, pinned candidate and its `pin.state`, open queue items (id and `ask`).
2. A table per theme slot, one row per token: token name, light value, dark value, source candidate and `sha256` first 8.
3. Contrast pairs as the candidate's checks report them: pair, light result, dark result. A pair the checks do not
   report is "not checked", never estimated.
4. When a queue item asks about a theme: the pinned candidate against the asked one, the same rows, changed rows first.
5. The question, with the allowed answers from the entry's `options` (or approve / reject for `queue.approve`).

## Rules
- Read-only. Never write a file, pin, or edit a candidate.
- The answer goes back only through `clossys answer <queue-item> <answer> --by owner --via chat --quote "<words>"`.
- Show only values the CLI returned. Empty is "none". No invented data, no guessed colors or contrast.
- Name the source for every value: slot id, candidate name, pin `decidedBy`, `sha256` first 8.
