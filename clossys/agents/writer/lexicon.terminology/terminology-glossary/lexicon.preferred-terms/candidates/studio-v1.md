---
slot: "lexicon.preferred-terms"
locales: ["en"]
source: {"kind":"derived","ref":["director:focus.category.definition@1","director:identity.verbal.voice@1"]}
---

## en

### studio.term.slot
<!-- {"id":"studio.term.slot","bindings":[]} -->
```json
{
  "id": "studio.term.slot",
  "context": "studio.term.slot",
  "kind": "term",
  "term": "slot",
  "forms": [
    "slot",
    "slots"
  ],
  "termStatus": "preferred",
  "reason": "One choice the workspace records, with its candidates and at most one pin."
}
```

### studio.term.candidate
<!-- {"id":"studio.term.candidate","bindings":[]} -->
```json
{
  "id": "studio.term.candidate",
  "context": "studio.term.candidate",
  "kind": "term",
  "term": "candidate",
  "forms": [
    "candidate",
    "candidates"
  ],
  "termStatus": "preferred",
  "reason": "One option in a slot; candidates are never edited, a change is a new version.",
  "alternative": "option"
}
```

### studio.term.pin
<!-- {"id":"studio.term.pin","bindings":[]} -->
```json
{
  "id": "studio.term.pin",
  "context": "studio.term.pin",
  "kind": "term",
  "term": "pin",
  "forms": [
    "pin",
    "pinned",
    "pins"
  ],
  "termStatus": "preferred",
  "reason": "The owner's selection of one candidate; agents never pin."
}
```

### studio.term.need
<!-- {"id":"studio.term.need","bindings":[]} -->
```json
{
  "id": "studio.term.need",
  "context": "studio.term.need",
  "kind": "term",
  "term": "NEED",
  "forms": [
    "NEED"
  ],
  "termStatus": "preferred",
  "reason": "Marks a fact with no evidence yet; never replaced by a guess."
}
```

### studio.term.agent
<!-- {"id":"studio.term.agent","bindings":[]} -->
```json
{
  "id": "studio.term.agent",
  "context": "studio.term.agent",
  "kind": "term",
  "term": "agent",
  "forms": [
    "agent",
    "agents"
  ],
  "termStatus": "preferred",
  "reason": "Director, Designer, Writer or Publisher; name the agent that owns the step."
}
```

### studio.term.lineage
<!-- {"id":"studio.term.lineage","bindings":[]} -->
```json
{
  "id": "studio.term.lineage",
  "context": "studio.term.lineage",
  "kind": "term",
  "term": "lineage",
  "forms": [
    "lineage"
  ],
  "termStatus": "preferred",
  "reason": "Where a candidate came from: the upstream slots it cites."
}
```
