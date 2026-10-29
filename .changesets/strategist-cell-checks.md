---
strategist: minor
---

Add cell quality, coherence and completion checks, confirmation listing validation, and caller-supplied judge verdicts. Reports distinguish script checks from the storyline critic verdict and calculate archetype core readiness. Strategy.status delegates to the same checks engine as strategyStatus(model, { scope }).

Breaking (0.x): the structural read-API StatusReport is renamed StrategyInventoryReport; StatusReport now names the canonical quality, coherence and completion report returned by Strategy.status. Positional strategyStatus scopes remain supported during transition.
