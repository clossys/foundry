---
launcher: minor
---

`launcher-apply-plan` refuses a plan or brief file that is not valid UTF-8 or that repeats an object key at any depth, and exits 2 naming the key; a JSON syntax error is reported by position only, without quoting the file (#1475).
