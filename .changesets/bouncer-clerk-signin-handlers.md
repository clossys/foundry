---
bouncer: minor
---

Export `createClerkSignInHandlers` from the Clerk web client and web subpaths to connect password verification, second-factor verification and message-code resend to Publisher's `SignInForm`. The handlers serialize operations per shared owner, stop stale flows before session activation and return classified failure statuses.
