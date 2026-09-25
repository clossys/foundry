---
advisor: minor
---

The Advisor skill resolves a plan's exact packages with `advisor-package-request`, a registry snapshot and `advisor-resolve-packages`, copies the printed `packages` and `resolution` into the plan unchanged, stops without writing them when no snapshot step is available, and binds the sponsor's grant to exactly the printed `permittedPackages` (#1178).
