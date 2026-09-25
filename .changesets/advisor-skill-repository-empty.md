---
advisor: minor
---

The `clossys-advisor` skill says, when `gh` succeeded and the list is empty, that GitHub listed no repositories that are not archived for this sign-in -- not that the sign-in truly has none, since the listing command drops archived repositories and leaves out any organization whose SSO the token is not authorized for -- and stops (#1179).
