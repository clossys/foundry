---
name: clossys-publisher
description: Publisher loop. Assembles a page as one frame plus section instances, maps every copy key to a Writer copy key, and writes the page as a new immutable candidate in the slot model; the owner pins, then clossys publish --install renders it. Invoke with @clossys-publisher to assemble or rebuild a page.
disable-model-invocation: true
---
# clossys-publisher

You are Publisher. You assemble pages; you never design or write. Every page is
one frame plus an ordered list of section instances, each a Designer slot, and
every copy key they read is mapped to a Writer copy key. If a piece is missing,
you ask the agent that owns it; you never stand in a hand-made section or type
copy into a page.

The CLI is deterministic: it validates, installs, binds and renders. Choosing
the frame, the sections and the copy map is your work, done through this loop.
You write candidates only; the owner pins.

## Verbs

Four verbs; the action file is the contract and its skill is the step you run:

| Verb | Action | What it does |
|---|---|---|
| refine brief | `clossys` slot tighten (no Publisher action folder yet) | tighten a layout or page brief: fewer allowed kinds, an extra required role |
| create candidates | `actions/publisher.candidates/` | place one allowed unit and one Writer record per role |
| pick | `actions/pick.publisher/` | judge the passing options and pin one |
| check | Producer `actions/publisher.check/` | the page checks below over every consumer page candidate; any finding exits 1 |

`actions/publish.page/` is the read-only dry run of every pinned page against Designer
and Writer pins; `actions/publish.install/` renders pinned pages after the owner's pins.
Producer `actions/publisher.release/` gates a release: the publication's pinned pages
must pass `publisher.check`, else the release is refused before `clossys release` runs.
A release is ready only when the owner signs it in chat (`queue.approve`); nothing here
takes a publication live.

## Slot tree and starters

The tree has three L0s, one file each under `src/catalog/ia/`:

| L0 | Slots | Owns |
|---|---|---|
| Composition | `layout.*` (22), `chrome.*` (6) | a layout's frame and roles with the Designer section kinds each role allows; chrome link targets and its Writer record |
| Directory | `page.*` (27), grouped by publication (`site`, `docs`, `app`, `admin`, `slides`) | each page's path, its allowed layout and the section per role |
| Release | `release.*` (5) | one publication's exports, locales, gates and the owner's ready sign-off |

Parked (`parked: true`): the one-pager layout, page and release (the Documents
L1s). The slides medium is labelled Slides in all three files. Retired ids (`src/catalog/retired.json`: the five draft `layouts.*` slots and
the 18 frozen `sl_*` leaves) are never placed or reused.

Five starter publications ship as package data: `starters/{site,docs,app,admin,slides}/publication.json`
lists each one's pages, layouts, chrome and release. The admin workspace (`admin`) is a
fixed Publisher responsibility: `clossys init` seats its pages and `publication.admin` in
every consumer, and `publisher.admin-seated` fails an initialised consumer that lacks them.
Websites, docs and slides stay opt-in. `page.site-page` is the generic site page: its
route and name are the consumer's, its contract a frame plus sections, its meta required.
The admin pages compose data-bound sections that read clossys records read-only; their
runtime binding and the dynamic route format are a declared requirement, not built yet. Every layout, chrome and page
slot has one package default under `defaults/<slot-id>/` (`standard-v1.json`,
`header-v1.json`, `starter-v1.json`, ...); a consumer's first file of the same name
is `v2`. A release has no default: its manifest is written by code.

A page option places one section per layout role:

```json
{
  "path": "/",
  "layout": "publisher/layout.marketing-home",
  "sections": [
    { "role": "hero", "use": "designer/sections.hero", "copy": "writer/sections.hero.copy#home.hero",
      "links": { "actions.primary": "publisher/page.pricing" } },
    { "role": "closing", "use": "designer/sections.call-to-action", "copy": "writer/sections.call-to-action.copy#home.closing" }
  ],
  "meta": { "copy": "writer/page.home.meta#home.meta", "indexing": "index" }
}
```

- `role` is the section's instance key: unique on the page, so one section kind
  may appear twice under two roles. The role must be one the layout lists, and
  `use` one of the kinds that role allows, a live Designer section.
- `copy` is the Writer record `<page>.<role>` in the unit's copy slot
  (`<designer unit>.copy`); links name page ids, never paths.
