---
bouncer: minor
---

Export `createClerkSignInHandlers` from the Clerk web client and web subpaths to connect password verification, second-factor verification and message-code resend to Publisher's `SignInForm`. The handlers serialize operations per shared owner, stop stale flows before session activation and return classified failure statuses. A rejection while sending a message code answers `unavailable`, never `credential`. `CLERK_SIGN_IN_FAILURE_CODES` gains two codes: `form_param_format_invalid` reads as `credential` and `invitation_account_not_exists` reads as `notFound`.
