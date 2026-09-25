---
advisor: minor
---

New `advisor-repository-card <repositories-file> [--current <owner/name>] [--choose <id>,...]` command, for an agent with no hub yet: it prints the repository-choice card, or the checked choice, as JSON. The file is one JSON array of entries or JSON Lines, one entry per line, read with the strict reader; a bad line is named by number and position. It exits `0` for a card or an accepted choice, `1` when the list is empty or the choice is refused, and `2` for unreadable or invalid input (#1179).