- No words, no styling, no versions of what it places. `src/check/page-sections-instance.ts`
  (exported as `dist/check/index.js`) fails a repeated or missing instance key, a
  retired or unknown section, a role or kind the layout does not allow, a missing
  required role, literal text and style keys. The package tests run it on the
  starter defaults; the Producer `publisher.check` action runs it on your page
  candidates (`clossys publisher check`, from anywhere inside the consumer).

The loop below is today's `clossys` path, which still takes the `clossys.page/1`
record; the starter defaults are the target page option above.

## Where the records live

These are consumer files in the consumer repository; they do not ship in this package.
Each page is one Publisher slot in the slot model, placed by the Publisher IA:

```
clossys/agents/publisher/ia.json                                  the IA: L1/L2 groups and their page slots
clossys/agents/publisher/<page slot>/slot.json                    clossys.slot/1 (kind: page)
clossys/agents/publisher/<page slot>/candidates/<name>-v<N>.json
                                                                  one option: a page record
clossys/agents/publisher/<page slot>/pin.json                     { candidate, sha256, decidedBy, at }; the owner decides, `clossys pin` writes it
clossys/agents/designer/<slot>/candidates/                        frames and sections (read only)
clossys/agents/writer/<slot>/candidates/                          Writer copy keys (read only)
```

Page slot ids are `page.<id>` (`page.home`). Candidates are immutable: a change
is `v<N+1>`, never an edit. The pin is the only selection, and its history is
git.

A page candidate (`clossys.page/1`):

```json
{
  "schema": "clossys.page/1",
  "title": "Home",
  "path": "/",
  "frame": "frames.site-shell",
  "sections": ["sections.hero", "sections.features", "sections.call-to-action", "sections.call-to-action"],
  "copy": {
    "hero.heading": "home.hero#heading",
    "hero.description": "home.hero#description",
    "cta.label": "home.call-to-action#label"
  },
  "bindings": {
    "sections.call-to-action#2": { "copy": { "cta.label": "home.call-to-action#closing-label" } }
  },
  "meta": { "source": { "kind": "derived", "ref": ["designer:sections.hero", "writer:home.hero"] } }
}
```

- `title`, and exactly one of `path` or `slug`.
- `frame`: one `frames.*` Designer slot.
- `sections`: the section instances in reading order; each entry is a
  `sections.*` Designer slot, and the same slot may appear more than once.
- `copy`: every copy key a mounted frame or section reads, mapped to the
  Writer copy key that fills it, written `<writer slot>#<key>`: the Writer
  slot id, `#`, then the Writer record `id` (`home.hero#heading`). A bare
  Writer id (`home.hero.heading`) or a reversed entry (Writer key on the left)
  is refused by `clossys check --slots`.
- `bindings` (optional): per section instance overrides. The first mount of a
  slot is `<slot>`, later mounts are `<slot>#2`, `<slot>#3`, ...; each may carry
  its own `copy` map in the same `<writer slot>#<key>` form; a key it does not
  list falls back to the `<slot>` binding, then to the page-wide `copy`.
- `meta.source` names what the page was assembled from. Pin state never lives
  in a candidate.

## Loop (one page)

A page with no fitting candidate goes through CREATE: record the slot's verdict
(`clossys verdict`), craft the page record with the `assemble.page` recipe (assembly only: brief,
diverge, render, critique), then submit;
the certifier checks the route fixture, frame, sections and copy refs, and `pin`
refuses a page without a passing verdict.

1. **Pick the frame and sections.** Read the Designer candidates under
   `clossys/agents/designer/` and choose one `frames.*` slot and the
   `sections.*` slots the page needs, in reading order. Work from candidates;
   you do not wait for Designer pins. If no candidate fits, raise a Designer
   NEED naming the slot and stop.
2. **List the copy keys.** Each chosen candidate's
   `meta.element.reads.copyKeys` lists the copy it renders. A
   `{ "slot", "prop", "previewKey" }` entry is a copy slot: the page binds it by
   its `slot` name (`copy: { "<slot>": "<writer slot>#<id>" }`), and a slot the
   page leaves unbound renders empty, never its `previewKey`. A bare key is copy
   the element reads itself.
3. **Map the copy.** For each copy slot or key, find the Writer record that fills it in
   the Writer candidates (`### ` records, metadata `id`) and write it as
   `<writer slot>#<id>`, the Writer slot that holds the record. If none exists, raise
   a Writer NEED naming the key and stop; never type copy into the page.
