---
bouncer: minor
---

Add an opt-in `@clossys/bouncer/gate` export whose `createGatedHostGate` answers signed-out, unauthorized and provider-unavailable requests for a gated host with a 307 to sign-in, a 401 with RFC 9728 `WWW-Authenticate`, a 403 not-authorized route, or a fail-closed sign-in redirect, and marks every response `X-Robots-Tag: noindex, nofollow`.
