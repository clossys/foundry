---
publisher: minor
---

Adds `./web/consent` (the client-only `ConsentExperience` notice assembly, `bindTransport`, `useAnalyticsAllowed` and `useConsentStatus`), `./web/consent/preview` (a fixed-clock `createConsentPreview` resolved under the `development` condition) and `./consent-copy` (server-only `resolveConsentCopy`), each of which throws at import under the condition it refuses.
