# Pre-auth page quality

This document is the standing contract for pre-auth marketing pages built with
Designer, Writer, and Publisher. **Done is exceptional (5).** Mechanical gates
can prove **good (3)** only; they never certify great, exceptional, or
world-class. A walk that stops at 3 and reports done is a defect.

Ratings are ordinal: **3 good** (floor, gated), **4 great** (authored, not
gated), **5 exceptional** (the keep — review after 3 is green).

---

## Star scale

| Stars | Name | Meaning |
|------:|------|---------|
| 3 | good | Mechanical floor. A mid-tier model must not stop here. Gates can prove 3. |
| 4 | great | Authored brief executed: type pairing, domain-specific fold copy, honest media. Top-tier authors the brief; mid-tier executes. |
| 5 | exceptional | The keep. The fold *is* the artifact. Swap the wordmark and it still could only be this product. Proprietary visual device, not a template with better type. Top-tier or frontier review after 3 is green. |

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

---

## 5 exceptional (review keep)

Everything in **4**, plus:

- The **first viewport is the artifact**, not an advertisement holding a picture of one.
- **Swap-the-wordmark test:** the fold could not sell a different category unchanged.
- **Proprietary motion, rhythm, or device** that a template cannot generate from slots alone.
- An **adversarial top-tier or frontier review** after mechanical gates are green. Mid-tier does not invent this level and does not certify it.

---

## Who does what

| Role | Responsibility |
|------|----------------|
| Mid-tier | Execute **3**. Execute **4** only from an already-authored type/media brief. |
| Top-tier (Opus/Sol) | Author the type record and media brief; review **4→5**. |
| Frontier (Astra/Fable) | Optional **5** keep when the sponsor asks. |
| Never | Stop at **3** and call it world class or done. |

---

## Package roles (mechanical vs authored)

- **Designer** — tokens, `Hero`, `Button`, fold measurement schema, `designer-hero-css-check`, `designer-fold-check`.
- **Writer** — copy slots, live trees, `fold-wallpaper` on wallpaper fold phrases.
- **Publisher** — `MarketingView` mount; `heroActions` carries the single primary CTA; `heroMedia` is product surface or original art, not decorative stock.
