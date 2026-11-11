# Cell template

A cell is one slot folder, `clossys/agents/director/<cell-id>/`. Each version is a candidate file, `<cell-id>/candidates/<name>-v<N>.md`; the slot's `pin.json`, written by `clossys pin`, names the active one. A candidate holds bullets only. The frontmatter is one `key: <JSON value>` line per field.

## Blank template

Copy this to `<cell-id>/candidates/<name>-v<N>.md`. Replace every `<…>`. Take the `Key:` labels from the cell's must-contain list in its `slot.json` contract.

```markdown
---
slot: "<l1.l2.l3>"
source: {"kind":"derived","ref":[<every ref used in Because, exactly once, as JSON strings>]}
feeds: [<brief contract ids that require or use this cell, as JSON strings>]
functions: [<"product"|"gtm"|"brand"|"people"|"ops"|"tech"|"finance"|"corp-dev">]
note: "<why this version exists; \"option A\" when it is one of several options>"
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
  - `finding:<id>` for evidence in `clossys/evidence/director/<id>.md`, including what the owner said;
  - `<cell-id>@<N>` for a cell this one builds on (cite the pinned version).
  - `source.ref` lists exactly these refs.
- **Watch:** at least one testable tripwire.
  - Comparators: `>`, `<`, `>=`, `<=`, `=`, `rises above`, `falls below`, `reaches`, `stays below`, `stays above`, `is still`, `appears`.
  - The threshold has a number or a quoted value.
- **Pin:**
  - A candidate is a draft until the owner confirms it.
  - Confirmation runs `clossys pin director/<cell-id> <name>-v<N> --by owner --basis picked`, which records the candidate, its sha256, who decided, the basis and the time in `pin.json`.
  - A pinned candidate file never changes again; its sha256 is in the pin.
  - A change is always a new candidate `<name>-v<N+1>.md`, pinned the same way.
- **Links (optional):** add `links: [designer:frames.app-shell@1, writer:admin.writer@3]` for cross-agent cell references, or use `<cell-id>@<N>` for a same-agent link. Shared link ids contain two or three lowercase kebab segments; `N` is a positive safe integer. Links do not replace Because citations. Omit the field to preserve the existing format, or use `links: []` explicitly. Cross-agent resolution belongs to the consuming agent.
- **Never:**
  - prose paragraphs;
  - hex colours or font pairings in `identity.visual.*`;
  - generic phrases ("best-in-class", "seamless", "solutions", "everyone").

## Anonymous worked example

This illustrative core segment describes an unnamed studio tool. It is version 2, after the user narrowed version 1 during a pricing pushback. The finding excerpts below are fictional format examples, not consumer evidence.

File `focus.segment.core/candidates/studio-segment-core-v2.md`:

```markdown
---
slot: "focus.segment.core"
source: {"kind":"derived","ref":["context.customer.need@1","finding:owner-kiln-queue-2026-10-29","finding:owner-home-potters-2026-10-29","finding:studio-interviews-2026-10"]}
feeds: ["writer.messaging","customer.persona"]
functions: ["gtm","product"]
note: "Narrowed from v1; home potters dropped after the pricing pushback."
---

## Direction
- Who: owners of independent ceramics studios with 40 to 150 members who rent shelf space and firings by the month.
- Situation: the owner runs memberships, kiln loads and class bookings from a spreadsheet and a group chat, and loses about 4 hours a week to kiln scheduling.
- Not: hobbyists with one home kiln, and university ceramics departments; both buy from different budgets.
- Studios with a membership waitlist come first, rather than studios still looking for members.

## Because
- Owners called kiln scheduling "the weekly fire drill" (finding:owner-kiln-queue-2026-10-29)
- 11 of 14 interviewed owners ran memberships in a spreadsheet (finding:studio-interviews-2026-10)
- The need cell names the kiln queue as the job to be done (context.customer.need@1)
- Home potters will not pay a monthly fee, so v1's wider segment broke the pricing (finding:owner-home-potters-2026-10-29)

## Watch
- If the share of signups from studios under 40 members rises above 30% in any quarter, then propose a review of this cell with focus.segment.next.
- If the trial-to-paid rate of waitlisted studios falls below 10% by 2027-03-31, then propose a v3 that drops the waitlist rule.
```

The owner confirmed it, so it was pinned:

```sh
npx clossys pin director/focus.segment.core studio-segment-core-v2 --by owner --basis picked
```

One finding it cites (`clossys/evidence/director/studio-interviews-2026-10.md`):

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
| Q3 grounded | every Because bullet has a resolving ref, and `source.ref` equals their union |
| Q4 testable | both Watch bullets follow the grammar, with numbers and a date or period |
| Q5 specific | numbers, named alternatives, no banned phrases |
| Q6 real choice | `Not:` plus "rather than" |
| Confirmed | `pin.json` names `studio-segment-core-v2.md`, decided by the owner |
| C1 | `advantage.proposition.promise@1` must cite `context.customer.need@1`. `focus.reach.channel` will need to cite `focus.segment.core@2` |
| Effect on v1 | v1 stays in `candidates/`, unpinned and unchanged |
| Effect on citations | anything citing `focus.segment.core@1` is now stale |

## Owner-words finding

After each answer the interview records the owner's words verbatim, one finding per answer, in `clossys/evidence/director/owner-<topic>-<YYYY-MM-DD>.md`. The `Informs:` bullet routes the answer to every cell it touches. This example is fictional.

```markdown
---
id: owner-kiln-queue-2026-10-29
source: user
observed: 2026-10-29
by: director
---
- Asked who feels the pain first, the owner said: "The studio owner. Every Friday is the weekly fire drill: who gets the kiln, whose pots wait."
- Informs: context.customer.need, focus.segment.core
```

## Judgement finding

A judge a script cannot replace (the storyline critic `C4`, the pairs `C2:X3` and `C2:X7`, or a cell check `Q<n>:<cell-id>@<N>`) is recorded as a finding once the owner has heard the reading. `judged` lists every cell the judge read at its pinned version; for `C4` that is all seven storyline cells. The CLI counts the verdict only while every listed version is still the pinned one, so a newer pin of any of them means not judged again. When two current verdicts for one judge disagree, `fail` wins. A cell check (`Q<n>:<cell-id>@<N>`) also needs `run: <step>#<run id>`, the run record of the judge's traced run in `.clossys/runs/<step>.jsonl`; without a resolvable run the verdict is not counted and the cell shows `judgment-uncited`. This example is fictional.

```markdown
---
id: critic-storyline-2026-11-10
source: user
observed: 2026-11-10
by: critic
judge: C4
verdict: pass
judged: ["context.customer.need@1", "aspiration.purpose.mission@1", "focus.segment.core@2", "advantage.proposition.promise@1", "identity.brand.essence@1", "capability.operation.delivery@1", "execution.priority.bet@1"]
---
- Pre-mortem, read in a fresh context with the pinned core cells only: the likeliest failures are a second kiln-booking tool bundling scheduling for free, and studios under 40 members signing up and churning.
- Storyline: need, mission, core segment, promise, essence, delivery and bet read as one argument; no cell breaks it.
- The owner heard both risks and said: "Add the churn tripwire to the segment; the bundling one we accept."
```
