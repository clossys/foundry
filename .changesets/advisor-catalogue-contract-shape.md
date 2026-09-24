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
`DeclaredFeed`. `CapabilitySolves.statement` and
`RoleCapability.declaredFeeds` are new required fields. A declared need now
counts as met only when its producer declares a `feeds` entry for that
artifact, which is the framework gate's rule, so a declared need its
producer does not feed is now unmet. `needIsMet` is exported. An unmet need
is reported in `unsatisfiedNeeds`, and its producer is still pulled in.
