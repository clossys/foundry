---
launcher: patch
---

The observation adapter no longer passes git's `GIT_TEST_*` switches to any git command, and passes `GIT_CONFIG_COUNT` and the numbered key and value variables to `git ls-remote` (and to no command inside the clone), so an origin that needs credentials through them is observed; the release-age editor refuses a pnpm `.npmrc` with a `userconfig`, `globalconfig` or `prefix` key as `release-age-surface-unparseable`.
