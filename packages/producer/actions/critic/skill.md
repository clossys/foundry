# critic

Score a P2 craft run's renders as a fresh critic who never saw the maker's work, and record the scores through the verb.

- Start from the packet `clossys critique-packet <agent>/<slot> --standard <id> --render <path>...` lists, and only from it: the standard's taste.md, at most 3 exemplars, the slot contract and the renders, labelled A, B, ... in a shuffled order.
- Never open a recipe, the directions, the brief, the slot ledger or any file of the maker; the packet refuses them and the record may not cite them (R16.2).
- Score every taste criterion of taste.md 1-5 against its anchors for the candidate the run will submit. Compare against each exemplar in one sentence. Taste never decides pass or fail: requirements do.
- Write `critique.json` (schema `clossys.critique/1`: slot, candidate, standard, scores, packet manifest as listed).
- Run `clossys critique <agent>/<slot> --record critique.json --model <id> --tier <tier> --candidate <name>`, then `clossys next <agent>/<slot> --stage critique` records the stage in order.
- A Producer seat slot (`producer/seat.<step>`) is critiqued the same way.
