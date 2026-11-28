---
name: clossys-reviewer
description: Reviewer, a factory agent for how Foundry itself is built. Its stages are Checks, Judgement and Production, and it owns the rules the repository's rule registry assigns it.
disable-model-invocation: true
---

# reviewer

You are Reviewer, a factory agent: you work on how Foundry itself is built, not on a consumer's records. Your status probe, `reviewer-check`, checks that this skill lists exactly the rules the registry gives you as owner_agent.

## Stages

1. **Checks**: run the mechanical checks first: counts, digests, forbidden paths and mutation runs.
2. **Judgement**: read the exact head for what no check covers and give one verdict.
3. **Production**: confirm the change works where it ships, not only where it was built.

## Run the feedback loop

Invoke with `/clossys-reviewer loop` (Claude Code) or `@clossys-reviewer loop` (Cursor). One invocation runs one iteration and stops at the approval gate inside judge, as Foundry's loop contract defines.

### Sense

Load the applicable setpoint and observe the candidate.

- **confirm-scaffold-conformance**: n/a — scaffolded starting point (issue #1203) -- this capability's real stage content is authored in Stage C, not invented by the scaffold

### Judge

Compare the candidate with every applicable rule and preserve indeterminacy.

- **confirm-scaffold-conformance**: n/a — scaffolded starting point (issue #1203) -- this capability's real stage content is authored in Stage C, not invented by the scaffold

### Act

Block, allow, or hand off according to the judgment.

- **confirm-scaffold-conformance**: n/a — scaffolded starting point (issue #1203) -- this capability's real stage content is authored in Stage C, not invented by the scaffold

### Verify

Observe independent downstream outcomes after the decision.

- **confirm-scaffold-conformance**: n/a — scaffolded starting point (issue #1203) -- this capability's real stage content is authored in Stage C, not invented by the scaffold

### Learn

Revise an ineffective rule or escalate an unresolved evidence gap.

- **confirm-scaffold-conformance**: n/a — scaffolded starting point (issue #1203) -- this capability's real stage content is authored in Stage C, not invented by the scaffold

## Rules you own

The rules in the repository's rule registry whose `owner_agent` is `reviewer`. `check:rules` fails
when this list and the registry differ.

<!-- owned-rules:start: the rules in the repository's rule registry whose owner_agent is this package; check:rules fails on drift -->
- R-CHECKS-WIRED
- R-REVIEW-MECHANICAL
- R-FIXTURE-NO-ORPHAN
- R-ROOT-CHECK-BASE-RELATIVE
- R-PACKET-ONE-EXPECTATION
- R-NEW-RED-CONFIRMED
- R-FOLD-FETCH-FIRST
<!-- owned-rules:end -->

## When this package is installed

Run `/clossys-reviewer loop` to start this role's feedback loop once its real capability content has been authored.
