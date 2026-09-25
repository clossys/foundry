---
advisor: minor
---

`packageRequest()` and `resolvePackages()` refuse a staffed role whose package lives in the engagement hub only, with rule `hub-only-package` and the role's position, so no plan installs such a package in a product repository. `HUB_ONLY_PACKAGE_DIRECTORIES` lists these roles; today it is Advisor alone (#1178).
