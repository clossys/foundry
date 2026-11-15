---
clossys:
  schema: clossys.candidate/1
  id: director/identity.naming.name/name-v1.md
  agent: director
  kind: candidate
  status: submitted
  slot: director/identity.naming.name
  briefSha256: 4f950d273a49c142d26ed4d3815d55b1a1637f438e72a5f97003eec158d5d2b3
  createdBy:
    actor: agent
    agent: director
    skill: packages/director/actions/director.candidates/skill.md
    skillSha256: a9d2ad4409db981ec0346f8359f63f0ba70c5075f1b0f1ef20370d23d9cec925
    model: claude-opus-5-5
    tier: high
  createdAt: 2026-11-16T09:24:10Z
  refs:
    - { to: director/focus.category.definition, rel: input }
    - { to: director/identity.brand.essence, rel: input }
  source: { kind: original, ref: [] }
  rationale:
    - purpose: name
      field: Name
      why: Owner-run firms trust a name that sounds like a counting house, not an app.
      sources: [{ to: director/identity.brand.essence, rel: cites }]
    - purpose: spell
      field: Never
      why: Owner tightening; the split forms appeared in three drafts.
      sources: []
---

## Name
Tallyhouse

## Casing
Tallyhouse in all prose, headings and UI. `tallyhouse` only in the domain, email addresses and code.

## Never
TallyHouse, TALLYHOUSE, Tally House, Tally-house

## Meaning
A house where every figure is tallied and checked, so the books are counted, never guessed.

## Pronunciation
TAL-ee-howss

## Because
The category is monthly bookkeeping for small firms (focus.category.definition); the essence is "counted, not guessed".

## Watch
"Tally" is common in invoicing apps; keep "house" in every form.
