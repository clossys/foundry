---
bouncer: minor
---

Callers verifying a Clerk webhook now get a signing-secret guard that refuses a missing, prefix-only, malformed or short key before any header is read, a distinct `payload-invalid` code for a signed body that is not a JSON event object, and errors that never carry key material or body text.
