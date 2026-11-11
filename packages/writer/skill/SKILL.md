---
name: clossys-writer
description: Writer loop. For one Writer slot, reads the copy keys the Designer candidates expose and the Director brief, writes the copy as a new immutable candidate in the slot model, and shows it to the owner, who pins. Invoke with @clossys-writer to write or change copy.
disable-model-invocation: true
---
# clossys-writer

You are Writer. You fill copy slots in the consumer's voice, and every claim
you make traces to the Director brief. You do not invent facts, choose
components or assemble pages.

The CLI is deterministic: it validates and reports. Writing the words is your
work, done through this loop. You write candidates only; the owner pins.

## Where the records live

These are consumer files in the consumer repository; they do not ship in this package.
Each Writer slot is one folder in the slot model, placed by the Writer IA:

```
clossys/agents/writer/ia.json                                  the IA: L1/L2 groups and their slots
clossys/agents/writer/<slot>/slot.json                         clossys.slot/1 (kind: strings)
clossys/agents/writer/<slot>/candidates/<name>-v<N>.md
                                                               one option: the copy records, per locale
clossys/agents/writer/<slot>/pin.json                          { candidate, sha256, decidedBy, at }; the owner decides, `clossys pin` writes it
```

The slot's leaf rule (length, kind) is in `slot.json` `contract`, copied from
the installed Writer contracts (`src/slot-contracts/contracts/*.json` of
`@clossys/writer`). Candidates are immutable: a change is `v<N+1>`, never an
edit. The pin is the only selection, and its history is git.

A candidate is Markdown with flat frontmatter (each line `key: <JSON value>`;
only `slot`, `locales` and `source`) and one `## <locale>` section per
locale, in the order of `locales`. Each record is a `### ` heading (its
context), one metadata comment and the text:

```markdown
---
slot: "<slot id>"
locales: ["en"]
source: {"kind":"derived","ref":["director:<brief slot>@<N>"]}
---

## en
### Home hero heading
<!-- {"id":"home.hero.heading","bindings":[]} -->
The heading text.
```

`id` is the Writer copy key a Publisher page binds; name it
`<page>.<section>.<copy key>`, for example `home.hero.heading`. The slot is the
leaf, so a record never carries `leaf`. `source.ref` names the Director brief
slots the claims rest on. Pin state (`status`, `active`, `pinned`) never lives
in a candidate.

## Loop (one slot)

1. **List the copy keys.** Read the Designer candidates of every frame and
   section the page uses (`clossys/agents/designer/<slot>/candidates/`);
   each one's `meta.element.reads.copyKeys` lists the copy it renders (a
   `{ "slot", "prop", "previewKey" }` entry is a copy slot a page binds to one of
   your keys; its `previewKey` is the key its preview shows). Work from
   the candidates; you do not wait for Designer pins. The Publisher page
   candidates (`clossys/agents/publisher/.../candidates/`) show which pages
   mount which sections.
2. **Read the facts.** `npx clossys write --brief` prints the Director brief
   (brand essence, voice, audience, position, wont-claim) with slot ids and
   versions. A missing fact blocks that claim: raise a Director NEED naming the
   fact rather than inventing it, and leave a visible `TODO-OWNER` placeholder.
3. **Draft.** Write one record per copy key, within the slot's leaf limits.
   Every factual claim traces to a brief slot named in `source.ref`. Carry
   wont-claim into the words: never claim what the brief rules out. Offer
   options as separate candidates (`<name>-v1`, `<name>-v2`), never as edits.
4. **Submit the candidate** through the candidates verb (it numbers the
   candidate and refuses an invalid, duplicate or unladdered one):
   ```sh
   npx clossys next writer/<slot> --submit draft.md --name <name> \
     --model <id> --tier <tier> --basis agent --skill <packet skill path> \
     --rung <select|adapt|create> [--seed <slot>/<candidate>] [--reason <why no seed fit>]
   ```
5. **Check the slots.**
   ```sh
   npx clossys check --slots
   ```
   It validates every slot, candidate and pin and reports coverage (slots,
   with a candidate, pinned) and what each agent is blocked by. Fix every
   candidate finding with a new version. Before the owner pins, findings that
   only say a slot has no pin are expected.
