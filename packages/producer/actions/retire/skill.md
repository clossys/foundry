# retire

Retire what a slot no longer needs, through the verb, never by moving files by hand.

- A candidate: `clossys retire <agent>/<slot> <candidate> --by agent:<owner-seat>|owner:queue.<kind>#<id> --reason <code>[: <note>]` moves it from candidates/ into the slot's retired/ beside its clossys.retire/1 record. The owner's entry must be about this slot and answered with its option `retire`, and that option must name this candidate (for `--slot`, no candidate); any other answer is refused. An owner's retire answer is used once: one that a retire record or retire ledger event already cites is refused (DRAFT). The pinned candidate is refused: repin first.
- A whole slot: `clossys retire <agent>/<slot> --slot ...` takes it out of ia.json (recorded in its `retired` list) and moves its folder to `agents/<agent>/_retired/<slot>`.
- The reason starts with a closed code: uncertified, superseded, edited-in-place, not-needed, duplicate or shared-split.
- `clossys check --slots` must pass after the retire; constitution R10 reads the record.
