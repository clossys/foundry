---
designer: minor
---

Callers can pass `onSubmitError` to `Form` to receive the error when the promise returned by a validated `onSubmit` rejects, and `Form` now catches that rejection instead of leaving an unhandled promise rejection while the pending state clears.
