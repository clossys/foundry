---
slot: "lexicon.avoid-patterns"
locales: ["en"]
source: {"kind":"derived","ref":["director:identity.verbal.voice@4"]}
---

## en

### studio.pattern.exclamation
<!-- {"id":"studio.pattern.exclamation","bindings":[]} -->
```json
{
  "id": "studio.pattern.exclamation",
  "context": "studio.pattern.exclamation",
  "kind": "pattern-rule",
  "pattern": {
    "source": "!(?=\\s|$)"
  },
  "severity": "warning",
  "reason": "The voice draft asks for calm copy; exclamation marks read as hype.",
  "alternative": "end with a full stop"
}
```

### studio.pattern.click-here
<!-- {"id":"studio.pattern.click-here","bindings":[]} -->
```json
{
  "id": "studio.pattern.click-here",
  "context": "studio.pattern.click-here",
  "kind": "pattern-rule",
  "pattern": {
    "source": "\\bclick here\\b",
    "flags": "i"
  },
  "severity": "warning",
  "reason": "Link text should name the destination.",
  "alternative": "name the page or action"
}
```
