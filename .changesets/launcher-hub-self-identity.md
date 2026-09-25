---
launcher: patch
---

The hub leaves itself out of its own sibling roster by repository identity -- its origin's `owner/name`, or the repository its marker records when it has no github.com origin -- instead of by folder path. An inventory naming the hub in another letter case, such as `<owner>/Example-Hub` for a hub in `example-hub`, no longer composes the hub a second time as its own sibling on a case-insensitive file system, and no longer reports it as a missing clone on a case-sensitive one (#1179).
