---
publisher: minor
---

Remove the `internalNote` prop from `AuthView`: the page no longer renders a developer-only line, and a host that passed `internalNote` drops the prop and reports a missing sign-in provider setting in its server log instead.
