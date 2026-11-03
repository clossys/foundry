---
slot: "narratives.app-chrome"
locales: ["en"]
source: {"kind":"derived","ref":["director:identity.naming.architecture@1","director:identity.verbal.voice@1","director:identity.naming.name@1"]}
---

## en

### studio.chrome
<!-- {"id":"studio.chrome","bindings":[]} -->
```json
{
  "id": "studio.chrome",
  "context": "studio.chrome",
  "frame": {
    "frameId": "frames.app-shell",
    "configId": "NEED"
  },
  "regions": {
    "header": {
      "brand": {
        "ref": "string",
        "id": "passages.logo-mark#studio.logo-mark.label"
      },
      "theme": {
        "ref": "string",
        "id": "strings.actions#studio.action.toggle-theme"
      }
    },
    "nav": {
      "items": [
        {
          "ref": "string",
          "id": "strings.navigation#studio.nav.home"
        },
        {
          "ref": "string",
          "id": "strings.navigation#studio.nav.director"
        },
        {
          "ref": "string",
          "id": "strings.navigation#studio.nav.designer"
        },
        {
          "ref": "string",
          "id": "strings.navigation#studio.nav.writer"
        },
        {
          "ref": "string",
          "id": "strings.navigation#studio.nav.publisher"
        }
      ]
    }
  }
}
```
