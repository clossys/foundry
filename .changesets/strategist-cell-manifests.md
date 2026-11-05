---
strategist: minor
designer: minor
writer: minor
customer: minor
---

Replace the legacy strategy manifest artifacts with the strategy-map and strategy-brief feeds. Route Designer, Writer and Customer needs and capability inputs through compiled strategy briefs; Publisher keeps its strategy-brief input, which resolves to the new briefs index. Declare cell-quality, coherence, completion and wont-claim report paths under the strategy root for CLI persistence.

Breaking (0.x): remove the evidence-base, audience-understanding, market-definition, positioning, claims, brand-derivation, mission-and-values, roadmap, direction-currency, constraints, business-model-and-pricing-hypothesis, north-star-and-metric-tree and competitive-landscape capability declarations. Remove the audience-understanding, positioning, claims, constraints, brand-derivation and direction-currency feeds and replace legacy JSON output declarations with the versioned cell root. No TypeScript exports are removed by this manifest unit.
