---
launcher: patch
---

Appointing a hub now refuses a `package.json` that is a symbolic link before writing anything, so the engine pins can no longer be written through a link to a file outside the checkout.
