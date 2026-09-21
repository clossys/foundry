# Pre-auth page quality

This document is the standing contract for pre-auth marketing pages built with
Designer, Writer, and Publisher. **Done is exceptional (5).** Mechanical gates
can prove **good (3)** only; they never certify great, exceptional, or
world-class. A walk that stops at 3 and reports done is a defect.

Ratings are ordinal: **3 good** (floor, gated), **4 great** (authored, not
gated), **5 exceptional** (the keep — independent QA after 3 is green).

World class is judged **from the intended audience's perspective**, not as a
visual score and not as a copy score. The person who made the page does not
grade it.

---

## Feedback provider vs doer vs sealer

These three seats must not be the same agent. If they are, the feedback gets
negotiated and 3 is reported as 5.

| Seat | Who | Allowed | Forbidden |
|------|-----|---------|-----------|
| **Doer** | Designer and Writer (together); Strategist for direction | Make the page. Fix what QA named. | Author keep-review evidence. Inhabit the persona. Call 3 done. Split a self-review into a visual half and a verbal half. |
| **Feedback provider** | Independent **QA** | Inhabit the named Strategist Audience as a synthetic target user. Write one comprehensive keep/fail. | Edit the page. Rewrite the verdict after the doer objects. Seal. Grade against Designer or Writer rules instead of the person. |
| **Sealer** | Publisher | Seal after a QA keep. Prove the shipped bytes. | Inhabit the persona. Treat "the surface rendered" as a keep. Seal a fail. |
| **Rules judge** | Inspector | Judge whether the *change* satisfies declared rules (secrets, policy, review evidence). | Inhabit a target-audience keep. Fitness for a person is not a rule scan. |
| **Outcome measurer** | Observer | Measure what actually happened after land, including QA's own efficacy. | Judge the candidate. Act for another role. |

Designer reflecting on type and Writer reflecting on copy would split the
audience's one impression and let each doer certify their half. That is not a
keep.

Publisher running the keep because it is last before seal would make the sealer
the judge. Publisher already mounts `MarketingView` — it is a doer of the
page. Overnight walks that sealed 3-star pages as done were this failure.

Inspector running the keep would mix two jobs: "does this change satisfy every
applicable rule?" (`change escape rate`) is not "would this person stay?"
Inspector must not mutate the candidate and must not inhabit a persona.

A **frontend-only QA package** is the wrong cut. Fitness review is one role.
Pointing it at Designer+Writer for a pre-auth page is one job. Pointing it at
backend work in another engagement is the same role, different doers. Until
that package is created (`create` — see `docs/contracts/qa-role-candidate.json`),
the keep protocol still runs in a **separate session** that is not the
Designer, Writer, Publisher, Strategist, or Inspector session.

---

## Star scale

| Stars | Name | Meaning |
|------:|------|---------|
| 3 | good | Mechanical floor. A mid-tier model must not stop here. Gates can prove 3. |
| 4 | great | Authored brief executed: type pairing, domain-specific fold copy, honest media. Top-tier authors the brief; mid-tier executes. Still not a keep. |
| 5 | exceptional | The keep. Independent QA, inhabited as the named audience, comprehensive (visual + verbal + "is this for me"). The fold *is* the artifact. Swap the wordmark and it still could only be this product. Gates never certify 5. |

---

## 3 good (floor, gated)

All of the following must hold, or the page is **below 3**:

- **One display heading** through Designer `Hero` (`text-display-l` / `font-display`): not clipped, not stacked thesis lines masquerading as one H1.
- **Exactly one primary CTA** in the fold. `Hero.actions` are `Button` atoms. No second pill competing for primary attention in the first viewport.
- **Chrome does not intersect the first viewport** — chat, consent, locale pickers, dev overlays, and similar chrome are findings when they steal the fold. Chat starts closed on `/`.
- **Stylesheet the app loads** contains the Hero/Button utilities required by `designer-hero-css-check`, via the default path: `tokens.css` + `compiled.css` (one path; no mixed `compiled.css` and `theme.css` + `@source`).
- **Fold copy is not wallpaper** — generic positioning phrases any competitor could reuse (including case variants of built-in examples such as “AI-native”, “AI intelligence”, and “for founders” as the headline thesis). `writer-check --live` reports `fold-wallpaper` on declared live trees.
- **`heroMediaKind` is honest** — `product-surface`, `original-art`, or `none` in fold measurement JSON. Never decorative stock or metaphor imagery. Supply evidence; `designer-fold-check` fails closed when measurement is missing or invalid.
- **Ground rhythm is visible** — spacing and type rhythm read as intentional, not accidental markdown. Empty collections use `EmptyState` honestly instead of blank holes.

