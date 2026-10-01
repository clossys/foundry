---
publisher: patch
---

`publisher-seal` and `sealWebsite` now refuse a production URL that is not already in its canonical form, so a spelling that parsers read differently (a backslash before userinfo, an empty userinfo, a control character, an upper-case scheme or host) can no longer be written to the ledger or the manifest. A production URL without a path (`https://host`), with an explicit default port, or in any other non-canonical spelling is now refused, and an interrupted seal whose ledger already holds such a URL must be repaired by hand.
