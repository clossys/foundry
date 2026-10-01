---
launcher: minor
---

`readHubAuthority()` refuses a hub whose head is not its branch's upstream (`hub-not-upstream`) and returns the `head` commit it read the plan from, and `decideSetBinding()` reads the assessment at that commit (`hub-head-moved` when the head has moved) and refuses an authorization whose permitted packages differ from the plan's packages (`packages-not-exact`) (#1628).
