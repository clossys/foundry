---
publisher: minor
---

`createContactHandler` accepts optional `limiterTimeoutMs` and `deliveryTimeoutMs`, which resolve `unavailable` with the new reasons `limiter-timeout` and `delivery-timeout` when a port call does not settle in time, and it refuses a lone UTF-16 surrogate in `name` or `message` as `malformed`.