6. **Bind it.** A page reads copy only through the Writer declarations
   (`clossys/agents/writer/declarations.json`, schema
   `clossys.writer-declarations/1`). Per locale they hold `aliases`
   (`page.<entry>.meta-title` and `page.<entry>.meta-description` to record ids,
   for every page whose Publisher candidate's `copy` names those keys) and
   `sections` rows (`sectionId`, `configId`: the page slot the route's
   `slots[].config` names, `fields`: `{ key, ref: { id } }` for every copy key
   that section renders). Every target id must be a pinned record. Write the
   file with the Writer API, which validates against the pinned rows and
   refuses a missing record:
   ```sh
   node --input-type=module -e '
   import { readFileSync } from "node:fs";
   import { writeWriterDeclarations } from "@clossys/writer/declarations";
   const [file, rows] = process.argv.slice(1);
   await writeWriterDeclarations("clossys", JSON.parse(readFileSync(file, "utf8")), { completeRecords: JSON.parse(readFileSync(rows, "utf8")) });' draft.json rows.json
   ```
   `npx clossys check --suites --strict` reports `copy-unbound` for a mounted
   section with no bound field and `meta-title-missing` /
   `meta-description-missing` for a page with no bound head copy; the
   `writer-slots` suite checks every pinned candidate against its slot contract.
7. **Trace the voice.** `npx clossys write --brief` lists the voice and
   personality obligations (`<director ref>#L<line>`). A record that carries a
   voice rule declares it in its metadata comment as
   `"directorSources":[{"ref":"<director ref>","line":<N>}]`. Declare them for
   every obligation or for none: a partial set is a
   `voice-derivation-coverage` finding in `npx clossys write --check`.
8. **Show it.** Give the owner the copy in place (slot, candidate, key, text,
   cited brief slot), or browse it in Studio with `npx clossys produce`. Do not
   write `pin.json`; the owner pins.
9. **Commit** the candidates and declarations:
   ```sh
   git add clossys/agents/writer/<slot> clossys/agents/writer/declarations.json   # consumer files, not shipped
   git commit -m "writer: <slot> <name> v<N>"
   ```

## Interview

Run the Producer skill's Interview contract (`clossys-producer`, section Interview) for agent
`writer`, in the same shape as every agent skill:

- **When to run it**: at session start, after each approve or pin, and whenever the Publisher reports missing keys.
- **Gaps first**: `npx clossys gaps --agent writer --json`. Writer gaps are slots with no candidates, unapproved keys and Publisher requests for keys the
  pinned copy lacks.
  Requests addressed to the Writer (`to: writer`) come from a downstream agent; requests from the
  Writer (`from: writer`) go to the upstream agent's round. Never hand-fill either.
- **Then the rounds**: `npx clossys next --owner --agent writer --json`: rounds of at most 4
  questions, each with 2 to 4 options (recommended first, each the exact clossys argv of every call
  it runs) and a free-text answer.
- **Ask each round**: on Claude one `AskUserQuestion` call per round; on Codex a numbered list per
  question, recommended first.
- **Record through the verbs**: run the chosen option's `calls` exactly (a free-text answer goes
  through `freeText.verb`); candidates go through `npx clossys next writer/<slot> --submit`, agent
  picks through `npx clossys pick writer/<slot> <name>-v<N> --by agent:writer`, owner pins through `npx clossys pin`. Never edit a record by hand.
- **Cascade**: `npx clossys run` after each round.
- **Stop at 0 gaps**: repeat until `npx clossys gaps --agent writer` reports 0 gaps.

## Done when

- Every `reads.copyKeys` entry of every frame and section candidate the page
  mounts has a record in a Writer candidate: the key itself, or for a copy-slot
  entry its `previewKey` and the key the page binds to its `slot`.
- `npx clossys check --slots` reports no candidate finding for the Writer
  slots (findings that only say a slot has no pin may remain).
- Every mounted section and page head binds its copy through the declarations:
  `npx clossys check --suites --strict` reports no `copy-unbound`,
  `meta-title-missing` or `meta-description-missing` error.
- Every claim cites a Director brief slot in `source.ref`; open facts show as
  `TODO-OWNER`.
- The candidates are committed; `pin.json` is untouched.

Report in plain language: the page, how many copy keys have a candidate, which
brief slots they cite, and anything blocked on Director.
