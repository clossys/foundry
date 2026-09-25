---
advisor: minor
---

The `clossys-advisor` skill checks `gh`'s exit status before using the list; on failure it tells the client the list could not be read and why, and never builds or shows a card from that file (#1179).
