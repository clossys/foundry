---
strategist: minor
---

A strategy directory can now hold `strategy-brief.json`, a record of claims the strategy will not make, and `strategist-check wont-claim <strategy-dir> <scan-dir>` exits 1 when a scanned surface uses one of an entry's literal match phrases, with `readStrategyBrief`, `validateStrategyBrief` and `checkWontClaimDrift` exported for callers.
