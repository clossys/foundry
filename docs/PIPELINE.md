# Product delivery pipeline

**Historical record — not current package architecture or consumer
instruction.** This document preserves the earlier `strategy`/`copy`/`ui`/
`surface` package pipeline. Those package names are retired; the current
catalogue, lifecycle records, and the individual Strategist, Writer, Designer,
and Publisher package READMEs are authoritative.

Foundry separates governed intent, reusable presentation, audience language,
and publishable output. A consumer owns its records, routing, deployment, and
runtime integrations; these packages provide the contracts and deterministic
steps between them.

```
strategy records
       │ StrategyProvenance
       ▼
copy registry ── CopyRef ──► UI primitives + surface document
                                      │ resolved approved copy
                                      ▼
                  channel renderer + resolved OutputManifest
                                      │
                                      ▼
                         consumer-owned route or publisher
```

## Ownership

- `@vespeneventures/strategy` governs product, audience, positioning,
  evidence, claims, and constraints. `createStrategyProvenance` produces the
  serialisable, dependency-free handoff attached to an output manifest.
- `@vespeneventures/copy` owns voice validation and a consumer-authored,
  versioned `CopyRegistry`. Only approved `CopyRef`s resolve, and resolution
  carries locale, revision, and source provenance.
- `@vespeneventures/ui` owns tokens, CSS, icons, accessible primitives,
  blocks, shell elements, and visual quality gates. It intentionally does not
  own page compositions or product language.
- `@vespeneventures/surface` owns `SurfaceDocument`, page-level web views,
  media contracts, channel renderers, and `OutputManifest`. A resolved
  manifest carries structural strategy provenance and the registry/revision/
  locale/entry identifiers used for copy; it deliberately never stores
  rendered text or interpolation values. It never writes, uploads, or deploys
  a consumer's files.

The dependencies point downstream only: surface depends on copy and UI;
strategy remains import-free from those packages. `StrategyProvenance` is a
structural payload at the surface boundary, so consumers do not gain a hidden
runtime dependency when attaching it.

## Authoring a new route or non-web output

1. Register or update governed strategy records. Use only approved claims
   when authoring audience-facing language, then derive a
   `StrategyProvenance` payload from the records that informed the output.
2. Add approved entries to one locale-specific `CopyRegistry`; run the voice
   and traceability checks. Surface documents refer to those entries with
   `CopyRef`s, including metadata such as titles, descriptions, email
   subjects, alt text, and slide notes.
3. Assemble an existing UI primitive, block, shell, or a surface-owned web
   view into a `SurfaceDocument`. Use a flowed layout for web/email and a
   canvas layout only for image, print, or slides.
4. At the consumer boundary, call `resolveSurfaceDocument` with
   `createCopyResolver(registry)`. It validates the document and fails closed
   if required copy is missing, draft, retired, locale-incompatible, or has
   invalid interpolation values.
5. Pass the resulting renderer-facing document to the channel renderer, then
   call `createResolvedOutputManifest` with the resolution, rendered artifact
   paths, and structural strategy provenance. The manifest records which copy
   registry revision and entry identifiers contributed to the output, without
   storing its text or interpolation values. The consumer route, build, mail
   provider, asset store, or deployment adapter owns the final write or
   publish action.

This makes every new audience-facing page or file follow the same governed
path without forcing a web route to pretend it is an email, image, or slide.
New work authors `SurfaceDocument` directly; the renderer-facing
`ComposeDocument` is produced only after copy resolution.

### The consumer boundary in code

The following is the complete shape of a consumer-owned web build adapter.
`strategy`, `registry`, and `surface` are consumer-authored, previously
validated values; the adapter returns data for that consumer's own filesystem
or deployment layer rather than making this library write anywhere.

```ts
import { createCopyResolver, type CopyRegistry } from "@vespeneventures/copy";
import { createStrategyProvenance, type StrategyContract } from "@vespeneventures/strategy";
import {
  createResolvedOutputManifest,
  resolveSurfaceDocument,
  type SurfaceDocument,
} from "@vespeneventures/surface/core";
import { renderWebDocument } from "@vespeneventures/surface/web";
import { renderToStaticMarkup } from "react-dom/server";

function buildRoute(
  surface: SurfaceDocument,
  registry: CopyRegistry,
  strategy: StrategyContract,
  recordsUsedByThisRoute: readonly string[],
) {
  const resolved = resolveSurfaceDocument(surface, createCopyResolver(registry));
  const rendered = renderWebDocument(resolved.document);
  const html = renderToStaticMarkup(rendered.element);
  const strategyProvenance = createStrategyProvenance(strategy, recordsUsedByThisRoute);

  return {
    html,
    manifest: createResolvedOutputManifest(
      surface,
      resolved,
      [{ id: "page", path: "site/example.html", mediaType: "text/html", role: "page" }],
      strategyProvenance,
    ),
  };
}
```

If copy resolution or surface validation fails, `buildRoute` throws before it
returns an artifact or manifest. A consumer publisher should only write the
returned output after that boundary succeeds.

## Consumer integration checklist

- Install compatible releases of `strategy`, `copy`, `ui`, and `surface` from
  the configured registry. `surface`'s own `package.json` pins
  `@vespeneventures/copy` and `@vespeneventures/ui` with patch-only tilde
  ranges (`~0.3.0` and `~0.7.0`) — this is a real version-coupling constraint
  in the dependency graph, not an install-ordering concern (a package manager
  resolves the whole graph regardless of the order packages are requested
  in). A consumer whose own policy is to pin exact versions must pin `copy`
  to a `0.3.x` patch and `ui` to a `0.7.x` patch that satisfy those ranges,
  or npm/pnpm/yarn will report an unresolvable version conflict when
  installing `surface`.
- Replace former token imports/CSS paths with the `ui` token subpaths; replace
  former voice imports with `copy` or `copy/voice`.
- Move page-level view imports to `surface/web`; keep reusable primitives in
  `ui`.
- Author `SurfaceDocument` records with consumer-owned `CopyRef`s. Existing
  literal-bearing documents must be converted by the consumer before entering
  this pipeline; Foundry does not invent copy identifiers or retain a legacy
  migration API.
- Add a consumer adapter that maps its own route/build conventions to a
  resolved `OutputManifest`, retaining its strategy and copy provenance; do
  not let Foundry acquire those filesystem or deployment concerns.
- Verify a real representative web output and at least one non-web output,
  then make the consumer's route/build test assert that unresolved copy cannot
  publish.

Foundry's product-neutral reference test exercises this path across web,
email, image, print, and slides. Consumer repositories remain responsible for
their own first-run fixtures and deployment credentials.
