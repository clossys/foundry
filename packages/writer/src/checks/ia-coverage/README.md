# Writer IA coverage

Run the installed package command `writer-check ia-coverage`, or from this
repository after building Writer and Designer:

```sh
node packages/writer/dist/cli.js ia-coverage --out /tmp/writer-ia
```

The command prints a bottom-up summary table and atomically writes
`ia-coverage.json` in the output directory (default `.writer-ia-coverage` in cwd).
`--format json` prints the same JSON to stdout. Exit codes: 0 no findings,
1 findings, 2 invalid or unavailable inputs. Nothing in the catalogs, library,
receipt, approvals or tree is modified.

Designer connections come from the installed `@clossys/designer/catalog`
`loadBuildCatalog()` export. No Designer source files are read. Writer reads its
own shipped IA, slot registrations and sample records. Declarations alone give
`absent`; shipped sample records give `draft`, regardless of their asserted
status. For consumer evidence, pass `--root <writer-library>`: existing record
checks derive `checked`, and fresh owner fingerprints plus successful locale
coverage are required for `approved`. A leaf takes its weakest active record
state. Retired records do not establish a fill. Freeze and release eligibility
remain separate checks.

Pass `--connections <snapshot.json>` to include actual Publisher composition
links and admin roots, without reading another package's private files:

```json
{
  "nodes": [{ "id": "publisher:slot:c1:r1", "uses": ["passages.example"] }],
  "adminRoots": ["publisher:slot:c1:r1", "frames.app-shell"],
  "completeAdminGraph": false
}
```

An edge points from consumer to dependency. Only actual references and declared
requirements count; permissions to consume something do not. Section/passage
pairing is checked in both directions, but the reverse index is not a fake
consumption cycle. Opaque record references resolve within their own locale.
Orphan means no incoming consumer **in the supplied graph**. Missing endpoints
are P0. Unknown admin reachability remains `null`, conservatively ranking unfilled
leaves P1; only a complete supplied graph can establish unreachable/P2. Without
a snapshot, the known AppFrame/document shells are roots, and missing composition
and console connection evidence is reported as a Need.

L0 boards are the five Writer layers; L1/L2 groups use Writer's existing IA
declarations as their registry. The report lists those groups, missing/unplaced
L3 entries, fill evidence and reasons, uses/used-by, schema pairs, dangling edges,
cycles and orphans. Independent group registrations do not exist in the current
published shape and are not fabricated.
