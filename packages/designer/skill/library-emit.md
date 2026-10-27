# Emit consumer-library files

Use the consumer's installed `designer-library` bin and its consumer-owned
library directory. Examples use `library` relative to the consumer's working
directory; substitute its actual library root. The consumer library is the
only input to resolve and emit. Do not emit directly from an upstream fill,
modify generated output by hand or invent missing values.

## Inspect and check

Run `designer-library status --root library` to inspect the saved library.
Run `designer-library check --root library` before regeneration. For a focused
check, `designer-library check --root library --layer tokens` or
`designer-library check --root library --layer assets` is available.
`designer-library check --root library --layer components` runs the composite
engine component checks. Section and frame layer checks are unavailable (exit 2);
do not describe them as checked. See [the check procedure](library-check.md)
for finding explanations. Report the affected leaf, the problem and the next
human action in plain language, alongside machine output when useful.

Stop on an invalid or unreadable library, a failed check, or an unavailable
capability. Return the finding for correction through an explicitly authorized
library change. Emission never grants permission to apply a ChangeSet.

## Regenerate and verify drift

Run the complete default emission:

```sh
designer-library emit --root library
designer-library emit --root library --check
```

For a bounded target set, repeat `--target` and use the same targets for the
write and drift check:

```sh
designer-library emit --root library --target css-brand --target notices
designer-library emit --root library --target css-brand --target notices --check
```

| Target | Generated file | Meaning |
| --- | --- | --- |
| `css-brand` | `brand.css` | Consumer brand token bindings |
| `css-scales` | `scales.css` | Non-brand scale differences from the baseline |
| `css-fonts` | `fonts.css` | Imports for resolved Fontsource payloads |
| `tailwind-theme` | `theme.css` | Tailwind theme variables |
| `notices` | `notices.json`, composite `notices/components.json` | Adopted origins and licensing metadata |
| `component-index` | `component-index.ts`, component wrappers and adapters | Checked executable component bindings |
| `components-consumption` | `components-consumption.json` | Component dependency and check findings |

Value folders retain their five default targets. Composite folders additionally
emit `component-index` and `components-consumption` by default. They store
component fills at `fills/components.<slot>.json` and explicit owned source
under `components/`, `adapters/` and `notices/`. Their `metadata.json` has
`format: "composite-v1"`, separate value/component metadata and a `files` array
of owned source paths. Generated output is excluded from that inventory.
The shared server reader accepts a composite catalog to return both portions;
existing value reader calls retain their value shape. The value `apply`
changeset format remains unchanged and requires a value folder.

Component checks require the engine's independent runtime observations;
writing descriptors or source files does not supply those observations. The
CLI reports missing evidence and refuses emission when checks fail. Server
integrations that already hold observations can pass the existing engine's
`componentOptions` to `libraryFiles`, `checkLibrary` and `emitLibrary`.
The CLI resolves components against the registered composition rules and the
offline bundle fills. Package-pointer components need package-export evidence:
`check`, `emit` and `apply` accept `--observations <file>` shaped as
`{ "packageExports": { "<module>": ["<Export>"] } }`, and default to the
library's own `component-observations.json` when it is present. With no
evidence, package pointers are refused; a named file that is missing or
malformed is exit 2.
The CLI also maintains deterministic projection metadata; let the installed
writer own its location and format.
`--check` compares generated content without saving it. Exit 0 means the
requested operation passed; exit 1 is a failed check or drift; exit 2 means
invalid input or unavailable execution. Preserve the actual output and exit
code. A drift check proves only the requested emitted files match this saved
library; it does not prove adoption or visual approval.

Carry `notices.json` with distributed output and retain the applicable source
license text. A bounded CSS-only emission is not proof that notices are current:
include the notices target before distribution. Install any referenced font
packages through the consumer's normal dependency process; generated imports
are not installed fonts. Do not replace an application's existing token entry
with the generated Tailwind `theme.css` merely because the filenames resemble
one another. Bind brand CSS to document roots with `data-brand-bound` and
review the consumer's supported light and dark modes.

## Asset output requires its supported API

The CLI targets above do not generate raster icons or web-icon files. There is
no CLI rasterizer flag. For a consumer integration that already supplies the
required capabilities, `@clossys/designer/catalog` exposes pure asset helpers
such as `emitIdentityFiles`, `emitGlyphModule` and `assetNotices`.
`@clossys/designer/catalog/server` exposes `emitWebIcons` and the
`RasterizeSvg` port. `emitWebIcons` requires a resolved consumer library plus
an explicit name and a caller-supplied SVG-to-PNG rasterizer; returned PNGs
are checked for their expected dimensions. It can produce favicon, app-icon
and manifest files. If that server port is absent, stop and report the missing
integration. Do not substitute a made-up command or claim raster output exists.

Use consumer-owned output destinations and carry asset notices and license
text alongside the assets. Never fetch or copy an upstream asset as a shortcut
around the saved consumer library. Hand generated results to the owner for
visual review; only the owner can approve promotions and the final appearance.
