---
name: clossys-publisher
description: Create content slots and candidates through the installed Publisher Node workflow, resolve registered Designer assemblies and Writer copy, and record revision-bound review, owner approval, activation and local release manifests.
disable-model-invocation: true
---
# clossys-publisher

Use Publisher through the coding agent. Read the installed package's README,
exports and this [command workflow](references/agent-workflow.md), then use its
pinned `dist/content/node.js` entry point. The Publisher UI is read-only. Change
content through these commands; do not edit registry files, generated reports,
approval metadata or release manifests to bypass a refused operation.

The consumer owns its records. Keep consumer content, library choices and
approval evidence in the consumer workspace, outside this capability package.
Publisher holds no destination credentials and performs no deployment, upload,
send or live readback. Receiver intake, adoption and scaffolding remain pending.

## Place content without changing its identity

Read `src/content/tree.json` in the installed package for the current editable
placement tree. Its default media and children are:

| Medium | Children |
| --- | --- |
| websites | site, admin, auth, app, demo |
| documents | docs |
| presentations | decks |
| videos | clips |
| messages | email |
| social | posts |

These are data, not a permanent closed taxonomy. Use valid current `l1`/`l2`
placements. One slot represents one content address or artifact; sections,
slides and scenes belong inside candidates. Milestones and bundles are tags.

`slot-create` mints an opaque `sl_` identity once. Never derive an ID from a
route, title, medium, directory or alias, and never replace it after a move or
rename. Record the returned ID. Declare every slot locale explicitly using
the bootstrapped workspace's locales; the default locale is no substitute for
the full selection. Targets and destinations must already exist in
`workspace.json`. There is no initialization or registry-replacement command.

## Define and assemble

Capture audience, goal, key message, call to action, tone, constraints and
source answers. Record unresolved blocking questions honestly. Choose a
registered Designer frame and config, then ordered registered sections and
configs with narrative intents. Resolve the consumer library at the pinned
`libraryVersion`. Tree frame hints are not registration evidence. Store
references to Designer assets and sections, never copied component source or
an invented layout. A redirect uses `redirectTarget` instead of composition.

Copy comes from Writer and uses exactly
`{ "key": "title", "locale": "en", "value": "…", "source": "writer" }`.
Carry genuine Writer output into the candidate for every declared slot locale;
do not mark Publisher-authored text as Writer output. Required fields follow
the registered config's copy schema. Empty draft values remain incomplete.
Optional page metadata uses the same copy shape and the supported metadata
keys. The future Writer `CopyRef` bridge is not implemented by these commands;
do not invent that input or claim live registry resolution.

Pin reused sections to `{ candidateId, sectionKey, revision }`. Following a
newer source requires an explicit receiving-candidate revision and fresh
Review and approval. Do not silently update pinned content.

## Review, approve and activate

Use `candidate-add` for a new alternative and `candidate-revise` for a complete
replacement content payload on a revisable candidate. The workflow allocates
globally unique `cN` IDs and immutable `rN` snapshots. Changed content appends
a revision; identical content retains its existing revision. An explicit
revision command clears approval and returns the candidate to draft. Active and retired candidates cannot be
revised here; create an alternative.

Run `review` after each revision. Its report and stage results are computed
from current stored content and the actual consumer Designer library. Inspect
the report's exact candidate, revision, digest, library version and locales.
Explain each finding and cross-layer need with its path, reference and named
producer: Designer for missing frames, sections, configs, assets or copy
schemas; Writer for missing copy. Resolve the reported need and re-review.
Do not substitute a layout, suppress findings or manufacture a passing report.

Assembly and Review evidence in this workflow is structural only. Passing it
does not prove a browser render, visual quality or a rendered medium. Stage
statuses are derived evidence: Failing, Needs input, Waiting, Done or Not
applicable. Explain what was measured and what remains pending.

`approve` requires explicit owner approval of the current revision and digest,
supported by the actual conversation or an owner approval ledger. Preserve
that evidence in the consumer's normal record. Never self-approve, infer
approval from an existing route, or treat a successful review as owner consent.
If that evidence is missing, present the concrete reviewed candidate, revision
and digest for owner approval before running `approve`. Reuse existing explicit
approval when it already covers those exact bytes. The command's `by` field
records that owner; a supplied name alone does not establish their consent.

Run `activate` explicitly only for the selected approved candidate. A slot may
have at most one active candidate; this command requires an empty active slot.
It does not implicitly replace or retire an existing active candidate. Report
unsupported switching or rollback as pending rather than editing the pointer.

## Pre-auth page

Use the shipped `MarketingView` template for a pre-auth marketing page, with
exactly one primary CTA in `heroActions` and product-surface or original-art
`heroMedia`. If a required Designer block is not a template slot, resolve that
named block in the page module; do not flatten the page into `SectionedView`.
Other compositions must use actual registered Designer frames and configs
supported by their rendering workflow, never a tree hint or invented layout.
The content commands above record and structurally review candidates; they
do not mount `MarketingView` or prove a browser render. Report an unsupported
template or rendering step as pending.

Done is exceptional (5), as defined in PRE-AUTH-QUALITY shipped with
`@clossys/designer`. Mechanical gates prove good (3) only. After
`designer-fold-check` is green, a bounded taste pass uses the live URL,
desktop and narrow screenshots in an independent `clossys-customer` session.
The keep comes from a synthetic user speaking in first person as the named
Strategist Audience, never Publisher, the doer, or a hired QA reviewer.
This role does not author keep-review evidence and does not inhabit the user.
This walk does not self-certify exceptional keep. Use at most 3 inhabit rounds
or 45 minutes wall clock, whichever first; at the cap, retain the last inhabit
record and ask the human. A keep does not grant owner approval or activation;
the current revision, digest and explicit approval controls still apply.

## Prepare a local release

Run `release` only for the selected active candidate with current owner
approval, matching `approvedBy`, and a clean current Review covering every
slot locale. Release checks and numbering come from the existing local store;
never select or overwrite a release number manually.

The output is immutable local release and build manifests plus a pending
handover stub. Its `status: "pending"`, `matches: false` and
`observedAt: null` mean the receiver has not observed the release. Report
"local release prepared" with the target, number, revision and digest. Do not
call it deployed, sent, adopted, live or publication complete. Package
publication and legacy preview/sealing commands are separate workflows and
do not supply approval or live evidence for these candidates.

When Publisher is not installed, answer read-only questions and report the
missing pinned capability. Do not run an unpinned engine or bootstrap a new
consumer registry as a workaround.
