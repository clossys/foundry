---
bouncer: minor
---

Add the `./providers/clerk/web/sign-in-handlers` subpath with `createClerkSignInHandlers`, which connects password verification, second-factor verification and message-code resend to Publisher's `SignInForm` and needs no optional peer. The handlers serialize operations per shared owner, stop stale flows before session activation, prefer `totp`, then `phone_code`, `email_code` and `backup_code`, and move to the code step with resend available when a code could not be sent because of a rate limit or network failure. A code-send rejection read as `credential` or `notFound` answers `unavailable`. `CLERK_SIGN_IN_FAILURE_CODES` gains `form_param_format_invalid` (`credential`) and `invitation_account_not_exists` (`notFound`).
