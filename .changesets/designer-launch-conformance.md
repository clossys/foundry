---
designer: minor
---

The `foundry` manifest block now declares `outputs`
(`clossys/designer/brand.css`, the brand bindings, and
`clossys/designer/type-record.json`, the type record), `feeds` (the brand
overlay, fed by the `token-contract-and-brand-overlay-binding`
capability), and `fit`, which names a new shipped
`fit-signal-declarations.json`. That file holds one signal: the repository
ships an interface surface a person sees. `intake`, `status`, `needs`, and
`solves` are not declared yet.

Capability map: `token-contract-and-brand-overlay-binding`, `contrast`,
`type-record`, and `structure-and-fold-conformance` each now cite their own
qualification case (`brand-binding-clean`, `contrast-clean`,
`type-record-clean`, `fold-clean`), not the shared token-purity anchor.
The structure capability is also backed by the `surface-ladder` and
`hero-css` case groups. `components-and-blocks` moves from `built` to
`partial`. The component libraries ship, but no bin checks yet that a
consumer surface is composed only from them.

README: the API table now documents `SectionFrame`, `SectionFrameProps`,
and `SectionMeasure`.
