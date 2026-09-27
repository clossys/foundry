---
launcher: minor
---

planApplyBundle() reads each repository's installed-state ledger, trusts rows against hub-held change sets and plan package acts (including deferred identities), refuses apply whole-file adds without a ledger row, and compare-and-swaps owned paths and keys.
