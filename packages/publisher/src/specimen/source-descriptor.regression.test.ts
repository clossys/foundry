import { describe, expect, it } from "vitest";
import { adaptPreview } from "./source.js";

const cases = [
  {
    "id": "native-nested-descriptor-default",
    "input": {
      "schema": "clossys.preview/1",
      "fixtures": {
        "file": "index.tsx",
        "export": "default",
        "props": {
          "title": "Visible title",
          "count": 3
        }
      },
      "container": "page",
      "width": 1280
    },
    "expected": {
      "fixtures": {
        "title": "Visible title",
        "count": 3
      },
      "entry": "index.tsx",
      "export": "default",
      "container": "page",
      "width": 1280
    }
  },
  {
    "id": "native-nested-descriptor-named-empty-props",
    "input": {
      "fixtures": {
        "file": "Gallery.tsx",
        "export": "Gallery",
        "props": {}
      },
      "container": "section-in-frame"
    },
    "expected": {
      "fixtures": {},
      "entry": "Gallery.tsx",
      "export": "Gallery",
      "container": "section-in-frame"
    }
  },
  {
    "id": "already-normalized-plain-fixtures",
    "input": {
      "entry": "View.tsx",
      "export": "View",
      "fixtures": {
        "items": [
          {
            "id": "row-1"
          }
        ],
        "empty": false
      }
    },
    "expected": {
      "entry": "View.tsx",
      "export": "View",
      "fixtures": {
        "items": [
          {
            "id": "row-1"
          }
        ],
        "empty": false
      }
    }
  },
  {
    "id": "legacy-top-level-props",
    "input": {
      "props": {
        "label": "Action"
      },
      "entry": "Button.tsx",
      "export": "Button"
    },
    "expected": {
      "fixtures": {
        "label": "Action"
      },
      "entry": "Button.tsx",
      "export": "Button"
    }
  },
  {
    "id": "plain-fixture-export-prop-is-data",
    "input": {
      "fixtures": {
        "export": "user-visible-string",
        "title": "Do not unwrap"
      }
    },
    "expected": {
      "fixtures": {
        "export": "user-visible-string",
        "title": "Do not unwrap"
      }
    }
  },
  {
    "id": "plain-fixture-file-prop-is-data",
    "input": {
      "fixtures": {
        "file": "document.txt",
        "title": "Do not unwrap"
      }
    },
    "expected": {
      "fixtures": {
        "file": "document.txt",
        "title": "Do not unwrap"
      }
    }
  },
  {
    "id": "nonobject-preview",
    "input": null,
    "expected": {}
  },
  {
    "id": "preserve-existing-presentation-normalization",
    "input": {
      "fixtures": {
        "heading": {
          "$copy": "title"
        }
      },
      "copy": {
        "title": {
          "text": "Example heading",
          "role": "heading",
          "limits": {
            "maxChars": 80
          }
        }
      },
      "container": {
        "kind": "canvas"
      },
      "defaults": {
        "width": 640,
        "theme": "theme.example"
      },
      "theme": "light"
    },
    "expected": {
      "fixtures": {
        "heading": {
          "$copy": "title"
        }
      },
      "copy": {
        "title": {
          "text": "Example heading",
          "role": "heading",
          "maxChars": 80
        }
      },
      "container": "canvas",
      "theme": "theme.example",
      "width": 640
    }
  }
];

describe("adaptPreview descriptor regression", () => {
  for (const { id, input, expected } of cases) {
    it(id, () => {
      const snapshot = structuredClone(input);
      try {
        expect(adaptPreview(input)).toStrictEqual(expected);
      } finally {
        expect(input).toStrictEqual(snapshot);
      }
    });
  }
});
