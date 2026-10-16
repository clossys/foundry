---
observer: minor
---

Add opt-in feature flags to the PostHog provider adapter: a declared flag resolves to a validated variant only while analytics capture and a separate experiments permission are both granted, and returns its control otherwise.
