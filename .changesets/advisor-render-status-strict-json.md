---
advisor: minor
---

`advisor-render-status` refuses a plan file that is not valid UTF-8, starts with a byte order mark, or repeats an object key at any depth; a repeated key is reported by its position in its object and, below the top level, that object's character position, never by name, and a JSON syntax error is reported by position only, without quoting the file's text (#1475).
