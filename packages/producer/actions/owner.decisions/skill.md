# owner.decisions

Decide which owner words an owner-gated verb may cite with `--owner-ref`.

- One decision per ledger comment that holds the owner's words; its comment id is the decision id.
- Record the ledger ref, the date of the words, what they authorize (scope) and their words or a one-line summary; never a paraphrase that adds a claim.
- A registered decision is never rewritten; new words are a new ledger comment and a new decision.
- The file is `clossys/owner-decisions.json`, started empty by `clossys owner-decision init` and appended only by `clossys owner-decision add`; check:pipeline validates it.
