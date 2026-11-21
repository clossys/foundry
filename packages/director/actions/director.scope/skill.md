# director.scope

Judge the Director tree's scope (loop.scope, the decide step): every need the Director has is a placed slot or a filed slot entry, and the tree is split by its own rules.

- Code runs the demand diff before this step (the demand step files a queue.slot entry for every slot edge that names no slot); read `clossys request --list --open` for the entries filed, and file only what the diff cannot see.
- File a need the scan cannot see (a page input or an owner ask with no slot yet) with `clossys request --target <agent>/<slot id> --from director/<slot>|owner --why <one line>`; never place a leaf here.
- Read `clossys conform --agent director` for the scope rows: an L1 with one L2 or an L2 with one or zero live L3 is listed as a suspicious split, not an error. Keep a split whose rule yields one part; report the rest with the exact leaf ids.
- Never move, merge or rename leaves to make a count come out; a regroup goes through its own request and the owner's sign.
