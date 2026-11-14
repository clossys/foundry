# reissue

Bring one candidate up to the slot rules as the slot's next version, through the verb, never by editing or renaming files by hand.

- Run `clossys reissue <agent>/<slot> <candidate> --by agent:<seat>`. The verb is deterministic: it decides nothing about content, so the seat only chooses which candidate to reissue.
- The next version is named for the slot's leaf (`components.button` gives `button-v<n>`).
- A JSON candidate's `dependencies` become exact `<name>@<x.y.z>` from the root package-lock.json; a name the lock does not hold refuses.
- Its `registryDependencies` move to slot.json `uses` as slot ids of the same agent and are emptied; a name that is no slot of the agent refuses.
- Preview props are dropped: the fixture belongs to slot.json `contract.fixture`.
- Line anchors left after the citations codemod (`<slot>@<n>#L<line>`, `{"ref": "<slot>@<n>", "line": <n>}`) move to slot ids.
- The submit records rung adopt (the Designer's L1 or L2) with seed `<slot>/<old>@<sha256>`.
- The old file is retired with a clossys.retire/1 record: `superseded`, or `edited-in-place` when its bytes are not the ones the ledger recorded.
- A pinned old file is repinned with the same basis and decidedBy, and the pin event carries `reissue: true`, so owner approvals carry over.
- The reissue guard runs every constitution check whose rules.json guard lists reissue on what the write leaves. Any finding refuses and undoes the whole write; fix the cause upstream, never by hand.
- `clossys check --slots` must pass afterwards.
