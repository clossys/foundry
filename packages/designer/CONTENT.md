# Content cookbook

How to write a marketing band for Designer's content blocks: which block to
pick, what each slot holds and how long it may be. Publisher's
`content-section` contract carries these blocks through `SectionedView`. Its validator enforces counts and shapes, and its
`checkSectionVariety` lint warns about page rhythm. Nothing checks the
budgets below, so the writer owns them.

To see every block filled at a typical length and at the maximum budget,
run `publisher-preview <brand.css> <out-dir>` and open
`<out-dir>/content-catalog.html`. Its grey captions are preview chrome; each
names the band's block and its variant.

## The header rule

Every band opens with the same header group, and each slot has one job:

| Slot | Job | Budget |
|---|---|---|
| eyebrow | **What** the band is about: a noun phrase, no period | 1-5 words, at most 32 characters |
| heading | **Why** it matters: a claim or a promise the reader cares about | 4-10 words stacked, 4-8 words split, at most 2 lines on desktop |
| description | **How** it works: the mechanism behind the claim | 15-30 words, 1-2 sentences |

- Eyebrow "Inspections", heading "Overdue checks surface before they become
  findings", description "Each recurring inspection carries its interval and
  its last result, so the schedule shows what is due this week."
- The heading never restates the eyebrow. The description never restates the
  heading.
