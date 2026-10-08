---
publisher: minor
---

A chrome-free view's content root, including `ErrorView`'s, now refuses a landmark `role` and the frame's main id because the page frame owns them, while `GlobalErrorDocument`, which has no frame and no `<main>`, accepts a landmark `role` on its content root.
