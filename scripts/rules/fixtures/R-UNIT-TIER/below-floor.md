# FIX-TIER: add a refusal to the scanner

The violation: this packet is gate class (it adds pass/fail logic), so its floor is high, but it says low.

## Repository and base
- Repository: clossys/foundry. Branch: `claude/fix-tier`.
- Gate: YES.
- Tier: low
- Env: cloud.

## Objective
- Make the scanner refuse a credential-shaped string in `scripts/check-public-safety.mjs`.

## Validation
- "refuses a credential-shaped string" fails before the change.
