# designer.brief

Refine a Designer slot's brief in a loop (the refine-brief step): decide whether the trigger is a rule for the whole slot or about one record.

- Read the resolved brief first: `clossys brief designer/<slot> --json` (the package base plus its tighten list), the slot contract and the pinned Director brief.
- Most triggers are about one record; then tighten nothing and let the next step make a new candidate.
- Tighten only for a rule every future candidate of this slot must meet, and only stricter than the base; a looser entry is refused (brief.tighten-only).
- One entry per rule; never edit or drop an existing tighten entry (the list is append only).
- Record it with `clossys brief designer/<slot> --tighten --path <path> --op <max|min|require|add|remove|narrow> --value <json> --why <the trigger, in one line> --by owner:<ref>|planner:<ref>`; `clossys check` must pass.
