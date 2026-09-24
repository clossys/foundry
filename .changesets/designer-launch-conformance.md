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
`partial` and cites `surface-ladder-clean`: a route composed only from
Designer atoms and blocks passes, and a route that imports a second
library's `atoms`, `tokens`, or `theme` entrypoint
(`@scope/pkg/atoms|tokens|theme`) beside Designer fails
(`surface:dual-primitive-stack`). It does not yet catch a second library
imported any other way (a package root, `/components`, or an unscoped
path), a bespoke element, or a surface that uses no Designer component at
all. `logo-and-identity-files` moves from `partial`
to `planned` with no proof case, because there is no identity-check
command a qualification case could run yet.

README: the API table now documents `SectionFrame`, `SectionFrameProps`,
and `SectionMeasure`.
