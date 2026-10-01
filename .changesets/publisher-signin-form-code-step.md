---
publisher: minor
---

`SignInForm` in `@clossys/publisher/web` takes optional `verifyCode`, `resendCode` and `unavailable` props: a `verify` answer of `{ status: "needsCode" }` moves to a one-time code step after the password, and `unavailable` shows the unavailable notice from the first render with submission disabled.
