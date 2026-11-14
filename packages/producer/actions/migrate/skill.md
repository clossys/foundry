# migrate

Deterministic slot-record codemods, run through the verb, never by editing records by hand.

- `clossys migrate copy-keys|inputs [--check]`: rename copy ids to the catalog's ids; declare slot inputs from the read graph.
- `clossys migrate citations-to-slots [--apply]`: rewrite versioned citations to slot ids; each rewritten file is recorded in clossys/evidence/migrations.json and the slot ledger's `migrate` event.
- `clossys migrate ledger [--check]`: backfill every slot and agent `ledger.json` from git history for records written before the ledger existed. Events name the commit (`backfill`), never a fabricated author; an edit no recorded migration explains gets no event and stays a constitution row.
- Every migrate event records verb `migrate`, this skill, model none and tier none.
- `clossys check --slots` must pass after a migration.
