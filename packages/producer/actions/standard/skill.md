# standard

Say what every candidate of a slot kind must satisfy, independently of whoever crafts it, through the verb, never by editing standard files by hand.

- Run `clossys standard <agent>/<id> --by owner|planner` with the parts that change: `--requirements`, `--taste`, `--exemplars`, `--exemplar-file`.
- Every mechanical requirement names a criterion registered under `src/constitution/criteria/`; taste stays in taste.md as 1-5 anchors.
- Keep 5-12 exemplars, each with its source, license and why it is exemplary.
- Only Designer standards list seeds; a craft standard has none.
- A standard and a recipe never change in one commit (R16.3).
- Name the standard on each slot with `clossys ia <agent>/<slot> --standard <id>`; `clossys check` must pass.
