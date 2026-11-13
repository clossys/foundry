---
slot: "capability.sourcing.build"
source: {"kind": "derived", "ref": ["finding:foundry-public-repo-facts", "context.competition.gap@6", "context.competition.alternative@5"]}
feeds: []
functions: ["tech"]
note: "Agent pick for the Foundry open-source project Director (DIR-FIX, 2026-11-11): adapted from v5 after the critic's reading; sourced package count, the alternative given up, and a countable Watch."
---

## Direction
- Build: the agents' contracts and gates, the slot model and its check, and the clossys CLI.
- Why: no common open tool links a brief to the design, copy and pages built from it, so this layer is built rather than bought.
- Cost: sustained maintenance of five packages (Director, Designer, Writer, Publisher and Producer) and their gates, and slower starts than an unguided generator.
- Built in the open, rather than adopting an AI site builder or agent framework and wiring the checks by hand.

## Because
- The five packages, their gates, the CLI and the slot model are in the public tree (finding:foundry-public-repo-facts)
- No common open tool links a brief to the design system, copy and pages, each citing its pinned source (context.competition.gap@6)
- The alternatives are a prompt per task, or a site builder or framework with the checks wired by hand (context.competition.alternative@5)

## Watch
- If built pieces found at release review that duplicate an open package the repository already depends on > 0, then adopt that package and drop the built piece.
