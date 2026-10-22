---
publisher: minor
---

`SiteFrame` now resolves the name and toggle label of the menu it supplies for header actions without `shell.nav` through the consumer's `resolveCopy`, from the copy references `site-frame.nav.label` and `site-frame.nav.trigger-label` published in `SITE_FRAME_CONTRACT.defaults`, and throws when either reference does not resolve. `SITE_FRAME_CONTRACT.revision` is now 2, because revision 1 published those defaults as strings.
