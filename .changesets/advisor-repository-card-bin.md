---
advisor: minor
---

New `advisor-repository-card <repositories.json> [--current <owner/name>] [--choose <id>,...]` command, for an agent with no hub yet: it prints the repository-choice card, or the checked choice, as JSON. It reads the file as strict JSON and exits `0` for a card or an accepted choice, `1` for a refused choice, and `2` for unreadable or invalid input (#1179).
