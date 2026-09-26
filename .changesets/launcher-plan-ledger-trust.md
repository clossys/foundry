---
launcher: minor
---

planApplyBundle() now reads each repository's installed-state ledger, trusts its rows only against change sets the hub holds, and updates, keeps or refuses each owned path and key by compare-and-swap.
