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

### studio.pattern.owner-third-person
<!-- {"id":"studio.pattern.owner-third-person","bindings":[]} -->
```json
{
  "id": "studio.pattern.owner-third-person",
  "context": "studio.pattern.owner-third-person",
  "kind": "pattern-rule",
  "pattern": {
    "source": "\\bthe owner(?:'s)? (?:pins?|picks?|selects?|approves?|confirms?|decides?|chooses?|reviews?)\\b",
    "flags": "i"
  },
  "severity": "warning",
  "reason": "Studio copy is read by the owner, and the person rule asks for second person: the owner is you, not a third party.",
  "alternative": "you pin, you pick, you approve"
}
```

### studio.pattern.drafted-legal-date
<!-- {"id":"studio.pattern.drafted-legal-date","bindings":[]} -->
```json
{
  "id": "studio.pattern.drafted-legal-date",
  "context": "studio.pattern.drafted-legal-date",
  "kind": "pattern-rule",
  "pattern": {
    "source": "(?:\\b(?:Revised|Effective|Last updated|Updated)(?: on)?:? |^)(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\\.? \\d{1,2}, \\d{4}\\.?$"
  },
  "severity": "warning",
  "reason": "A revision or effective date is a legal fact the owner states; a date the Writer drafted is a guess.",
  "alternative": "the date the owner gives, in the date format"
}
```
