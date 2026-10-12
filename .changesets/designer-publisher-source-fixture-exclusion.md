---
"designer": patch
"publisher": patch
---

Exclude source *.test.json snapshots and __fixtures__ directories from Designer and Publisher package contents. Artifact-safety checks also reject *.spec.json and complete __fixtures__ directory segments alongside existing source test-file checks. Runtime JSON, shipped examples and partial fixture-like names remain permitted.
