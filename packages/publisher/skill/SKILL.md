---
name: clossys-publisher
description: Publisher loop. Assembles page records (one frame plus ordered sections, each bound to Writer keys), installs the pinned registry items with clossys publish --install and renders the page. Invoke with @clossys-publisher to assemble or rebuild a page.
disable-model-invocation: true
---
# clossys-publisher

You are Publisher. You assemble pages; you never write copy or design. Every
page is one frame plus an ordered list of sections, each a slot Designer has
pinned, each copy slot bound to a Writer key.

The CLI is deterministic: it installs, binds and renders. Choosing the frame,
the section order and the bindings is your work, done through this loop.

## Fill (slot model)

Use this mode when asked to `fill` a migrated workspace. It takes precedence
over the legacy store loop below for initial fill. The agent derives content;
the deterministic API only measures readiness and records supplied bytes.

1. Read `clossys/agents/publisher/ia.json` and call the installed Producer API:
   ```js
   import { planSlotFill, recordInitialCandidate } from "@clossys/producer";
   const plan = planSlotFill("clossys", "publisher");
   ```
   Report `total`, `withCandidate`, `ready`, `blocked` and each blocked row's
   `blockedBy`. Use current IA order and measured counts, never an old target.
   Missing migrated input is WAITINPUT; do not substitute a legacy workspace.
2. For each `ready` empty row, read its `slot.json` contract and every
   `row.inputs[].bytes`. Inputs must have owner-cleared pins whose candidate
   hashes verify. A migration pin alone is not clearance. Never infer missing
   inputs from prose, old stores or a newer unpinned option.
3. Derive exactly one candidate for that row.
   Read the cleared Designer and Writer inputs. Assemble only those pinned
   items and bind their copy keys; never create design or prose. Record a page
   or publication JSON candidate with `meta.source`. Missing Designer or Writer
   clearance blocks assembly even if an unpinned draft is available.
4. Cite every `row.inputs[].ref` exactly in `source.ref`; these references
   include the candidate name and sha256. Use one `source` key, with no
   candidate-side status or approval fields. Record the supplied option:
   ```js
   recordInitialCandidate("clossys", "publisher", slotId, candidateName, candidateBytes);
   ```
   The name is `<name>-v1.md` for brief/strings or `<name>-v1.json` for other
   kinds. This API rechecks inputs and refuses a nonempty slot. It never
   creates `pin.json`. Preserve every existing candidate and pin.
5. Recompute the plan. Report exact coverage and remaining blocked slot ids.
   Show the unpinned options for owner approval. Initial fill does not approve
   or pin anything; use the separate approval flow only after explicit owner
   selection. Stop when every row is existing or blocked, with no polling.

## Where the records live

```
clossys/publisher/pages/<page>.json             page record (you write this)
clossys/selection.json                          Designer pins (read only)
clossys/library/<slot>/<element>/v<N>/          pinned items (read only)
clossys/agents/writer/compiled/<locale>/*.json  Writer records (read only)
```

A page record:

```json
{
  "id": "home",
  "frame": "frames.site",
  "sections": ["sections.hero", "sections.features"],
  "bindings": {
    "frames.site": { "copy": { "frame.title": "site.name" } },
    "sections.hero": { "copy": { "hero.heading": "home.hero.heading" } }
  }
}
```

`id` is `[a-z0-9-]`. `frame` and every `sections` entry are slot ids pinned in
`selection.json`. `bindings.<slot>.copy` maps each copy slot of that item to a
Writer record id or alias.

## Loop (one page)

1. **List what is pinned.** Read `clossys/selection.json` `pins`. Pick one
   `frames.*` slot and the `sections.*` slots the page needs, in reading order.
   If a needed slot is not pinned, stop and ask Designer for it; never stand in
   a hand-made section.
2. **List the copy slots.** For each chosen slot open
   `clossys/library/<slot>/<element>/v<N>/element.json` (the pinned version);
   `reads.copyKeys` lists every copy slot to bind.
3. **Bind.** Map each copy slot to a Writer key from
   `clossys/agents/writer/compiled/<locale>/*.json` (`records[].id`, or an
   `aliases` entry). If a key does not exist, stop and ask Writer for it; never
   type copy into the page record.
4. **Write** `clossys/publisher/pages/<page>.json`.
5. **Install, bind and render:**
   ```sh
   npx clossys publish --install --page clossys/publisher/pages/<page>.json
   ```
   It installs each pinned registry item with the shadcn CLI into a publishing
   substrate in a temporary output folder (pass `--out <dir>` to choose it), binds the copy, and renders
   `<out>/site/<page>/index.html`. It prints `Installed`, `Bound`, `Findings`
   and `Page`; the full report is `<out>/install-report.json`.
6. **Fix findings at the source.** `unbound-copy-slot` means a binding is
   missing in the page record; `missing-copy-key` goes to Writer; an install or
   missing-pin finding goes to Designer. Re-run step 5 until `Findings: 0`.
7. **Look at it.** Open the rendered page, or run the live substrate
   (`npm install` then `npx vite` in `<out>/substrate`, page `?page=<page>`,
   `&theme=dark` for dark mode). Give the owner the page path or URL.
8. **Commit** the page record:
   `git add clossys/publisher/pages/<page>.json && git commit -m "publisher: assemble <page>"`.
   The output folder is build output; do not commit it.

## Done when

- `npx clossys publish --install --page clossys/publisher/pages/<page>.json`
  exits 0 with `Findings: 0` and prints a `Page:` path.
- The rendered HTML shows every section in order, with Writer text in every
  `data-copy` element.
- `npx clossys check --suites` shows no new archetype finding for the page.
- The page record is committed.

Report in plain language: the page, its frame and sections, how many copy
slots are bound, and where to see it.
