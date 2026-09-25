---
advisor: minor
---

`advisor-render-status` refuses a plan file that is not valid UTF-8 or that repeats an object key at any depth, naming the key; a JSON syntax error is reported by position only, without quoting the file (#1475).
