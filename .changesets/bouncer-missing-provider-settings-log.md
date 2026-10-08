---
bouncer: minor
---

`createClerkSignInPage` now writes one server log line, the first time a setting is found missing, that names the missing Clerk settings (`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`) without printing a value.
