# writer.scope

Judge the Writer tree's scope (loop.scope, the decide step): every need the Writer has is a placed slot or a filed slot entry, and the tree is split by its own rules.

- Read the demand first: `clossys request --scan --dry` lists every slot edge that names no slot; `clossys request --list --open` lists the entries already filed.
- File a need the scan cannot see (a page input or an owner ask with no slot yet) with `clossys request --target <agent>/<slot id> --from writer/<slot>|owner --why <one line>`; never place a leaf here.
- Read `clossys conform --agent writer` for the scope rows: an L1 with one L2 or an L2 with one or zero live L3 is listed as a suspicious split, not an error. Keep a split whose rule yields one part; report the rest with the exact leaf ids.
- Never move, merge or rename leaves to make a count come out; a regroup goes through its own request and the owner's sign.
