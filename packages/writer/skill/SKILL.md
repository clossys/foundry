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

## Fill (slot model)

Use this mode when asked to `fill` a migrated workspace. It takes precedence
over the legacy store loop below for initial fill. The agent derives content;
the deterministic API only measures readiness and records supplied bytes.

1. Read `clossys/agents/writer/ia.json` and call the installed Producer API:
   ```js
   import { planSlotFill, recordInitialCandidate } from "@clossys/producer";
   const plan = planSlotFill("clossys", "writer");
   ```
   Report `total`, `withCandidate`, `ready`, `blocked` and each blocked row's
   `blockedBy`. Use current IA order and measured counts, never an old target.
   Missing migrated input is WAITINPUT; do not substitute a legacy workspace.
2. For each `ready` empty row, read its `slot.json` contract and every
   `row.inputs[].bytes`. Inputs must have owner-cleared pins whose candidate
   hashes verify. A migration pin alone is not clearance. Never infer missing
   inputs from prose, old stores or a newer unpinned option.
3. Derive exactly one candidate for that row.
   Read every cleared Director input and the Writer leaf contract. Derive the
   words in the consumer voice with factual claims supported by those inputs.
   Record `slot`, `locales` and `source` in Markdown frontmatter; the body has
   `## <locale>` and `### <key>` followed by `<!-- {"id","bindings"} -->` and text.
   Preserve existing copy keys. This is DRAFT copy for owner approval; do not
   activate, compile as approved copy, or add status to frontmatter or records.
4. Cite every `row.inputs[].ref` exactly in `source.ref`; these references
   include the candidate name and sha256. Use one `source` key, with no
   candidate-side status or approval fields. Record the supplied option:
   ```js
   recordInitialCandidate("clossys", "writer", slotId, candidateName, candidateBytes);
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

## Derive Writer cells from Director

When asked to derive a consumer's verbals, use a fresh high-capability Writer subagent in that product's subscription session, following this skill. Interpretation and creative drafting happen in that session. The CLI makes no model calls, uses no API keys or network, and creates no drafts. Plain `clossys write` compiles only active Writer cells; it does not derive copy.

1. Read `clossys write --brief` from the consumer root. It prints a structured brief of active Director brand essence, personality, visual direction, voice, audience, position and wont-claim, with cell ids, versions and the Writer leaves to fill. Read the cited source and its obligations before choosing words. Keep the handoff checks above; missing direction blocks drafting, and unresolved facts stay visible as `TODO-OWNER` placeholders.
2. Interpret the direction into specific voice rules and the requested `site.*` page copy: what this audience needs to understand, the promise supported by the position, and how the personality changes vocabulary, rhythm and emphasis. Explain those choices rather than copying Director bullets into marketing sentences. Never invent proof, product claims, contact details or legal facts. Use exactly the consumer's configured source and target locales, preserve interpolation and translation provenance, and report any unsupported language checks. Generic package instructions remain in English.
3. Carry wont-claim into enforceable native bans as well as editorial constraints. Use `lexicon.avoid-terms` records (`kind: "term"`, `termStatus: "avoid"`, `term`, `forms`, `reason`), voice-rule `forbidden` phrases, or safe `lexicon.avoid-patterns` records as appropriate to the existing record contract. A preferred term or a rationale mentioning a ban does not enforce it. Interpret semantic prohibitions carefully; retain a named limit when a deterministic phrase check cannot establish compliance.
4. Write native cells with `status: draft`, without changing active or retired bodies or `tree.json` pointers. For an existing active cell, run `node node_modules/@clossys/writer/dist/cells/cli.js propose <cell.id>` and edit the returned draft path. This requires an active version; initial cells need the established migration/setup flow and an output mapping in `compile.json`. Preserve the Writer grammar: two-segment cell ids, `cells/<id>/v<N>.md`, flat frontmatter, ordered locale sections, and existing record headings, metadata and bodies. Keep rationale in the supported `note` string, not a new frontmatter key or free prose section. Put the actual brief refs in `links`, for example `director:identity.verbal.voice@1`. Each record that realises a source trait or voice rule also carries `directorSources: [{"ref":"director:identity.verbal.voice@1","line":15}]` in its existing JSON metadata (inside the fenced JSON for a textless record). Copy `ref` and `line` from the brief's obligations; include each ref in the cell's `links`. These numbers are illustrative, never substitute them for the actual active versions and source lines.
5. Run `clossys write --check` before activation. It reads the latest non-retired version per Writer cell, so newer drafts are checked while active pointers stay unchanged. Resolve missing or stale Director links, uncovered voice/trait obligations, wont-claim findings and locale gaps; retain named limits where a check cannot evaluate. Its wont-claim check matches quoted Director Never/Never-claim phrases against copy; unquoted prohibitions report `wont-claim:unchecked`. It does not interpret the authored avoid records: keep their existing native lint gates. Refresh the brief and citations if Director activates a new version. A clean result proves the measured traceability, not the quality of the wording or copy approval.
6. Present the exact draft versions and rationale for the existing owner confirmation flow. Activate only with a real confirmation reference: `node node_modules/@clossys/writer/dist/cells/cli.js activate <cell.id>@<N> --out clossys/agents/writer/compiled --confirm 'msg:<session>#U<n>'`. Multiple exact refs can form one confirmed batch. Do not invent a confirmation or use migration confirmation for a new revision. Activation validates the Writer profile and compiles the active versions; preserve the separate record approval requirements. Re-run `clossys write --check` and plain `clossys write` after activation, and report findings or limits.

The planner reads the Studio specimens against Director to judge the resulting verbals, then the owner confirms the result in one look. This does not replace the separate pre-auth keep review below, and Writer does not self-certify taste or approval from a machine pass.

## Done when

- Every `reads.copyKeys` entry of every pinned item a page uses has an active
  record whose id the page binds, so `npx clossys publish --install --page <page>`
  reports no `missing-copy-key` or `unbound-copy-slot` finding.
- `writer-check slots ... --strict` exits 0 and `clossys check --suites` shows
  no Writer slot findings.
- The compile check reports no drift and the records are committed.

Report in plain language: the page, how many copy slots are filled, which
Director cells they cite, and anything still blocked on Director.
