# Library needs

Before choosing a candidate, run `designer-library needs --root <library> --status open,proposed`.
Read its count and parent list before any choose step: "N needs are open; M block these parents."
Triage is the skill's work. The owner approves a new leaf. Until a candidate is selected,
its parent declares the dependency and stays draft. Never hand-roll the missing widget.

Use `designer-library dogfood --root <library> <source-path...>` to derive findings.
The command scans explicit roots and reachable local source, skipping tests and stories.
Registered library primitives form a boundary. This is static evidence: unresolved dynamic
styling is a finding, and a fresh report is not runtime or accessibility clearance.
DF1–DF6 are explained in [check codes](check-codes.md).

Default runs write nothing. They print which missing capabilities would become needs.
Use `--write-needs` only for the consumer-owned root you intend to change. Existing slots
produce "bind" guidance, not new leaf records. Missing capabilities become
`needs/NEED-NNN.json`; the writer deduplicates parent plus missing capability and merges
new evidence. Apply and emit preserve these records. Never edit or delete them by hand.

Search candidates in this order: shadcn's React Aria port, other React Aria skins,
then a Foundry build with benchmark evidence. A proposal records the source, slot and reason:

```sh
designer-library needs set NEED-014 --root <library> --status proposed --candidate '{"library":"shadcn@aria","slotId":"components.search-field","reason":"React Aria candidate fits the contract"}'
```

Use `--json` on needs or dogfood for machine output. Status moves one step at a time:
open → proposed → approved → built → closed. A candidate is required after open;
closing also requires `--closed-by <commit-or-PR>`. Approval still belongs to the owner.
An open need acknowledges a gap; dogfood continues to exit 1 while findings remain.
Exceptions live in `dogfood-exceptions.json` at the consumer root. Each names the file,
element id, SHA-256 content hash, reason, owner and expiry. Dead exceptions are DF6;
an exception never suppresses hard-coded styling or undeclared reads.
