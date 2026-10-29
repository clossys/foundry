# Cell template

A cell is one file in `cells/<cell-id>/v<N>.md` under the strategy root. It holds bullets only. The frontmatter is a flat YAML subset: `key: value` or `key: [a, b]`, with no nesting.

## Blank template

Copy this to `cells/<cell-id>/v<N>.md`. Replace every `<…>`. Take the `Key:` labels from the cell's must-contain list in the catalog.

```markdown
---
id: <l1.l2.l3>
version: <N>
status: draft
updated: <YYYY-MM-DD>
cites: [<every ref used in Because, exactly once>]
feeds: [<brief contract ids that require or use this cell>]
functions: [<product|gtm|brand|people|ops|tech|finance|corp-dev>]
note: <why this version exists; "option A" when it is one of several options>
---

## Direction
- <Key1>: <the choice, specific: names, numbers, a date>
- <Key2>: <…>
- <Key3>: <…>
- <optional extra bullet: a trade-off in "X over Y" or "only X" form>

## Because
- <the reason, short> (<ref>)
- <the reason> (<ref>, <ref>)

## Watch
- If <signal> <comparator> <threshold> <by YYYY-MM-DD | each <period> | in any <period>>, then <action>.
```

Rules:
- **Direction:** 2–6 bullets. Every must-contain key appears once as a leading `Key:` label. At least one bullet gives something up: use `Not`, `Never`, `Avoid`, `over`, `rather than`, `instead of` or `only`.
- **Because:** every bullet ends with refs in parentheses. A ref is one of:
  - `msg:<session>#U<n>` for what the user said;
  - `finding:<id>` for observed evidence;
  - `<cell-id>@<N>` for a cell this one builds on (cite the active version).
  - `cites` lists exactly these refs.
- **Watch:** at least one testable tripwire.
  - Comparators: `>`, `<`, `>=`, `<=`, `=`, `rises above`, `falls below`, `reaches`, `stays below`, `stays above`, `is still`, `appears`.
  - The threshold has a number or a quoted value.
- **Status:**
  - `draft` until the user confirms.
  - Activation sets `status: active` and adds `confirmed: msg:<session>#U<n>`. That U line must answer an S line that listed this `id@N`.
  - After activation the file never changes again, except that retiring it rewrites only the `status` line.
  - A change is always a new version.
- **Never:**
  - prose paragraphs;
  - hex colours or font pairings in `identity.visual.*`;
  - generic phrases ("best-in-class", "seamless", "solutions", "everyone").

## Worked example: Kilnpad (fictional)

Kilnpad is a fictional SaaS for ceramics studios, and one of the eval businesses. This is version 2 of its core segment, after the user narrowed version 1 during a pricing pushback.

File `cells/focus.segment.core/v2.md`:

```markdown
---
id: focus.segment.core
version: 2
status: active
updated: 2026-10-29
cites: [context.customer.need@1, msg:2026-10-29-1#U4, msg:2026-10-29-1#U7, finding:studio-interviews-2026-10]
feeds: [writer.messaging, customer.persona]
functions: [gtm, product]
confirmed: msg:2026-10-29-1#U9
note: Narrowed from v1; home potters dropped after the pricing pushback.
---

## Direction
- Who: owners of independent ceramics studios with 40 to 150 members who rent shelf space and firings by the month.
- Situation: the owner runs memberships, kiln loads and class bookings from a spreadsheet and a group chat, and loses about 4 hours a week to kiln scheduling.
- Not: hobbyists with one home kiln, and university ceramics departments; both buy from different budgets.
- Studios with a membership waitlist come first, rather than studios still looking for members.

## Because
- Owners called kiln scheduling "the weekly fire drill" (msg:2026-10-29-1#U4).
- 11 of 14 interviewed owners ran memberships in a spreadsheet (finding:studio-interviews-2026-10).
- The need cell names the kiln queue as the job to be done (context.customer.need@1).
- Home potters will not pay a monthly fee, so v1's wider segment broke the pricing (msg:2026-10-29-1#U7).

## Watch
- If the share of signups from studios under 40 members rises above 30% in any quarter, then propose a review of this cell with focus.segment.next.
- If the trial-to-paid rate of waitlisted studios falls below 10% by 2027-03-31, then propose a v3 that drops the waitlist rule.
```

The session lines this cell relies on (`sessions/2026-10-29-1.md`, excerpt):

```markdown
- U4: Honestly the kiln queue is the weekly fire drill. Every Sunday night I'm moving shelves around in a sheet.
- S5: Hypothesis: your first customers are membership studios, not home potters. Options: A) membership studios 40-150 members, B) any studio with a kiln, C) A plus community colleges. I lean A.
- U6: A, but I also wanted home potters.
- S6: Pushback: home potters fire maybe twice a month and pay per firing. A monthly fee at your pricing loses them. Keep them out of core and park them under segment.next?
- U7: Fine, they won't pay monthly anyway. Park them.
- S8: Playback for confirm: focus.segment.core@2 (Who: membership studios 40-150; Not: home kilns, universities), advantage.proposition.promise@1. Yes to both?
- U9: Yes, both.
```

The finding it cites (`findings/studio-interviews-2026-10.md`):

```markdown
---
id: studio-interviews-2026-10
source: user
observed: 2026-10-20
by: researcher
value: 11
unit: of 14 owners
aliases: [eleven of fourteen owners]
---
- 14 studio owners interviewed by the founder in October 2026.
- 11 ran memberships in a spreadsheet; 3 used a generic booking tool.
```

Why it passes:

| Check | Result |
|---|---|
| Q1 size | 4 Direction bullets |
| Q2 must-contain | Who, Situation and Not are labelled |
| Q3 grounded | every Because bullet has a resolving ref, and `cites` equals their union |
| Q4 testable | both Watch bullets follow the grammar, with numbers and a date or period |
| Q5 specific | numbers, named alternatives, no banned phrases |
| Q6 real choice | `Not:` plus "rather than" |
| Q7 confirmed | U9 answers S8, which lists `focus.segment.core@2` |
| C1 | `advantage.proposition.promise@1` must cite `context.customer.need@1`. `focus.reach.channel` will need to cite `focus.segment.core@2` |
| Effect on v1 | v1's `status` line now reads `retired` |
| Effect on citations | anything citing `focus.segment.core@1` is now stale |
