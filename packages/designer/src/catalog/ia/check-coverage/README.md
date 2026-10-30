# IA completeness

Build Designer, then run its existing package executable:

```sh
npm run build -w packages/designer
node packages/designer/dist/library-cli/cli.js ia-coverage --out ia-coverage.json
# Installed package: designer-library ia-coverage --out ia-coverage.json
```

The command prints a five-layer summary table and writes deterministic JSON. Exit
0 means no findings, 1 means findings, and 2 means invalid input or I/O failure.
Catalog inputs are read-only. Reports cannot replace any catalog/input file;
report replacement uses a separate temporary file and atomic rename.

The report walks registered L3 leaves before rolling up L2 families, L1 groups and
L0 layers. IA owns group identity: group registry presence means its registered
descendant membership, not a fabricated second group registry. Missing/unplaced
leaves and dangling references are P0. Consumption cycles are P1; an orphan means
no consumer in the supplied graph and is a P2 Need, not proof of global non-use.
Leaf keys are always the permanent leaf id; paths are separate display data.

States are derived: no committed fill is `absent`; a fill without hash-bound
executed checks is `draft`; passing executed checks bound to its exact bytes are
`checked`; those checks plus valid owner signoff are `approved`. A metadata status
or list of check names never establishes execution. Optional `--checks` accepts
records `{fillId, sourceHash, results:[{code, passed}]}`. No checks or approvals are
created by this command, and no conformance qualification is implied by a partial
external check record.

Connections combine explicit compositions/parts, actual token aliases and the
existing usage snapshot's scanned/runtime edges, with evidence labels retained.
Fill references are the union across catalog candidates, not proof that a host
selected any one of them. Reachability is within that supplied catalog graph, not
a browser observation.
Permission lists (`allowedReads`, `allowedComposes`) are never inferred usage.
Snapshot freshness remains a Need; this audit does not edit/re-qualify it. The
cycle check is over leaves; member aliases within one leaf retain the token
checker's responsibility. Reverse Writer schema ownership is validated as an
association, not an invented reciprocal consumption cycle.

`--writer-catalog <dir>` reads Writer's passage schemas and copy record ids.
`--publisher-input <file>` accepts Publisher's existing ContentRegistry shape
(`slots`, `candidates`) and follows active candidates for `/agents/designer`,
`/agents/writer`, `/agents/publisher` only. CopyRef record ids remain distinct from
passage-schema ids. No test fixture is treated as live consumer registration.
Missing external inputs are unresolved Needs; missing entries in an available
registry are dangling P0s. AppFrame is a known admin root; other reachability is
unknown until admin bindings are supplied, rather than asserted unreachable.
Unfilled reachable/unknown leaves rank P1; proven unreachable leaves rank P2.

`--catalog <dir>` selects a different Designer catalog. `--input <file>` instead
accepts an explicit complete checker snapshot for repeatable fixtures/integration;
it cannot be combined with catalog adapters. Inputs and all evidence limitations
remain visible in the JSON. The basis identifies catalog versus supplied snapshot
and hashes the audit input projection; that digest is not a whole-source-tree
qualification. No leaf, fill, approval or IA grouping is changed.
