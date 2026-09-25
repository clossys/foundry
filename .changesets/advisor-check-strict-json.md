---
advisor: minor
---

`advisor-check` and `advisor-execution-readiness` read the assessment file as strict JSON, refusing invalid UTF-8, a leading byte order mark, a repeated key or a syntax error by position only, never quoting the file (#1178).
