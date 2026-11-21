# director.brief

Refine a Director slot's brief in a loop (the refine-brief step): decide whether the trigger is a rule for the whole slot or about one record.

- Read the resolved brief first: `clossys brief director/<slot> --json` (the package base plus its tighten list), the slot contract and the owner's evidence it cites.
- Code settles this step before you for a trigger that names one record and no rule (the triage step: T1, T2, T4, T6, T7, T8), so it reaches you only for a slot-wide trigger (T3 tighten-brief, T5 owner-feedback). Even then most owner words are about one record; then tighten nothing and let the next step make a new candidate.
- Tighten only for a rule every future candidate of this slot must meet, and only stricter than the base; a looser entry is refused (brief.tighten-only).
- One entry per rule; never edit or drop an existing tighten entry (the list is append only).
- Record it with `clossys brief director/<slot> --tighten --path <path> --op <max|min|require|add|remove|narrow> --value <json> --why <the trigger, in one line> --by owner:<ref>|planner:<ref>`; `clossys check` must pass.
