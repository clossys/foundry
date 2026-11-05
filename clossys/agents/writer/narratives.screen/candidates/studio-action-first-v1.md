---
slot: "narratives.screen"
locales: ["en"]
source: {"kind":"derived","ref":["director:focus.offer.included@1","director:identity.verbal.voice@1"]}
vary: {"arc":"action-first"}
---

## en

### studio.slot-detail.screen
<!-- {"id":"studio.slot-detail.screen","bindings":[]} -->
```json
{
  "id": "studio.slot-detail.screen",
  "context": "studio.slot-detail.screen",
  "frame": {
    "frameId": "frames.app-shell"
  },
  "passages": [
    "passages.record-detail#studio.slot-detail",
    "passages.resource-list#studio.candidates",
    "passages.media#studio.preview",
    "passages.table-of-contents#studio.detail.toc",
    "passages.activity-feed#studio.history"
  ]
}
```
