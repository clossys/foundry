# Writer shared-copy sweep

These two unresolved findings are present at both
`607674050b8f8cb6599a1bd3c44b3b552658e7ca` and the shared-copy handoff base
`f3a3b19ef940f9d1d1e4aeae3345c8282b4462cc`. They remain separate from the
363-binding prepared-route data proof and its collapsed SSR sample. Neither
finding is a clearance, copy approval, or a claim of production adoption.

The bounded combined run below exited 1 with 29 passed and 2 failed tests;
the two failures correspond exactly to the entries below:

```sh
npm exec --workspace=packages/writer -- vitest run src/catalog/records/mechanical-audit.test.ts src/catalog/ia/derive-passages.test.ts --maxWorkers=1
```

## WR-SWEEP-001: missing external admin-voice declaration

Status: open, inherited.

`src/catalog/records/admin-meta.r1.en.json:9675` binds
`preview.status.unavailable` to `st.z5cgvzw0ca`. That record is absent from
the local records and the envelope's `externalRecords` declarations. Its
actual source is `src/catalog/records/admin-voice.r1.en.json:625`, context
`Designer console`, leaf `strings.errors`, draft status and
`foundry-default` origin. The binding, missing declaration, and source
record are identical at both commits above.

The catalog source audit refuses this undeclared external binding at
`src/catalog/records/mechanical-audit.test.ts:105`, before compiling the
catalog's text subjects. Reproduce from the repository root:

```sh
npm exec --workspace=packages/writer -- vitest run src/catalog/records/mechanical-audit.test.ts --maxWorkers=1
```

Follow-up: reconcile the external source declaration with the actual
admin-voice source, preserving its draft status and source context.

## WR-SWEEP-002: stale table-of-contents passage derivation

Status: open, inherited.

`packages/designer/src/catalog/slots/sections.json:7163` declares the optional
plain `label` field for `sections.table-of-contents`, with English maximum
length 120 and `dir: auto`. The derived Writer copy schema at
`src/catalog/slots/passages.json:4671` contains `headings[].label` and
`labels.label`, but omits that additional field. Pure derivation identifies
`passages.table-of-contents` as the sole differing slot. Reproduce without
writing generated output:

```sh
node packages/writer/scripts/derive-passages.mjs --check
```

The source slot file, generated passage slot file, and generator have identical
SHA-256 values at both commits above:

| File | SHA-256 |
| --- | --- |
| `packages/designer/src/catalog/slots/sections.json` | `fd00fcbd4bfab6b3dc3a2e2b842bb6764d5062abad11fdd0c86d25fba2855424` |
| `packages/writer/src/catalog/slots/passages.json` | `401f71d240ed27d77fe6b6961d8b958a0289f43753e7a07af29b753509b9fbc2` |
| `packages/writer/scripts/derive-passages.mjs` | `fc4a317085c111e3cec0a22a53f29edf994c995d6a858cfed8145a90b3c5bafb` |

Follow-up: regenerate and review the passage schema in its owning catalog
change, including dependent schema-digest checks. Shared-copy fixture work
does not regenerate it.
