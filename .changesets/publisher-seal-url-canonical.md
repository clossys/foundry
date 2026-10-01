---
publisher: patch
---

`publisher-seal` and `sealWebsite` now refuse a production URL that is not already in its canonical form or whose host is not plain letters, digits, hyphens and dots (or an IP literal); this covers spellings that parsers read differently, such as a backslash before userinfo, an empty userinfo, a control character or an upper-case scheme or host. A production URL without a path (`https://host`), with an explicit default port, or in any other non-canonical spelling is now refused, and an interrupted seal whose ledger already holds such a URL must be repaired by hand.
