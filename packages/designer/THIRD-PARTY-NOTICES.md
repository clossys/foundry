# Third-party notices

This package does not depend on `lucide-react` (or any other icon library)
at runtime — see README.md, "Icon glyph data" → "A subpath of `ui`, not a
separate package", for the tree-shaking and upstream-churn/rename
reasoning (this glyph set previously shipped as this scope's own standalone
`icons` package; this notice, and the data it covers, moved into this
package's own `./icons` subpath along with it — see this package's changelog).
The 41 glyphs at `@clossys/designer/icons` are, however, **visually
derived from [Lucide](https://lucide.dev)**: their SVG path data was
copied from `lucide-react`'s published source (version 1.23.0 for the
original 32; version 1.24.0 for `arrow-right`, `briefcase`, `file-check`,
`globe`, `landmark`, `layers`, `scale` and `shield-check`, added later) into
`scripts/icon-source-data.json`, then compiled into this package's own
plain `IconNode` data constants by `scripts/generate-icons.mjs`. This file
exists to satisfy Lucide's license attribution requirement for that copied
data, per both licenses that cover it below.

Four of this package's glyph names resolve to a Lucide glyph published
under a different (but still current) name in Lucide 1.23.0 — the semantic
name here matches this repository's own consumer-evidence naming (see
README.md, "Icon glyph data" → "How the 40 were chosen"), not a renaming
of the underlying artwork:

| This package | Lucide 1.23.0 source name |
| --- | --- |
| `AlertTriangle` | `triangle-alert` |
| `Home` | `house` |
| `CheckCircle` | `circle-check-big` |
| `XCircle` | `circle-x` |

## Lucide

SPDX-License-Identifier: ISC

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

SPDX-License-Identifier: MIT

The following icons this package ships are, per Lucide's own upstream
attribution, originally derived from the [Feather](https://feathericons.com)
project: `alert-triangle`, `calendar`, `check`, `chevron-down`,
`chevron-left`, `chevron-right`, `chevron-up`, `clock`, `external-link`,
`info`, `lock`, `monitor`, `moon`, `search`, `x`, `x-circle`, and the
later additions `arrow-right`, `briefcase`, `globe`, `layers`.

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

## Tailwind CSS

SPDX-License-Identifier: MIT

`styles/compiled.css` is output of a Tailwind CSS v4 `compile()` over the
class names this package's components, blocks and shell use (see its header).

MIT License

Copyright (c) Tailwind Labs, Inc.

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


## shadcn/ui theme registry

SPDX-License-Identifier: MIT

The seven base-color preset values and the vendored registry snapshots
`src/importers/vendor/shadcn-themes.ts.txt` and
`src/importers/vendor/shadcn-base-colors.ts.txt` derive from shadcn/ui commit
`96da9cc7f1aa10580a3741664e2a77c721206c00`. The MIT license and shadcn
copyright notice reproduced below also apply to these registry files and values.

## shadcn/ui Toggle and ToggleGroup

SPDX-License-Identifier: MIT

The adopted toggle modules derive from shadcn/ui commit
`daaf156ee00ed91cc7e6bdd937c1b4973152d141`, Aria base, Nova style.
Their design reads are rewritten onto the selected token contract; refs and
render props continue to the React Aria primitives.

Local divergence from the C15 source snapshot (`0d04b4c23`), approved by
owner decision D7: Toggle and ToggleGroup use logical icon padding, inline
corner radii and inline borders for right-to-left rendering. Vertical block
edges, React Aria behavior and the upstream attribution remain unchanged.

MIT License

Copyright (c) 2023 shadcn

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

The `LoaderCircle` glyph uses the exact `loader-circle` path nodes from
`lucide-react` 1.24.0, under the ISC notice above. It supplies the owner-ratified
loading asset; its content pin is retained in the Lucide importer roster.

The draft `PanelLeft` glyph also uses the exact `panel-left` path nodes from
`lucide-react` 1.24.0, under the ISC notice above. Its content pin is retained
in the Lucide importer roster.

The draft Aria rail additions use the official Aria source at commit
`96da9cc7f1aa10580a3741664e2a77c721206c00`, under the shadcn MIT notice
above. Individual fill descriptors retain the upstream addresses, file hashes,
and the generated source license notice.