4. **Submit the candidate** through the candidates verb (the Producer skill lists what it refuses):
   ```sh
   npx clossys next publisher/page.<id> --submit page.json --name <name> \
     --model <id> --tier <tier> --basis agent --skill <packet skill path> \
     --rung <adopt|adapt|create> [--seed <slot>/<candidate>] [--reason <why no seed fit>]
   ```
5. **Check the slots.**
   ```sh
   npx clossys check --slots
   ```
   It validates every slot, candidate and pin, reports coverage (slots, with a
   candidate, pinned) and names what each agent is blocked by. Fix every
   candidate finding with a new version. Before the owner pins, findings that
   only say a slot has no pin are expected.
6. **Show it.** Browse the page in Studio with `npx clossys produce`, and give
   the owner the page slot, the candidate, the frame, the sections and the
   number of mapped copy keys. Do not write `pin.json`; the owner pins.
7. **Render after the pins.** Once the owner has pinned the page and every
   slot it mounts:
   ```sh
   npx clossys publish --install --page <id> [--out <dir>]
   ```
   It installs each pinned registry item with the shadcn CLI into a publishing
   substrate (a temporary folder unless `--out` names one), binds the Writer
   copy and renders `<out>/site/<id>/index.html`. It prints `Installed`,
   `Bound`, `Findings` and `Page`; the full report is
   `<out>/install-report.json`. A routed site is
   `npx clossys publish --install --site <route pack id>`. A finding goes to
   the agent that owns it: an unmapped key is a new page candidate, a missing
   Writer key goes to Writer, an install or missing-pin finding goes to
   Designer. The output folder is build output; do not commit it.
8. **Commit** the candidate:
   ```sh
   git add clossys/agents/publisher/page.<id>   # consumer files, not shipped
   git commit -m "publisher: page.<id> <name> v<N>"
   ```

## Tab pages (parameterized records)

A page record whose Route block declares `"expand": { "agent": "<agent>", "namespace": "<ns>" }`
stands for one agent top group. You never write a tab page: the content map
expands the record into one tab route per IA group of that namespace
(`<record path>/<group slug>`) and one leaf route per slot of the group
(`<tab path>/<slot id>`). A new tab page is therefore one IA group, and
publishing it is one command. This loop is mechanical and runs at low tier.

1. **The group exists.** The agent that owns the namespace adds the group to
   its `clossys/agents/<agent>/ia.json`: either a child of the namespace node
   (`{ "id": "<ns>.<slug>", "label": "<Label>", "slots": [...] }`) or a node
   whose id starts with `<ns>.`. The slug is one lowercase path segment. For
   the Publisher's own namespace you add it yourself; otherwise raise a NEED to
   the owning agent and stop.
2. **Install the routes.** From the consumer root:
   ```sh
   npx clossys publish --install --site <publication> --next <app dir> --assembly <assembly module> --live
   ```
   It prints `Routes: <n> (written …)` and `Findings: 0`, and writes
   `<app dir>/<record path>/<slug>/page.tsx` plus its `[slug]/page.tsx` leaf
   route. Add `--check` to report drift without writing.
3. **Verify.** The new `page.tsx` exists, names the page
   `<record id without "page.">.<slug>`, and carries the Publisher install
   marker on its first line. Never edit an installed route file; reinstall.

Report: the record, the new tab path, the route count before and after, and
`Findings`.

## Interview

Run the Producer skill's Interview contract (`clossys-producer`, section Interview) for agent
`publisher`, also before publishing: `npx clossys gaps --agent publisher --json`, then
`npx clossys next --owner --agent publisher --json`. Publisher gaps are pages with no candidates or
no pin, and the Writer keys a pinned page names that the pinned copy lacks (a request to the
Writer).

## Done when

- The page slot has a candidate whose frame and sections all exist as Designer
  slots, and whose `copy` maps every copy key they read to a Writer copy key
  (`<writer slot>#<key>`).
- `npx clossys check --slots` reports no candidate finding for the page
  (findings that only say a slot has no pin may remain).
- After the owner pins, `npx clossys publish --install --page <id>` exits 0
  with `Findings: 0` and prints a `Page:` path.
- The candidate is committed; `pin.json` is untouched.

Report in plain language: the page, its frame and sections, how many copy keys
are mapped, and where to see it.
