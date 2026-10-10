# Content cookbook

How to write a marketing band for Designer's content blocks: which block to
pick, what each slot holds and how long it may be. Publisher's
`content-section` contract carries these blocks (`SectionedView`,
`LandingView`). Its validator enforces counts and shapes, and its
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
  schedule"). At most one is primary (filled); the other is secondary
  (outlined). Never more than one primary per band, and one main call to
  action per run of bands.
- A footnote is an optional single short sentence at the end of a band, small
  and muted, for an aside only ("Already keep records in a spreadsheet? Read
  the import guide"). It holds at most one underlined link. Never put a call
  to action in a footnote.

## Choose the block from the information

A content section holds at most one block in its `block` field. The block's
`type` is the Designer block name in kebab case: **FeatureGrid** is
`feature-grid`. The pieces inside a block (items, cards, steps, specimen
parts) are its parts, not blocks.

Pick the block from what the information is. Write the copy after that.

| The information is | Block | Notes |
|---|---|---|
| A framing statement, or a band that only points elsewhere | intro band (no block, no media) | up to 40 words; 1-2 buttons |
| 2-4 parallel capabilities or audiences of equal weight | **FeatureGrid** (`feature-grid`) | `plain` by default; `rule` for a quieter 4-up; `plate` for 2 longer items |
| 3 short beliefs or outcomes that should land as statements | **FeatureGrid** (`feature-grid`), `emphasis: "statement"` | exactly 3 items |
| A mix of items of unequal weight, some with product evidence | **CardGrid** (`card-grid`, bento) | the wide card holds the main point |
| A before and after, or a without and with | **Comparison** (`comparison`) | at most one per page |
| A checklist of 4-8 short topics | **TopicList** (`topic-list`) | 2 columns; 1 column beside a specimen |
| An ordered process with a hand-off between people | **OrderedStepSequence** (`ordered-step-sequence`) | 3-4 steps; actor labels name who acts |
| Questions a buyer asks before acting | **Faq** (`faq`) | split band: header beside the rows (the legacy `faq` section opts in with `layout: "split"`) |
| What the product shows on screen: a record, a matrix, a schedule, a result | specimen media | `single`, `row` (2-3 peers), `stack` (2-3 related views), `flow` (a hand-off from one panel to the next) |

Use a split layout (`layout: "split"`) when the text and the specimen explain
each other: the header and a short block sit in the text column, and the
specimen sits beside them. Use stacked when the specimen needs the full width
or the block stands alone.

A split may also go without media when its block is `faq`, `topic-list`, or
2-column `feature-grid` with item emphasis: the block takes the visual column,
top-aligned beside the header. Use it when the items are the evidence and
there is no specimen to show. CardGrid, OrderedStepSequence and Comparison always need media in
a split.

## Blocks

Word counts are per item unless stated.

**Hero.** The header at `h1`, plus one action. Heading 5-10 words;
description 20-35 words; action 1-3 words.
Write the promise and the reader it is for. Do not write a slogan that would
fit any product.

**Intro band.** Header only, plus 1-2 buttons and an optional footnote.
Description up to 40 words; buttons of 2-4 words. Use it to frame the next run of bands or to point to
another page. Do not put a list into the description.

**FeatureGrid** (`feature-grid`). 2-4 items, each a heading and a description. Heading 2-5
words; description 6-20 words (up to 25 for 2-column `plate`). Statement
emphasis: exactly 3 items, heading 2-3 words, description at most 12 words.
Items are parallel: same grammar, same length, one idea each. Icons go with
`plain` and `plate` only, and only when they tell items apart. An item may
carry an optional eyebrow above its heading: 1-3 words, at most 32
characters (Publisher refuses a longer one), naming the item's area or role ("Compliance", "Spend"). Give every
item an eyebrow or none, and do not pair an eyebrow with an icon.

**CardGrid** (`card-grid`, bento). 2-6 cards whose spans fill whole rows. A row is
two-thirds + third (either order), three thirds, two halves, or one full card.
Heading 2-5 words; description 8-20 words (25 on a two-thirds or full card);
optional eyebrow (cards only) naming the role or area; optional visual of one
specimen part with at most 5 rows. Put the main point on the widest card. Do
not give every card a visual.

**Comparison** (`comparison`). Two sides with labels of 1-3 words. Give each side either a
description of at most 25 words or 2-4 points of 4-9 words, with the same form
and the same count on both sides. Visuals go on both sides or on neither.
Write facts on both sides. Do not caricature the "before" side.

**TopicList** (`topic-list`). Each item is a heading of 2-5 words and a line of 4-12 words. In 2
columns, use 4-8 items, an even count. In 1 column beside a specimen, use 3-4
items. Use a topic list for scannable coverage. Do not use them for arguments.

**OrderedStepSequence** (`ordered-step-sequence`). 3-4 steps. Each step has an ordinal ("01"), a heading of 1-2
words (a verb), a line of 6-14 words, an optional actor of 1-2 words and an
optional visual panel. Name the actor whenever the work changes hands. Give
every step a visual or none of them.

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
