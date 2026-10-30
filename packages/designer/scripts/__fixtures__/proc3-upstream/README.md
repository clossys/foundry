These unchanged MIT-licensed files are classification reference inputs from
shadcn-ui/ui commit `daaf156ee00ed91cc7e6bdd937c1b4973152d141`:

- `globals.css`: `apps/v4/app/globals.css`, Git blob `00c2223f05d5ef295cc4849d4ccb716466b82ee4`.
- `legacy-themes.css`: `apps/v4/app/legacy-themes.css`, Git blob `4e450a7911a4be94b04db5c68274e5d9fd2b0e17`.
- `tailwind.css`: `packages/shadcn/src/tailwind.css`, Git blob `067bfc56fc086420835582f469e2c78d3942c69a`.

The MIT copyright and permission notice is retained in
[LICENSE.md](../../../src/importers/__fixtures__/shadcn-aria/LICENSE.md).
The loader verifies exact SHA-256 hashes and the existing source provenance,
Nova stylesheet and license. These inputs are never added to product styles.
Reference scope is selected Nova and common upstream CSS. Imports are recorded
explicitly; they do not provide shipped stylesheet coverage. Class sinks come
only from source files whose content hashes match the pinned provenance.

Bare `group` and `group/<CSS identifier>` are structural ancestor markers under
the locked Tailwind 4.3.3 group compound variant implementation. Variant utility
classes still require shipped rules. A `cn-*` hook is a marker only if verified
upstream source uses it and the reference styles define no styling for it;
`@apply` counts as styling. Candidate stylesheet absence never defines a marker.
