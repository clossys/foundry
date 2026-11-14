# verdict

Decide P1 for one slot from its options packet, and record the decision through the verb, never by editing ledger or pin files by hand.

- Read the packet `clossys options <agent>/<slot>` lists: the slot brief, the standard's taste.md, at most 3 exemplars and the renders of the passing set.
- Return `verdict.json` (schema `clossys.verdict/1`, slot named): either `{pick, reason, criteria}` with the taste criterion ids the pick rests on, or `{create: true, reason, gaps}` with every gap no candidate meets.
- A gap id is a taste criterion or a requirement check of the slot's standard, or `brief:<key>` for a key of the slot contract. Under an `adopt-first` standard every gap names a `class`, and at least one class is in the standard's `createGaps`.
- Run `clossys verdict <agent>/<slot> --record verdict.json --model <id> --tier <tier> --by agent:<seat>`. Tier mid by default and for every adopt-first standard; high for craft standards with `craftTier: high`.
- A pick is pinned with basis agent; an owner pin is never replaced (the owner uses `clossys pin`).
- A create opens P2: `clossys next <agent>/<slot> --stage brief` and the craft stages follow, seeded with the gaps.
- A Producer seat slot (`producer/seat.<step>`) takes create only: `clossys seat <step>` writes and pins a seat.
- The verdict guard runs on the write; any finding refuses and undoes it. Fix the cause upstream, never by hand.
