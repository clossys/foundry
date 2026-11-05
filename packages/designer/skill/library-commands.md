# Designer agent commands

Every design-system write goes through `designer-library`. Never hand-edit files
under the consumer library root: `receipt` reports drift as a DR finding. The
locked writer stages, checks and stamps each changed generation in
the library's root receipt file; unchanged generations do not grow its history. Stamps
include the command, its inputs, the resulting content hash and any carried drift.

## Explicit changes

```text
designer-library reselect --root <library> --leaf <leaf-id> --source <source-id> [--write] [--json]
designer-library generate-starter --root <library> --leaf <leaf-id> [--write] [--json]
designer-library select --root <library> --starter <shadcn-base|custom> [--write]
designer-library capture --root <library> --driver <module> --out <dir> [--leaf <leaf-id>]
```

`reselect` previews an adopt changeset at the current library hash and prints the
engine verdict. `generate-starter` previews the existing identity starter engine's
author operation; unsupported leaves are unavailable. Both commands write only
with `--write`, through the same protected path as `apply`. Their stamps name
`designer-library reselect` with `leaf` and `source`, or
`designer-library generate-starter` with `leaf`, alongside the writer's guarded
hash and changes metadata. A dry run changes no library file.

`select` is unavailable until a whole-library starter engine ships. It exits 2
without writing; `--brief` is also unavailable. `recommend` remains unavailable.
Do not invent starter choices, values or provenance to make these commands pass.

The read-only inspector's how-to-change line is exactly
`designer-library reselect --root <library> --leaf <leaf-id> --source <source-id>`.
Replace the leaf placeholder with its permanent identity, for example
`tokens.blur`. Never use a group path: regrouping changes presentation only.

## Capture cache and driver

The driver is a host-supplied module resolved from the current working directory.
It exports `render(leaf): ReactNode | undefined` and asynchronous
`shoot({ html, width, height }): Promise<Uint8Array>`. The package supplies no
browser or browser dependency. Missing specimens and shot failures are listed
per leaf. Output must have a RIFF/WEBP header.

Capture renders each component, section or frame fill's specimen into a complete
HTML document with the root's available theme, brand, scales and fonts CSS
inlined. Components use 640 by 400 pixels; sections and frames use 1280 by 800.
`--leaf` limits the capture. `--out` must resolve outside `--root`, including
through symlinks: images are derived cache data, not stamped design-system state.
Capture never changes the library or its receipt.

Each successful image is atomically written as `<out>/<leaf-id>.webp`. The
atomically written `index.json` has version 1, the last receipt write's
`libraryHash`, and a stable leaf-keyed `leaves` map. Each row records the matching
receipt fill digest, image SHA256, width and height. Failed leaves have no row.
The thumbnail UI compares the fill digest to the current receipt to mark stale
images; it does not treat an image as a control or write to the library.

## Existing commands

| Command | Behavior |
| --- | --- |
| `status --root <library> [--json]` | Report fills and the exact current baseHash. |
| `check --root <library> [--layer <layer>] [--observations <file>] [--json]` | Run the existing engine checks. |
| `emit --root <library> [--check] [--target <target>] [--observations <file>]` | Regenerate stamped output; `--check` only checks drift. |
| `apply --root <library> --changeset <file> [--observations <file>] [--json]` | Apply an explicit changeset through the guarded writer. |
| `receipt --root <library> [--base <receipt.json>] [--json]` | Check the manifest, carried drift and optional append-only history. |
| `graph --root <library> --check` | Check usage graph drift. |
| `graph --root <library> --write` | Write and stamp the derived usage graph. |
| `dogfood --root <library> <path...> [--write-needs] [--json]` | Derive findings; only the explicit flag writes stamped needs. |
| `dogfood-consumer --root <library> <path...> --contract <file> [--json]` | Check reachable consumer sources without exceptions. |
| `needs --root <library> [--status open,proposed] [--json]` | Read needs and blocked parents. |
| `needs --root <library> set NEED-NNN --status <status> [--candidate <json>] [--closed-by <ref>]` | Record a guarded, stamped status transition. |
| `recommend --root <library>` | Unavailable; no recommendation is synthesized. |

Exit codes are 0 for success, 1 for a failed verdict or conflict, and 2 for
usage errors, invalid inputs or unavailable commands. Capture exits 1 if any leaf
fails, even when other leaves were captured. Read the actual output and findings;
neither a dry-run verdict nor a thumbnail is permission to perform a write.
