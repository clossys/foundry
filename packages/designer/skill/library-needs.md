# Library needs

<!-- DRAFT copy (foundry-build-0048 U8): needs are Producer queue requests; awaiting owner approval. -->

A missing capability is a request in Producer's queue, never a file of the Designer's own.
Before choosing a candidate, run `clossys request --list --open --agent designer`.
Read its count and parent list before any choose step: "N requests are open; M block these parents."
Triage is the skill's work. The owner approves a new leaf. Until a candidate is selected,
its parent declares the dependency and stays draft. Never hand-roll the missing widget.

Use `designer-library dogfood --root <library> <source-path...>` to derive findings.
The command scans explicit roots and reachable local source, skipping tests and stories.
Registered library primitives form a boundary. This is static evidence: unresolved dynamic
styling is a finding, and a fresh report is not runtime or accessibility clearance.
DF1–DF6 are explained in [check codes](check-codes.md).

Dogfood writes nothing. It links each missing capability to the open request filed for it
(`--consumer <dir>` names the clossys folder; by default the nearest one above `--root`)
and prints the `clossys request` command for one with none. Existing slots produce "bind"
guidance, not new requests. File a request for a slot nothing fills yet with
`clossys request --target designer/<slot> --from <requester slot> --why "<parent> needs <capability>"`;
ask for a new candidate on a filled slot with
`clossys request --kind change --subject designer/<slot> --from <requester slot> --want candidate --why "..."`.
Keep the `--why` dogfood prints: it is how dogfood links the finding to its request.
Producer records, routes and closes requests. Never edit queue entries by hand.

Search candidates only in the trusted registries (`registries` of `references/manifest.json`,
shadcn first). A candidate is a reference adopted or customized, never an item invented from
nothing (provenance rule in [SKILL.md](SKILL.md)). When no trusted reference fits, the request
stays open for the owner with the missing reference named.

Use `--json` on `clossys request --list` or dogfood for machine output. Approval still belongs
to the owner. An open request acknowledges a gap; dogfood continues to exit 1 while findings remain.
Exceptions live in `dogfood-exceptions.json` at the consumer root. Each names the file,
element id, SHA-256 content hash, reason, owner and expiry. Dead exceptions are DF6;
an exception never suppresses hard-coded styling or undeclared reads.
