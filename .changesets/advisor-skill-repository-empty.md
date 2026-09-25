---
advisor: minor
---

The `clossys-advisor` skill says, when `gh` succeeded and the list is empty, that the client's sign-in has no repositories that are not archived -- not that GitHub returned none at all, since the listing command drops archived repositories -- and stops (#1179).
