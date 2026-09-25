---
launcher: minor
---

`validateApplyBundle()` accepts a `planned` bundle, in which a repository that passed all nine pre-apply checks and is bound by an approval carries `state: "planned"` and its `binding`, and refuses a state or binding in a report bundle, a state without all nine checks satisfied, a binding without a satisfied V3 check, an `admitted` binding on anything but an apply set or naming the bundle's own digest, two different approvals in one bundle, and a binding in a bundle whose plan has package acts (its `snapshot` is not null) but that carries no authorization. `planApplyBundle()` still writes report bundles only (#1178).
