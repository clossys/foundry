---
keeper: patch
---

The held-record hook now ignores a correction or erasure reply from a replaced client or for an earlier subject, and keeps the error when a correction or erasure that a child calls from its own `useEffect` throws synchronously.