**Fail (below 3):** unstyled HTML, markdown-outline pages, clipped H1, chrome stealing the fold, wallpaper H1, two primary CTAs in the fold, stock-metaphor hero media, missing fold evidence.

**Gates that prove 3 (not 4 or 5):**

- `designer-hero-css-check` on the CSS file the app loads
- `designer-fold-check` on fold measurement JSON (`--also` for an additional viewport)
- `writer-check --live` with `--voice-record` on trees the page actually renders (includes `fold-wallpaper`)

---

## 4 great (authored, not gated)

Everything in **3**, plus:

- A **named type record executed** — display face, H1 minimum size, measure cap, monospace only for eyebrows/data (tracked under issue #1039; not invented ad hoc on a mid-tier walk).
- **Fold copy contains a domain noun** a competitor cannot reuse — aligned with Strategist do-not language and Writer slot discipline.
- **Fold media is the thing** — the product surface with real data, or original art of the artifact being made, at a scale that *is* the page, not a card-in-a-slot screenshot.
- **One visual device** that is not a generic dark/light SaaS band.

4 is still the doer's work. It is not a keep.

---

## 5 exceptional (independent QA keep)

Everything in **4**, plus a keep from independent QA inhabited as the named
Strategist Audience:

- **One record, one person.** Visual and verbal and "is this for me" on the
  same verdict. Not a Designer reflection plus a Writer reflection.
- **`inhabitedAs` is `target-audience`.** Never designer, writer, publisher,
  strategist, inspector, or builder.
- **Closed impressions:** `firstSeconds`, `isThisForMe`, `doIBelieve`,
  `wouldIStay`, `wouldITellAPeer`. A keep requires every closed impression to
  be yes. A no is a fail. The doer then fixes; they do not rewrite the no.
- **The first viewport is the artifact**, not an advertisement holding a
  picture of one.
- **Swap-the-wordmark test:** the fold could not sell a different category
  unchanged.
- **Proprietary motion, rhythm, or device** that a template cannot generate
  from slots alone.
- **Adversarial top-tier or frontier QA** after mechanical gates are green.
  Mid-tier does not invent this level, does not certify it, and does not
  inhabit the persona from the doer session.

QA does not certify 5 by passing a CLI. A form check can prove the review was
conducted as QA-inhabiting-the-audience; it never proves the page is
exceptional.

---

## Operating wave

1. **Strategist** — direction and Audience records, until citable. Strategist
   supplies the persona source and does not inhabit it (they authored the
   positioning being expressed).
2. **Designer and Writer together** — tokens→atoms→blocks in parallel with
   copy. Prove 3 with the gates above. Do not start if Strategist still has
   no citable direction.
3. **Independent QA keep** — separate session, inhabit the named Audience,
   one comprehensive verdict. Doers do not attend as the judge.
4. **Publisher last** — seal only after a keep. Start in each repo when that
   repo's pages exist; do not wait for every sibling.

---

## Who does what (models)

| Role | Responsibility |
|------|----------------|
| Mid-tier | Execute **3**. Execute **4** only from an already-authored type/media brief. Never inhabit the keep. |
| Top-tier (Opus/Sol) | Author the type record and media brief. Run QA inhabit for **4→5** in a session that is not the doer. |
| Frontier (Astra/Fable) | Optional **5** keep when the sponsor asks, still as QA, still not the doer. |
| Never | Stop at **3** and call it world class or done. Let the doer or the sealer write the keep. |

---

## Package roles (mechanical vs authored)

- **Strategist** — Audience records the QA inhabit cites. Not the judge.
- **Designer** — tokens, `Hero`, `Button`, fold measurement schema, `designer-hero-css-check`, `designer-fold-check`. Doer.
- **Writer** — copy slots, live trees, `fold-wallpaper` on wallpaper fold phrases. Doer.
- **Publisher** — `MarketingView` mount; `heroActions` carries the single primary CTA; `heroMedia` is product surface or original art. Sealer, not the keep.
- **Inspector** — pre-landing *rules*. Not audience fitness.
- **Observer** — independent outcomes after land. Not the keep.
- **QA** — independent fitness keep. Package not yet in this tree; the job is still this seat.