- Section actions are 1-2 buttons: 2-4 words, a verb first ("See the
  schedule"). At most one is primary (filled). Publisher resolves omitted emphasis
  from band weight: A uses secondary then quiet, B and frame C use tertiary,
  and other C uses quiet; authored emphasis wins. Never more than one primary per band, and one main call to
  action per run of bands. Which bands take them depends on the band's shape
  (see "Actions and links by band shape").
- A footnote is an optional single short sentence at the end of a band, small
  and muted, for an aside only ("Already keep records in a spreadsheet? Read
  the import guide"). It holds at most one underlined link. Never put a call
  to action in a footnote.

## Actions and links by band shape

A single column reads top to bottom, so a button above the content asks for
the click before the reader has seen the evidence. A split's text column is a
finished unit of its own, so a button can close it. Publisher refuses the
shapes marked "No".

| Band shape | Section actions? | Where | Code when refused |
|---|---|---|---|
| Stacked, with a block or a visual after the header | No, neither under the header nor after the block | Link the items themselves (item `href`), or put one link in the footnote | `sectioned-view-content-stacked-actions` |
| Stacked, header only (an intro or statement band) | 1-2 | Directly after the description, as the band's last element | `-content-actions-count`, `-content-primary-count` |
| Header only, with actions and a footnote | No: nothing follows an action | Fold the footnote's sentence into the description, or drop the actions | `sectioned-view-content-actions-footnote` |
| Split (text beside a visual) | 1-2 | In the text column, after the description and before any block; never under the visual | `-content-actions-count`, `-content-primary-count` |
| Any band | Footnote: one sentence, at most one inline link | The band's last line | `-content-footnote-*` |

### Linked items

Cards (`card-grid`), features (`feature-grid`, item scale), topics
(`topic-list`) and steps (`ordered-step-sequence`) may each carry an `href`.
The item's title becomes its one link and its accessible name; a chevron
follows the title at rest, and the whole item is the click target. Statement
features, comparison sides and FAQ rows take no `href`.

| Rule | Code |
|---|---|
| Link every item in a block or none, so a reader never has to guess which one is a link | `sectioned-view-content-link-partial` |
| At most 6 linked items per block: cut a longer list, or leave it unlinked | `sectioned-view-content-link-count` |
| Each destination once per block (a trailing slash or a fragment does not make a new one) | `sectioned-view-content-link-duplicate` |
| An `href` is a fragment, a root-relative path, an http(s) URL or a `mailto:` | `sectioned-view-content-item-href` |
| Statement features are headlines, not destinations | `sectioned-view-content-link-statement` |
| A split whose block is linked takes no text-column actions: two link systems compete (lint warning) | `sectioned-view-variety-link-competing` |

- Write a linked item's heading as the destination's name, at most 48
  characters, so the link name scans. Never write "Learn more".
- A linked item holds plain text and static visuals only: no inline link, no
  button, no field. Designer throws a `TypeError` otherwise.
- Link steps rarely: only when each step has its own destination. When every
  step would point to one page, leave the steps unlinked and put that link in
  the footnote.

## The action ladder

Every action takes one rung. Pick the rung from the action's weight, then
write its label:

| Rung | Look | Use it for | Label |
|---|---|---|---|
| T1 | primary (filled) | the one main call to action of a view | 1-4 words, a verb first |
| T2 | outline | the second action beside a T1 | 2-4 words, a verb first |
| T3 | tonal | a supporting action inside a band, away from the T1 | 1-3 words, a verb first |
| T4 | quiet (text and chevron) | a "more" step: open the full list, read the detail | 2-3 words ("See all checks") |
| linked item | the item's title and the same chevron | an item that has its own page (see "Linked items") | the item's heading |
| text link | underlined link | a reference inside running text or a footnote | the words it links |
| icon-only | icon button | a control whose glyph says what it does: next, previous, close | a 1-3 word name, never shown |

- Use one T1 per view and step down for every further action. Never put
  two actions of the same rung side by side unless they are true peers.
- A T4 always leads somewhere further: never use it for the main action.
- An icon-only control still needs its name ("Next slide", "Close"). Its
  glyph is never the only label of a page's main action.

## Choose the block from the information

A content section holds at most one block in its `block` field. Canonical content uses `type: "items"` with a recipe or authored arrangement,
or `type: "matrix"` for two-sided content. Recipes select existing Designer
axes; the pieces inside a block are its parts, not blocks.

Pick the block from what the information is. Write the copy after that.

| The information is | Block | Notes |
|---|---|---|
| A framing statement, or a band that only points elsewhere | intro band (no block, no media) | up to 40 words; 1-2 buttons |
| 2-4 parallel capabilities or audiences of equal weight | **Items** (`items`, recipe `features`) | 2 or 3 columns with complete rows; plain, rule or plate treatment |
| 3 short beliefs or outcomes that should land as statements | **Items** (`items`, recipe `statement`) | exactly 3 items |
| A mix of items of unequal weight, some with product evidence | **Items** (`items`, recipe `cards`, bento) | the wide card holds the main point |
| A before and after, or a without and with | **Matrix** (`matrix`, recipe `comparison`) | at most one per page |
| A checklist of 4-8 short topics | **Items** (`items`, recipe `topics`) | 2 columns; 1 column beside a specimen |
| An ordered process with a hand-off between people | **Items** (`items`, recipe `flow`) | connected 3-5 steps; two-actor lanes use 3 or 5 |
| Questions a buyer asks before acting | **Faq** (`faq`) | split band: header beside the rows (the legacy `faq` section opts in with `layout: "split"`) |
| What the product shows on screen: a record, a matrix, a schedule, a result | specimen media | `single`, `row` (2-3 peers), `stack` (2-3 related views), `flow` (a hand-off from one panel to the next) |

Use a split layout (`layout: "split"`) when the text and the specimen explain
each other: the header and a short block sit in the text column, and the
specimen sits beside them. Use stacked when the specimen needs the full width
or the block stands alone.

A split can use its items or matrix as the companion when there is no media.
Keep the authored reading order and use a specimen when product evidence helps.

## Blocks

Word counts are per item unless stated.

**Hero.** The header at `h1`, plus one action. Heading 5-10 words;
description 20-35 words; action 1-3 words.
Write the promise and the reader it is for. Do not write a slogan that would
fit any product.

**Intro band.** Header only, plus 1-2 buttons, or an optional footnote when
it has no buttons. Description up to 40 words; buttons of 2-4 words. Use it to frame the next run of bands or to point to
another page. Do not put a list into the description.

**Items — features.** Two columns take 2, 4 or 6 items; three columns take
3 or 6. Heading 2-5 words; description 6-20 words (up to 25 for a longer plate).
Items are parallel: same grammar, length and one idea each. Optional icons and
eyebrows identify roles; they do not repeat the heading. Statement scale
uses exactly three items in three columns, plain or rule treatment, with no
icon, eyebrow or destination. Statement headings use 2-3 words and support at
most 12 words.

**Items — cards.** Two to six bento items fill ordered 12-unit rows: two-thirds
plus third (either order), three thirds, two halves or a full item. Heading
2-5 words; support 8-20 words (25 on a wide item). Put the main point in the
widest item and use supplied visuals only where they add evidence.

**Items — link index.** Link every item or none, up to six unique destinations.
Titles name the destination; support says what the reader will find. Use plate
or rule treatment. For one destination, use a footnote link or button. Avoid
vague titles such as "Learn more".

**Matrix.** Exactly two sides with labels of 1-3 words and required heading
lines. Use the same primary form on both sides: descriptions up to 25 words,
2-4 points of 4-9 words with equal counts, or visuals. Both sides use plates;
optional `featured` names one side's ID. Write facts without caricature.

**Items — topics.** Two to eight short rows: headings 2-5 words, support
4-12 words. Two columns require an even count. Labelled groups take 2-4 groups
of 2-4 item IDs, within the collection's eight-item budget. Groups retain
membership reading order and each inner list is named by its group label.

**Items — processes.** Numbered order follows rendered item order. Connected
order takes 3-5 steps in authored columns or a stack; four warns. Headings use
1-2 verb words and support 6-14 words. For two actors, use exactly two lane
`{ id, label }` definitions and known item lane IDs on a stacked 3- or 5-step
sequence. Start in the first lane and use both. Three lane columns begin at
1024px; five at 1280px. Optional visuals and a visual caption retain reading
order. A terminal follows the last step; `end="continues"` uses a decorative
arrow unless authored `endLabel` copy is supplied. Do not synthesize copy.

Published **FeatureGrid** retains its automatic grid, arbitrary counts and
paragraph item titles. Published **OrderedStepSequence** retains authored
ordinals, labels and adjacent decorative connectors. Canonical recipe bounds
and lane, visual, link and termination fields belong to Items.

**Faq** (`faq`). 4-6 items. Question at most 12 words, in the buyer's words; answer
15-45 words. Lead with the answer ("Yes.", "Only people with a role on that
site."). Do not answer with marketing.

**Specimen.** Specimens are static product UI made from data:

- Label: 12-25 words, the figure's accessible name, describing what is
  shown.
- Panel title: at most 40 characters. Meta: at most 50 characters.
- Field label: 1-3 words. Field value: at most 16 characters.
- Each part holds at most 6 rows (a table at most 4 columns × 5 rows). A
  panel holds 1-3 parts.

Status tones (`success`, `warning`, `danger`, `info`, `neutral`) are the
product's own data states, such as "Overdue", "Within limit" or "Signed". They
are never availability states: no "Live", "Beta", "Coming soon" or "Planned".
Use sample data only, in plausible formats. Do not use real customer names
or real figures.

**Close band (call to action).** Heading 4-8 words; line at most 15 words;
one action of 1-3 words. Ask for the next step, and name what the reader
brings or gets.

## Page variety

Publisher's `checkSectionVariety` warns on rules 1-3 and 7, the inverse limits
in rule 4, and the card and comparison limits in rule 5. The rest are yours to
keep.

1. Neighbouring bands never share the same layout, block type and visual
   type.
2. A split may follow a split only on the opposite `mediaSide`. Never use
   three splits in a row.
3. Alternate density. A band with a specimen or a table is followed by an
   airy band: a feature grid, a topic list, steps without visuals, an intro
   or an FAQ.
4. Grounds: the hero (inverse or base), then body bands alternating base and
   sunken, the closing band on base, and the call to action on inverse. Use at
   most one inverse body band, and never put a specimen on inverse.
5. At most one band with 4 or more cards, and at most one comparison, per
   page. At most two specimen-led bands in any three.
6. A section says its message once. If a visual shows the words, the block
   does not repeat them.
7. A block type used twice needs a different treatment (for example
   `feature-grid` `rule`, then `plate`).

## Do and don't

| Do | Don't |
|---|---|
| Write the heading as the reason to care | Use the heading as a label ("Features", "Our platform") |
| Keep items parallel in grammar and length | Mix a one-word item with a two-sentence item |
| Use numbers the reader can check, or none | Invent statistics, logos, quotes or customer names |
| Let the specimen carry the detail | Repeat the specimen's rows in the block text |
| Write within budget first, then cut | Rely on the layout to absorb overflow |
| Use plain verbs ("record", "assign", "sign off") | Use filler ("seamless", "powerful", "next-generation", "revolutionary") |
| Show status as data ("Overdue", "Signed") | Show roadmap as status ("Coming soon", "Beta") |
| Use one icon per item, only where it tells items apart | Put icons on headings, or emoji anywhere |


## Records on rules

Use **RecordLedger** (`record-ledger`) for one record, especially when the page
has already spent its panel. Use a specimen for a full product view. A dated event history
needs a separately designed timeline form.

Rows carry names, figures and statuses without repeating the surrounding copy.
Record groups hold one-to-six rows; an owner is a separate final group. Keep one
flag per record, with authored hidden lead-in copy.

For book-like items, use Items `treatment: "rule"` with a SpecimenPanel
status-rows visual holding one-to-six rows. A three-row mobile cap hides later rows below tablet
for every reader; put the row that matters, especially warning or danger, within
the first three. Ledger rows are static; linked cards have only their title link.


Use **AnatomyCallouts** (`anatomy-callouts`) when one record has three to five
areas worth naming. Prefer three or five markers, with a short heading and
one sentence per key item. Attach markers to the panel title, labelled parts
or footer in reading order, and disclose sample data with the caption. Author
the figure and key labels; use a unique caller instance id. The figure comes
before the key at every width. Use **Items** for features without a
product surface, and steps or a story for a process.

Use **Scene** for a process or provenance story beside section copy: documents
converging into a record, a result traced to cited sources, or prepared findings
reaching a named decision role. Use a specimen for the record itself. Avoid
scenes as decoration, feature lists or more than two instances on a page.
Write a 12–25-word figure label describing what flows where; keep document
titles factual. Author the relation label and mark illustrative data with a
sample caption. An approval chain has exactly one subject. Keep source, row and
finding ids unique within their slots, and give each figure a separate instance
id even when two figures share the same seed.

## Derived page flow

Publisher's opt-in `sectionWeight` derives A set pieces, B supporting bands
and C breathers from authored structure. A hero is a role with weight `hero`.
Full-width specimens, visual cards, visual comparisons, visual steps and
statements are A; split specimens and text blocks support them; frames, short
plain or rule lists and FAQ bands provide pauses. Plate feature grids are B
grids. Weight never reads ground and has no authored override.

Publisher's `checkPageFlow` checks opening impact, runs, repeated set-piece
shapes, page-length counts, calm landing, inverse placement and primary actions.
The `sectioned-view-flow-action-weight` finding names action emphasis or count
above the body's weight ceiling. Pages with fewer than three body bands are
exempt from `opening-set-piece`; other flow rules still apply. Primary targets
ignore trailing slashes and nonleading fragments, retaining distinct leading
fragments just as body links do.
At most two body blocks link items. Each body destination appears once across
item links, section actions and footnote links; hero and close are excluded.
Card links count as quiet actions for weight fit, independently of section
button counts. These findings are advisory and never run during rendering.
Omitted section actions use secondary then quiet on A, tertiary on B and frame C,
and quiet on other C bands. Explicit emphasis wins; an action above the weight
ceiling still renders as authored and receives an advisory `action-weight` warning.

## Closing copy

Author closing content as a `content-section` with its own CopyRefs for the
heading, description and actions. `SectionedView` renders that checked document
through the registered Designer blocks. The executable Landing view and its
hero-copy reuse props are retired.

**Compact hero.** Use `Hero size="compact"` when a form, status or utility
content is the page's main job. Keep the heading short and place that content
after it. Publisher authors set `compact: true` on the opening hero; use no
hero media. The compact opening keeps the heading as `h1`.
