---
clossys:
  schema: clossys.view/1
  id: publisher/views/directory-map
  agent: publisher
  kind: view
  status: live
  createdBy: { actor: package, package: "@clossys/publisher", version: "0.13.0" }
  createdAt: 2026-11-14T00:00:00Z
  appliesTo: [page, layout, chrome]
  inputs:
    - clossys status --agent publisher --detail --json
    - clossys slot publisher/page.<page-id> --json
  answers: []
---

# Directory map

## Purpose
Show the owner the shape of what is published: each publication, its pages in order, and for each page the layout and
the units and records it places, so they can see where a piece of content lands before they change it.

## Inputs
1. `clossys status --agent publisher --detail --json`: the publications under `releases`, and every Publisher slot with
   its state.
2. `clossys slot publisher/page.<page-id> --json` for each page slot: `slot.ia` (publication and order), `pin`,
   `candidates` and `consumedBy`.

## Form
A tree in chat: publication, then pages in order, then the placed units. One self-contained local page with the same
tree, collapsible, when there are more than two publications.

## Output shape
1. Per publication: its id, the pinned release candidate (or "none") and `stale` with its `reason`.
2. Under it, the pages in `slot.ia` order: page slot id, pinned candidate and `pin.state` ("sample" when the package
   default resolves).
3. Under each page: the layout and chrome refs, then one line per placed role: the unit ref and the copy record it uses,
   as the page slot result lists them.
4. Pages and slots that are unresolved or failing, listed last with the failing check names.

## Rules
- Read-only. Never write a file, pin, or edit a candidate.
- Answers nothing: point the owner to `queue-inbox` (`clossys views show producer/queue-inbox`) for any open entry.
- Show only values the CLI returned. Empty is "none". No invented data, no guessed routes.
- Name the source for every value: slot id, candidate name, pin `decidedBy`, `sha256` first 8.
