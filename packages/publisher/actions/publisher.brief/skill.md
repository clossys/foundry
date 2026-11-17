# publisher.brief

Refine a Publisher slot's brief in a loop (the refine-brief step): decide whether the trigger is a rule for the whole slot or about one record.

- Read the resolved brief first: `clossys brief publisher/<slot> --json` (the package base plus its tighten list), the slot contract and the pinned frames, sections and copy the page assembles.
- Most triggers are about one record; then tighten nothing and let the next step make a new candidate.
- Tighten only for a rule every future candidate of this slot must meet, and only stricter than the base; a looser entry is refused (brief.tighten-only).
- One entry per rule; never edit or drop an existing tighten entry (the list is append only).
- Record it with `clossys brief publisher/<slot> --tighten --path <path> --op <max|min|require|add|remove|narrow> --value <json> --why <the trigger, in one line> --by owner:<ref>|planner:<ref>`; `clossys check` must pass.
