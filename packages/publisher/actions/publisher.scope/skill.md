# publisher.scope

Judge the Publisher tree's scope (loop.scope, the decide step): every need the Publisher has is a placed slot or a filed slot entry, and the tree is split by its own rules.

- Code runs the demand diff before this step (the demand step files a queue.slot entry for every slot edge that names no slot); read `clossys request --list --open` for the entries filed, and file only what the diff cannot see.
- File a need the scan cannot see (a page input or an owner ask with no slot yet) with `clossys request --target <agent>/<slot id> --from publisher/<slot>|owner --why <one line>`; never place a leaf here.
- Read `clossys conform --agent publisher` for the scope rows: an L1 with one L2 or an L2 with one or zero live L3 is listed as a suspicious split, not an error. Keep a split whose rule yields one part; report the rest with the exact leaf ids.
- Never move, merge or rename leaves to make a count come out; a regroup goes through its own request and the owner's sign.

## Plan the content map (CP1-PLAN)

The content set is the agents' decision, not the person running init: the Director's pinned next release
(`director/execution.roadmap.release`) states the Stage, one Scope row per publication (`<kind> (<page>, <page>): <use case>`)
and what is Not in scope; the Publisher plans from it.

- Run `clossys plan`. It proposes one `clossys ia publisher/<slot>` line per page a row asks for, and one for its publication,
  each reading the release (`--inputs execution.roadmap.release`), drawn only from the seatable starters and their page
  archetypes. It files the proposal as one owner request and writes nothing else.
- Never place a page or publication the release does not ask for, and never invent one for a row the menu cannot serve: the
  plan reports such a row as unserved; raise it with the Director (`clossys request --target director/execution.roadmap.release
  --from publisher/<slot> --why <one line>`) or leave it for a later release.
- Once the owner approves the request, run its `ia` lines in order, writing each listed contract to the file its line names.
  `clossys conform --agent publisher` (M1) lists every placed page or publication slot that reads no release; the admin
  publication and pages `clossys init` hard-wires are exempt by that rule.
- A plan refusal (the release is unpinned, does not clear, or its contract states no `brief.release-scope`) goes back to the
  Director: fix and re-pin the release, then plan again.
