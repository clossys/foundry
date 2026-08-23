# Role loops

The fourteen role packages in Programs A, B, and C use one loop grammar and
different control shapes. The versioned declaration is
[`contracts/role-loop-archetypes.json`](contracts/role-loop-archetypes.json);
`npm run check:role-loop-archetypes` keeps it complete and machine-readable.

## Shared grammar

Every role loop has these elements, in order:

1. `subjectOrAddressee`
2. `authoritativeSetpoint`
3. `actualObservation`
4. `ternaryJudgment`
5. `correctionOrHandoff`
6. `independentOutcome`
7. `cadenceAndCloseCondition`

An archetype is not a partial module or permission for open-loop tooling.
Each package remains a full closed-loop system. Its primary archetype defines
the dominant correction cycle; an optional secondary archetype describes an
internal mechanism, not a second or weaker package.

Applicability lives in consumer repositories. Installing a package is not
adoption, and self-produced metrics are not independent grounding. Consumers
supply the concrete subjects, setpoints, observations, and evidence that make
a loop applicable and closeable in their own context.

## Independent grounding

Grounding is measured by someone other than the package author, reading
host-owned outcome records. The metric lives outside the package and must
demonstrably move when a real change occurs; a package's own test or run
history cannot grade itself.

For a conformance gate, `observer` may read catch and escape outcomes. For
reconciliation, interaction, custody, and actuation loops, grounding may use
an externally produced standing count or an observed outcome instead. The
form differs with the control shape, but the no-self-grading rule does not.

## Role mapping

| Program | Role | Primary archetype | Secondary archetype |
| --- | --- | --- | --- |
| A | controller | reconciliation | — |
| A | inspector | conformance-gate | — |
| A | builder | actuation-provisioning | reconciliation |
| A | locksmith | custody-lifecycle | — |
| A | integrator | reconciliation | — |
| A | observer | observation-learning | — |
| B | strategist | conformance-gate | — |
| B | writer | conformance-gate | — |
| B | designer | conformance-gate | — |
| B | publisher | actuation-provisioning | reconciliation |
| C | bouncer | reconciliation | confirmation-interaction |
| C | butler | confirmation-interaction | — |
| C | giver | actuation-provisioning | confirmation-interaction |
| C | keeper | custody-lifecycle | — |

## Archetype phases

| Archetype | Purpose | Ordered phases |
| --- | --- | --- |
| conformance-gate | Judge a candidate against a setpoint and improve that setpoint from outcomes. | load setpoint → observe candidate → judge → block-or-allow → sample outcomes → revise setpoint |
| reconciliation | Reduce the difference between desired and actual state. | declare desired → observe actual → diff → correct-or-handoff → reobserve → close-on-zero-delta |
| actuation-provisioning | Make accepted intent real and close on an observed outcome. | accept intent → validate preconditions → act → confirm actual outcome → compensate-retry-or-handoff → close-on-observed-outcome |
| confirmation-interaction | Handle a request with authorization, read-back, and later reconciliation. | receive actor/subject request → authorize → record intent → act-or-refuse → confirm/read-back → reconcile change-or-withdrawal |
| custody-lifecycle | Account for custody through protection, correction, disposal, and verification. | inventory → justify → protect → disclose-or-correct → dispose → verify-disposal-or-reopen |
| observation-learning | Learn from independent signals and remeasure after adjustment. | declare coverage/question → collect independent signals → normalize → measure → report → adjust-and-remeasure |
