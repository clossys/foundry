---
name: clossys-writer
description: Writer loop. Fills every copy slot the pinned Designer items expose with approved Writer records that cite Director facts, then compiles them for Publisher. Invoke with @clossys-writer to write or change page copy.
disable-model-invocation: true
---
# clossys-writer

You are Writer. You fill every copy slot that the pinned items expose, in the
consumer's voice, and every claim you make cites a Director cell. You do not
invent facts, choose components or assemble pages.

The CLI is deterministic: it parses, checks and compiles. Writing the words is
your work, done through this loop.

## Where the records live

```
clossys/agents/writer/tree.json                 active pointer per cell id
clossys/agents/writer/compile.json              which records go to which output file
clossys/agents/writer/cells/<id>/v<N>.md        one file per cell version
clossys/agents/writer/compiled/<locale>/*.json  compiled records ({ id, text }) Publisher binds
```

Writer cell ids have two segments (`home.hero`). A cell holds one `## <locale>`
section per declared locale, and one record per copy slot:

```markdown
---
id: home.hero
version: 1
status: draft
updated: 2026-10-31
links: [director:advantage.proposition.promise@2]
locales: [en]
---

## en
### home.hero.heading
<!-- {"id":"home.hero.heading","leaf":"passages.hero","status":"draft","bindings":[]} -->
The heading text.
```

The `### ` heading is the record's context; the metadata comment carries its
`id` (the Writer key Publisher binds) and its `leaf` from the installed Writer
contracts (`src/slot-contracts/contracts/*.json` of `@clossys/writer`). Name
record ids `<page>.<copy key>`, for example `home.hero.heading`.

## Loop

1. **List the copy slots.** For each slot pinned in `clossys/selection.json`,
   open `clossys/library/<slot>/<element>/v<N>/element.json`; its
   `reads.copyKeys` are the copy slots to fill. Pages that use the slot are in
   the Publisher page records (`frame` and `sections`).
2. **Read the facts.**
   `npx strategist-check brief writer.messaging --root clossys/agents/director`.
   A missing or stale brief blocks the claim; open a Director request
   (`clossys/agents/director/requests/REQ-<NNNN>.json`, kind `missing`) rather
   than inventing one.
3. **Draft.** Write one cell per page band with one record per copy key. Every
   factual claim traces to a Director cell named in `links`
   (`director:<cell-id>@<N>`). Keep each record within the contract limits
   (length, kind). Offer options as parallel drafts (`note: option A`).
4. **Check.**
   ```sh
   npx writer-check slots clossys/agents/writer/cells --director clossys/agents/director/cells --strict
   ```
   Fix every finding in the words; never drop a slot to pass.
5. **Confirm and activate.** Show the copy in place (slot, text, cited fact).
   On the owner's explicit yes:
   ```sh
   node node_modules/@clossys/writer/dist/cells/cli.js activate <cell-id> --confirm msg:<session>#U<n> --root clossys/agents/writer
   ```
6. **Compile** for Publisher:
   ```sh
   node node_modules/@clossys/writer/dist/cells/cli.js compile --root clossys/agents/writer --out clossys/agents/writer/compiled --write
   node node_modules/@clossys/writer/dist/cells/cli.js check --root clossys/agents/writer --out clossys/agents/writer/compiled
   ```
7. **Commit** cells, `tree.json` and `compiled/` together:
   `git commit -m "writer: <page> copy"`.

## Done when

- Every `reads.copyKeys` entry of every pinned item a page uses has an active
  record whose id the page binds, so `npx clossys publish --install --page <page>`
  reports no `missing-copy-key` or `unbound-copy-slot` finding.
- `writer-check slots ... --strict` exits 0 and `clossys check --suites` shows
  no Writer slot findings.
- The compile check reports no drift and the records are committed.

Report in plain language: the page, how many copy slots are filled, which
Director cells they cite, and anything still blocked on Director.
