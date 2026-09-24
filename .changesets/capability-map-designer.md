---
designer: minor
---

The `foundry` manifest block now declares `capabilities` (manifest schema
version 3, #1196), a capability map of this role's craft with nine
capabilities. Five are `built`, each naming its own release-qualification
case as `proofCase` (#1272): the token contract and brand-overlay binding
(`brand-binding-clean`), token purity (`token-purity-clean`), contrast
(`contrast-clean`), the type record (`type-record-clean`), and structure and
fold conformance (`fold-clean`, also backed by the surface-ladder and
hero-CSS cases). Components and blocks is `partial` and cites
`surface-ladder-clean`: a route composed only from Designer atoms and
blocks passes, and a route that imports a second library's `atoms`,
`tokens`, or `theme` entrypoint beside Designer fails
(`surface:dual-primitive-stack`), but a second library imported any other
way (a package root, `/components`, or an unscoped path), a bespoke
element, or a surface that uses no Designer component at all is not caught
yet. Accessibility beyond contrast, brand-kit assembly, and logo and
identity files (#1210) are `planned`, with no proof case. For logo and
identity files, `generateIdentityDirections`, `adoptSuppliedMark`, and
`judgeIdentityKit` (from `@clossys/designer/tokens`) already generate and
check a variant set, but no command wires them to a checked output a
qualification case could run.
