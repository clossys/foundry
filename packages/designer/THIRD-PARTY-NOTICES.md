# Third-party notices

This package does not depend on `lucide-react` (or any other icon library)
at runtime — see README.md, "Icon glyph data" → "A subpath of `ui`, not a
separate package", for the tree-shaking and upstream-churn/rename
reasoning (this glyph set previously shipped as this scope's own standalone
`icons` package; this notice, and the data it covers, moved into this
package's own `./icons` subpath along with it — see CHANGELOG.md).
The 32 glyphs at `@clossys/designer/icons` are, however, **visually
derived from [Lucide](https://lucide.dev)**: their SVG path data was
copied from `lucide-react`'s published source (version 1.23.0) into
`scripts/icon-source-data.json`, then compiled into this package's own
plain `IconNode` data constants by `scripts/generate-icons.mjs`. This file
exists to satisfy Lucide's license attribution requirement for that copied
data, per both licenses that cover it below.

Four of this package's glyph names resolve to a Lucide glyph published
under a different (but still current) name in Lucide 1.23.0 — the semantic
name here matches this repository's own consumer-evidence naming (see
README.md, "Icon glyph data" → "How the 32 were chosen"), not a renaming
of the underlying artwork:

| This package | Lucide 1.23.0 source name |
| --- | --- |
| `AlertTriangle` | `triangle-alert` |
| `Home` | `house` |
| `CheckCircle` | `circle-check-big` |
| `XCircle` | `circle-x` |

## Lucide

ISC License

Copyright (c) 2026 Lucide Icons and Contributors

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.

## Feather (a subset of Lucide's icons, including some shipped here, derive from it)

The following icons this package ships are, per Lucide's own upstream
attribution, originally derived from the [Feather](https://feathericons.com)
project: `alert-triangle`, `calendar`, `check`, `chevron-down`,
`chevron-left`, `chevron-right`, `chevron-up`, `clock`, `external-link`,
`info`, `lock`, `monitor`, `moon`, `search`, `x`, `x-circle`.

The MIT License (MIT)

Copyright (c) 2013-present Cole Bemis

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
