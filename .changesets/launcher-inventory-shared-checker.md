---
launcher: minor
---

Every inventory document is now checked by the same shared contract checker, packed from `@clossys/advisor`, that checks the plan and the brief, against `docs/contracts/repository-inventory.json` in that checker's schema form. The accepted shape is unchanged. Refusals now name each field at fault by position, for example `repositories[0].role is not a field the contract declares` or `repositories[1].id names the same repository as repositories[0].id`, and no longer quote the refused id (#1179).
