# Agent command workflow

Use the installed, pinned Publisher package. The direct Node entry point is
`<installed publisher>/dist/content/node.js`; no new executable name is needed.
Each command accepts these exact arguments:

```sh
node "$publisher_entry" slot-create --root "$publisher_root" --designer "$designer_root" --catalog "$catalog_file" --input slot-create.json --at "$operation_at"
```

Set `publisher_entry` to that installed file, `publisher_root` to the existing
consumer Publisher store, `designer_root` to the consumer Designer library,
and `catalog_file` to a JSON file containing `CompositeCatalogData` for the
installed Designer version. `operation_at` is an explicit ISO timestamp for
the operation. Read existing `workspace.json` and the current placement tree
before preparing inputs. These commands do not initialize either library.
Run commands serially with one agent writing a consumer store at a time.

Inputs are JSON files containing only the fields for that command. Examples
below are illustrative: replace placeholders with actual registered IDs,
Writer output, workspace targets, returned identities and measured evidence.
Keep input files in the consumer's normal working area. Do not put consumer
records into the Publisher package or manually patch persisted output.

## Create and draft

`slot-create.json` contains a `ContentSlot` without the command-owned `id`,
`activeCandidateId`, `releases` or `createdAt` fields:

```json
{
  "slot": {
    "l1": "websites",
    "l2": "site",
    "aliases": [],
    "locales": ["en"],
    "position": { "order": 1, "name": "Example" },
    "name": "Example",
    "kind": "content",
    "route": "/example",
    "deployTarget": "<existing-workspace-target>",
    "devOnly": false,
    "tags": []
  }
}
```

Read the minted ID from `data.slot.id`; preserve it. For multilingual slots,
select all intended workspace locales now and supply matching Writer copy in
every locale. Candidate IDs are allocated as the next `cN` across the registry,
not separately for each slot. Read `data.candidate.id` after adding one.

`candidate-add.json`:

```json
{
  "slotId": "<returned-slot-id>",
  "content": {
    "name": "Example candidate",
    "brief": {
      "audience": "<intended audience>",
      "goal": "<audience outcome>",
      "keyMessage": "<key message>",
      "callToAction": "<next action>",
      "tone": "<required tone>",
      "constraints": [],
      "sourceAnswers": [],
      "version": 1
    },
    "composition": {
      "libraryVersion": "<consumer-library-version>",
      "frame": {
        "frameId": "<registered-frame-id>",
        "configId": "<registered-frame-config-id>"
      },
      "sections": [
        {
          "key": "intro",
          "sectionId": "<registered-section-id>",
          "configId": "<registered-section-config-id>",
          "intent": "continues",
          "fields": [
            {
              "key": "<registered-copy-key>",
              "locale": "en",
              "value": "<actual Writer output>",
              "source": "writer"
            }
          ]
        }
      ]
    },
    "links": [],
    "typeSettings": {},
    "openQuestions": []
  }
}
```

This is a shape example, not a guaranteed complete registered composition.
Supply every field required by the actual config and every selected locale.
For website content, Review may also require `pageMeta` with `title`,
`description`, `share-title` and `share-text`, using the same Writer copy shape,
and registered `pageMetaAssets`. Follow actual findings.

```sh
node "$publisher_entry" slot-create --root "$publisher_root" --designer "$designer_root" --catalog "$catalog_file" --input slot-create.json --at "$operation_at"
node "$publisher_entry" candidate-add --root "$publisher_root" --designer "$designer_root" --catalog "$catalog_file" --input candidate-add.json --at "$operation_at"
node "$publisher_entry" review --root "$publisher_root" --designer "$designer_root" --catalog "$catalog_file" --input review.json --at "$operation_at"
```

Prepare `candidate-add.json` after obtaining the slot ID. `review.json` is
`{ "candidateId": "<returned-candidate-id>" }`. Inspect `data.report` and
`data.stages`. Review also writes
`.generated/reviews/<candidateId>.json` under the Publisher root with
`requestedAt`, `report` and `assemblyScope: "structural-only"`. It is generated
diagnostic output, never caller-editable authority.

## Revise and re-review

`candidate-revise.json` contains `{ "candidateId": "<candidate-id>",
"content": { ... } }`, with a complete `CandidateContent` object as above,
not a patch. Changed content appends the next immutable revision; an identical
payload retains the existing revision. The command clears approval and returns
the candidate to draft. Active or retired candidates require a new
alternative through `candidate-add`.

```sh
node "$publisher_entry" candidate-revise --root "$publisher_root" --designer "$designer_root" --catalog "$catalog_file" --input candidate-revise.json --at "$operation_at"
node "$publisher_entry" review --root "$publisher_root" --designer "$designer_root" --catalog "$catalog_file" --input review.json --at "$operation_at"
```

Use actual findings and `needs` to resolve missing Designer registrations,
schemas or Writer copy. A new revision needs fresh Review and owner approval.

## Approve, activate and release

Only after a clean current Review, obtain or locate explicit owner approval
bound to its candidate, revision and digest. `approve.json`:

```json
{
  "candidateId": "<reviewed-candidate-id>",
  "by": "<owner-from-actual-approval-evidence>",
  "revision": "<current-revision-from-review>",
  "digest": "<current-digest-from-review>"
}
```

`activate.json` is `{ "candidateId": "<approved-candidate-id>" }`.
`release.json` is `{ "candidateId": "<active-candidate-id>",
"approvedBy": "<same-approving-owner>" }`. Invoke in order, reading each result
before continuing:

```sh
node "$publisher_entry" approve --root "$publisher_root" --designer "$designer_root" --catalog "$catalog_file" --input approve.json --at "$operation_at"
node "$publisher_entry" activate --root "$publisher_root" --designer "$designer_root" --catalog "$catalog_file" --input activate.json --at "$operation_at"
node "$publisher_entry" release --root "$publisher_root" --designer "$designer_root" --catalog "$catalog_file" --input release.json --at "$operation_at"
```

Approval, activation and release use current derived checks, not an edited
generated report. Activation requires an empty active slot and valid approval.
A refused switch is not permission to edit `activeCandidateId` manually.
Release requires the candidate to remain active, current owner approval and
matching `approvedBy`, and a clean Review for every slot locale.

Read release bundles from `data.releases`. Local files are
`_releases/<targetId>/<n>.json`, `<n>.build.json` and `<n>.handover.json` under
the Publisher root. The manifest freezes candidate revision and digest; the
build manifest records routes and locales. Numbering is append-only per
target. The handover remains `status: "pending"`, `matches: false`,
`observedAt: null`. Report the prepared local release and pending receiver
work. These files establish no browser render, deployment or live observation.
