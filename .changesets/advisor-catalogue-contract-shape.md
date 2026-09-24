---
advisor: minor
---

The capability catalogue now reads `needs`, `solves`, `feeds` and `fit` in
exactly the shape the package-framework contract defines. A `solves` entry
carries `statement` and an optional `capability`, and its `evidence` may be
`designed`, `qualified` or `proven`. A `needs` edge carries the declared
`producerRole` (a scoped package name). Each role exposes its own
`declaredFeeds` verbatim and in declared order, and its declared
`capabilities` (id, inputs, outputs). `feeds` now lists only the producer's
side of met needs. `fit` lists the signal ids from the declared fit-signal
file. New exported types: `CapabilityInput`, `DeclaredCapability` and
`DeclaredFeed`.

A declared need now counts as met only when its producer declares a
`feeds` entry for that artifact, which is the framework gate's rule.
`needIsMet` is exported. An unmet need is reported in `unsatisfiedNeeds`,
and its producer is still pulled in.

`composeKit` now judges needs cycles per capability, following the
contract's cycle decision. It also exports `judgeNeedsCycles`. A cycle among
capabilities is a deadlock and stays `indeterminate`. A role-level loop with
no capability cycle behind it, such as the Customer/Publisher keep loop,
now composes, and its `roleCycles` field lists the loop. A cycle only
visible through a role with no capability map now composes too, and
`unjudgedCycle` names it. Before this change, that last case was
`indeterminate`. `composeKitFromProblems` passes both fields through. So
does `recommendKit`: a `KitVerdict` now has `roleCycles` and
`unjudgedCycle`, and the skill tells the client about an unjudged cycle.
A verdict's citation `statement` is now the role's own `solves` statement.

Minor, not patch: `CapabilitySolves.statement` and
`RoleCapability.declaredFeeds` are new required fields, `ComposeKitResult`
and `KitVerdict` gain fields, one input that used to be `indeterminate` now
composes, and a declared need its producer does not feed is now unmet.
