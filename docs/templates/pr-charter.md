# Pull request charter template

This template carries item 1 of the owner-ratified review-convergence
amendment to the escalation rule. The ratified text, the rest of the
amendment, and what it changes are in
[`docs/HITL-RULE.md`](../HITL-RULE.md#amendment-2026-09-23-review-convergence).
If this template and that file ever disagree, that file governs.

Item 1, verbatim:

> 1. **Charter before round 1.** Required for gate, governance, security or release paths, or over about 300 lines across the stack. It states the goal, adversary, non-goals, what "done" means, the blocking bar and the round budget. Five clauses are always on and can't be removed: harm, authority or permission effects, false claims, rule fidelity, and correctness. Reviewers first review the charter itself; they can add clauses, never remove them, and a charter defect blocks.

The default round budget is 2 (the amendment's item 3). A charter that
asks for more says so under round budget, and that request is approved
with the charter.

Copy the block below into the pull request body before round 1 and fill
in each field.

```markdown
## Charter

- **Goal:**
- **Adversary:**
- **Non-goals:**
- **Done:**
- **Blocking bar:** the five always-on clauses (harm; authority or
  permission effects; false claims; rule fidelity; correctness), plus:
- **Round budget:** 2
```

The five always-on clauses stay in every charter. Reviewers may add
clauses but never remove one (item 1).
