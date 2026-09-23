---
advisor: minor
---

The capability catalogue now reads `needs`, `solves`, `feeds` and `fit` in
exactly the shape the package-framework contract defines. A `solves` entry
carries `statement` and an optional `capability`, and its `evidence` may be
`designed`, `qualified` or `proven`. A `needs` edge carries the declared
`producerRole` (a scoped package name). A `feeds` edge carries the
producer's declared `path`. `fit` lists the signal ids from the declared
fit-signal file. Each role now also exposes its declared `capabilities`
(id, inputs, outputs). New exported types: `CapabilityInput` and
`DeclaredCapability`.

`composeKit` now judges needs cycles per capability, following the
contract's cycle decision. It also exports `judgeNeedsCycles`. A cycle among
capabilities is a deadlock and stays `indeterminate`. A role-level loop with
no capability cycle behind it, such as the Customer/Publisher keep loop,
now composes, and its `roleCycles` field lists the loop. A cycle only
visible through a role with no capability map now composes too, and
`unjudgedCycle` names it. Before this change, that last case was
`indeterminate`. `composeKitFromProblems` passes both fields through.

Minor, not patch: `CapabilitySolves.statement` is a new required field,
`ComposeKitResult` gains fields, and one input that used to be
`indeterminate` now composes.
