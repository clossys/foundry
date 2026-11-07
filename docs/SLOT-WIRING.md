# Slot wiring lock

The slot model (`clossys/agents/<agent>/<slot>/{slot.json, candidates/*, pin.json}`) has one
reader and one writer, and a pin is the one wire from a slot to everything that renders it.

- **One reader.** `packages/producer/src/records/slots.ts` is the one module that opens the slot
  model; `packages/producer/src/records/slot-write.ts` is the one module that writes it. Publisher
  (pinned publication), the CLI verbs, Studio and the specimen route import the reader.
- **No legacy selection path.** The selection writer (`records/selection.ts`), its schema,
  validator, status rows and release snapshots are gone. Pins live only in `pin.json`.
  `clossys/selection.json` and its pipeline step are deleted: Designer check-provenance,
  check-ref-verbatim and check-section-tokens read pins through the reader
  (`packages/designer/scripts/slot-pins.mjs`), and `check:no-selection-store` fails if the store
  or a reader of it comes back. `clossys/library/**` remains frozen data.
- **Every candidate renders.** The specimen route takes `(slot, candidate)` and builds those bytes.
  The valid pin is badged pinned; every other candidate carries `preview` and is never used by
  pages.

## Checks

| Check | What fails it |
|---|---|
| `check:no-selection-store` | `clossys/selection.json` exists, or a package, script or bin file (tests and fixtures aside) opens a `selection.json` pin store or names the `clossys.selection/1` schema (failing fixture in `scripts/check-no-selection-store.test.mjs`). |
| `check:single-reader` | Any package, script or bin file outside the reader and writer that opens a slot-model path (AST import and taint rule; failing fixture in `scripts/check-single-reader.test.mjs`). |
| `check:pin-propagation` | In a temporary copy: a drifted pinned candidate byte that Studio detail does not flag (`studio.check-pin-hash-mismatch`) or a page build that does not refuse it; a repin that does not change Studio detail, the specimen inputs and Publisher output. |
| `check:every-candidate-previewable` | A placed, valid candidate with no specimen or record, a Designer candidate the specimen route does not accept, or a `preview` flag that is not exactly "not the valid pin". |

## Base vs head

Base is `383f032c2`; head is the commit that adds this file. Exit codes; each new check was run at
base with the head check pointed at the base checkout (`--root` or `CLOSSYS_CHECK_REPO`).

| Command | Base | Head | Note |
|---|---|---|---|
| `npm run check:single-reader` | 1 | 0 | base: 80 findings in 22 files |
| `npm run check:pin-propagation` | 1 | 0 | base: 6 of 23 assertions fail |
| `npm run check:every-candidate-previewable` | 1 | 0 | base: 966 findings over 725 candidates |
| `node packages/producer/scripts/check-pipeline.mjs` | 0 | 0 | |
| `npm run check:assemble-only` (producer) | 0 | 0 | |
| `npx vitest run src/studio/designer-views.ds-only.test.ts` (producer) | 1 | 1 | the same 6 tests fail |
| `npm run check:rules` | 1 | 1 | the same 10 rules and 16 findings |
| `check:git-cms` | absent | absent | |
| `npm run build` | 0 | 0 | |
| `node packages/producer/scripts/build-studio.mjs` | 0 | 0 | |
| `npx vitest run` (producer) | 1 | 1 | head failures are a subset of base: 89 failing entries at head, 106 at base, none new |
| `npx vitest run src/library-cli/cells.test.ts` (designer) | 1 | 1 | 3 failed at base, 2 at head |
| `npx vitest run src/heartbeat` (controller) | 0 | 0 | |

Known data defect at base and head: the pinned candidate of `designer:components.flow.node-status`
fails candidate identity, so the pinned specimen build of the full model refuses it. The checks
drop that one pin in their temporary copy and name it.
