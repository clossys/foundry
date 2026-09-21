# Pre-auth page quality

This document is the standing contract for pre-auth marketing pages built with
Designer, Writer, and Publisher. **Done is exceptional (5).** Mechanical gates
can prove **good (3)** only; they never certify great, exceptional, or
world-class. A walk that stops at 3 and reports done is a defect.

Ratings are ordinal: **3 good** (floor, gated), **4 great** (authored, not
gated), **5 exceptional** (the keep — a synthetic user, after 3 is green).

World class is judged **as the intended person**, not as a visual score, not
as a copy score, and not as a contractor with a checklist. The person who
made the page does not grade it. A hired reviewer ticking fold/type/voice
boxes is the same failure in a different hat.

---

## The keep is a user, not a specialist

Foundry's other voices are hired roles (Designer, Writer, Publisher,
Inspector). The keep is not a twenty-first contractor. It is a **synthetic
user**: a first-person inhabit of the named Strategist Audience, with a
fresh look, as if they just landed.

| | Contractor / QA / specialist | Synthetic user |
|--|------------------------------|----------------|
| Stance | "I reviewed the page against the brief." | "I am this person. I just arrived." |
| Evidence | Checklist, scores, findings against rules. | What happened to *me* in the first seconds, whether this is for me, whether I believe, whether I stay. |
| After a no | Negotiate the rubric. | I would not keep this. The doer fixes; they do not talk me out of it. |

The inhabit runs in a **separate session** from Designer, Writer, Publisher,
Strategist, and Inspector. Independence is the session. The voice is the
user. Both are required.

Forbidden voices on a keep: designer, writer, publisher, strategist,
inspector, builder, QA, reviewer, auditor, critic-with-a-rubric.

---

## Doer vs user vs sealer

These three seats must not be the same agent. If they are, the feedback gets
negotiated and 3 is reported as 5.

| Seat | Who | Allowed | Forbidden |
|------|-----|---------|-----------|
| **Doer** | Designer and Writer (together); Strategist for direction | Make the page. Fix what the user named. | Inhabit the user. Write the keep. Call 3 done. Split a self-review into a visual half and a verbal half. |
| **User** | Synthetic inhabit of the named Audience, separate session | Speak in the first person as that person. One comprehensive keep/fail. | Edit the page. Become a reviewer. Score against Designer or Writer gates. Let the doer rewrite a no. |
| **Sealer** | Publisher | Seal after a user keep. Prove the shipped bytes. | Inhabit the user. Treat "the surface rendered" as a keep. Seal a fail. |
| **Rules judge** | Inspector | Judge whether the *change* satisfies declared rules. | Inhabit the user. Fitness for a person is not a rule scan. |
| **Outcome measurer** | Observer | Measure what actually happened after land. | Judge the candidate. Act for another role. |

Designer reflecting on type and Writer reflecting on copy would split the
person's one impression. That is not a keep.

Publisher running the keep because it is last before seal would make the
sealer the judge. Publisher already mounts `MarketingView` — it is a doer of
the page.

Inspector running the keep would mix two jobs: "does this change satisfy
every applicable rule?" is not "would I stay?"

A **QA package** is the wrong cut. That would hire another specialist to
grade specialists. The keep is the user.

---

## Star scale

| Stars | Name | Meaning |
|------:|------|---------|
| 3 | good | Mechanical floor. The walk that proves gates must not stop here and call done. Gates can prove 3. |
| 4 | great | Authored brief executed: type pairing, domain-specific fold copy, honest media. An independent session authors the brief; the making walk executes it. Still not a keep. |
| 5 | exceptional | The keep. A synthetic user, first person, fresh look, comprehensive. The fold *is* the artifact. Swap the wordmark and it still could only be this product. Gates never certify 5. |

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

These gates are the floor. They are not the synthetic user's script.

---

## 4 great (authored, not gated)

Everything in **3**, plus:

- A **named type record executed** — display face, H1 minimum size, measure cap, monospace only for eyebrows/data; cite or author `templates/brand-type.template.json` and run `designer-type-check` (not invented ad hoc during the walk that proves 3).
- **Fold copy contains a domain noun** a competitor cannot reuse — aligned with Strategist do-not language and Writer slot discipline.
- **Fold media is the thing** — the product surface with real data, or original art of the artifact being made, at a scale that *is* the page, not a card-in-a-slot screenshot.
- **One visual device** that is not a generic dark/light SaaS band.

4 is still the doer's work. It is not a keep.

---

## 5 exceptional (synthetic user keep)

Everything in **4**, plus a keep spoken **as** the named Strategist Audience,
not about them:

- **First person, fresh look.** "I am [Audience.name]. I just landed. I came
  here because [a pain they actually have]." Not "as a reviewer, the hero
  meets the type scale." The inhabit has not read the doer's brief, the
  token file, or this document's 3-star bullets as a script.
- **One person, one verdict.** What I saw, what I understood, whether this
  is for me — together. Not a Designer reflection plus a Writer reflection.
- **`inhabitedAs` is `target-audience`.** Never a hired role.
- **The questions are mine, not a rubric:** what happened in the first
  seconds; is this for me; do I believe it; would I stay; would I tell a
  peer. A keep means I would. A no means I would not. The doer then fixes;
  they do not argue the checklist.
- **The first viewport is the artifact**, not an advertisement holding a
  picture of one.
- **Swap-the-wordmark test:** I could not think this was a different
  product's page with the name swapped.
- **Something here is ours** — a device, rhythm, or object a template
  cannot slot-fill. I would remember it.
- **Synthetic user inhabit** after mechanical gates are green, in an
  independent session that is not the doer's. The making walk does not invent
  this level or speak as the user.

No CLI certifies 5. A form can prove the keep was written as the user; it
never proves the page is exceptional. A specialist's scorecard, even a
green one, is not a keep.

---

## Operating wave

1. **Strategist** — direction and Audience records, until citable. Strategist
   supplies who the user is and does not inhabit them (they authored the
   positioning being expressed).
2. **Designer and Writer together** — tokens→atoms→blocks in parallel with
   copy. Prove 3 with the gates above. Do not start if Strategist still has
   no citable direction.
3. **Synthetic user keep** — separate session, first person as the named
   Audience, fresh look. Doers do not attend as the user.
4. **Publisher last** — seal only after a keep. Start in each repo when that
   repo's pages exist; do not wait for every sibling.

---

## Who does what

| Seat | Responsibility |
|------|----------------|
| Making walk | Execute **3**. Execute **4** only from an already-authored type/media brief. Never inhabit the user. Do not invent the type pairing during this walk. |
| Independent session | Author the type record and media brief. Inhabit the user for **5** after gates are green, in a session that is not the doer. |
| Never | Stop at **3** and call it world class or done. Let the doer, the sealer, or a QA contractor write the keep. |

---

## Package roles (mechanical vs authored)

- **Strategist** — Audience records that name who the user is. Not the user.
- **Designer** — tokens, `Hero`, `Button`, fold measurement schema, `designer-hero-css-check`, `designer-fold-check`. Doer.
- **Writer** — copy slots, live trees, `fold-wallpaper` on wallpaper fold phrases. Doer.
- **Publisher** — `MarketingView` mount; `heroActions` carries the single primary CTA; `heroMedia` is product surface or original art. Sealer, not the user.
- **Inspector** — pre-landing *rules*. Not a person landing on the page.
- **Observer** — independent outcomes after land. Not the keep.

There is no QA package in this wave. The keep is a synthetic user, not a
hired specialist.
