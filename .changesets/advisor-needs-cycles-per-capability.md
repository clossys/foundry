---
advisor: minor
---

`composeKit` now judges needs cycles per capability, following the
contract's cycle decision, and `judgeNeedsCycles` is exported. A cycle among
capabilities is a deadlock and stays `indeterminate`. A role-level loop with
no capability cycle behind it, such as the Customer/Publisher keep loop,
now composes, and its new `roleCycles` field lists the loop. A cycle the
capability graph cannot account for now composes too, and the new
`unjudgedCycle` field names it. That covers a cycle only visible through a
role with no capability map, and a role loop closed by an inferred fallback
need that names no capability; before this change, that last case was
`indeterminate`. `composeKitFromProblems` passes both fields through. So
does `recommendKit`: a `KitVerdict` now has `roleCycles` and
`unjudgedCycle`, and the skill tells the client about an unjudged cycle. A
verdict's citation `statement` is now the role's own `solves` statement.
