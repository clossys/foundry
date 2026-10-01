---
bouncer: minor
---

Add an opt-in `@clossys/bouncer/gate` export. `createGatedHostGate` answers a gated host's requests with a 307 to sign-in for a signed-out navigation, a 401 with an RFC 9728 challenge for any other signed-out request, a 403 not-authorized route for a signed-in principal without permission, and a fail-closed sign-in redirect when the identity provider is unavailable. It builds on the gated-host response helpers and the redirect allowlist, requires a permission check, reads no host or header value into a response, and refuses ambiguous paths and malformed request URLs.
