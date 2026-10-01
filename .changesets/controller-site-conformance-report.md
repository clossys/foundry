---
controller: minor
---

New `site-conformance-check <repoRoot> [--site <dir>]` bin: a report-mode scan of a site's `app` directory for routes that do not render a Publisher view, template routes outside the web route manifest, and raw colour literals, with a single waiver file. It exits 0 whenever it ran and 2 when it could not (#1515).
