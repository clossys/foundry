---
bouncer: minor
---

`createGatedHostGate`, `createReturnUrlResolver` and the Clerk `createSignOutRoute` accept an opt-in `hardened: true` with stricter navigation, return-URL and sign-out rules, `./gate` adds the framework-neutral `createSignOutHandler`, and `SignOutRouteOptions` is now the union `LegacySignOutRouteOptions | HardenedSignOutRouteOptions`, so an interface that extended it should extend `LegacySignOutRouteOptions` instead.
