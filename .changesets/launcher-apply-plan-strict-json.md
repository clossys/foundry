---
launcher: minor
---

`launcher-apply-plan` refuses a plan or brief file that is not valid UTF-8, starts with a byte order mark, or repeats an object key at any depth, and exits 2; a repeated key is reported by its position in its object and, below the top level, that object's character position, never by name, and a JSON syntax error is reported by position only, without quoting the file's text (#1475).
