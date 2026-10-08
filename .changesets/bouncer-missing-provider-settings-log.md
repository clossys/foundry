---
bouncer: minor
---

`createClerkSignInPage` now writes one server log line, the first time its page renders, that names any missing Clerk setting (`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`) without printing a value.
