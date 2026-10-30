# Consumer migration guide

Draft guidance for the current Designer, Publisher and Producer source contracts.
Check the exports and declarations in the exact installed artifacts before
changing a consumer. A source commit, a tarball integrity and a lockfile identify
a candidate; a version string alone does not distinguish unpublished builds.

## Import and rendering changes

| Existing use | Migration |
| --- | --- |
| `LandingView` from `@clossys/publisher/web` | Author `SectionedViewDocument` data, resolve its CopyRefs, and render `SectionedView`. |
| Designer `LandingView` or `ServerLandingView` | Use the supported document renderer, or the documented native frame/section composition for that page. |
| `@clossys/designer/atoms` | Import the required exported members from `@clossys/designer/components`. |
| `@clossys/designer/atoms/server` | Import server-safe members from `@clossys/designer/components/server`. |
| `shell.header.placement` | Use `shell.header.position`: `sticky` or `static`. |
| `shell.nav.tone` | Configure header ink through `shell.header.tone`: `base` or `inverse`. |

The component migration preserves the server/client boundary. For example,
interactive `Button` and `Menu` imports belong in client modules; the server
entry exports `buttonLinkClassName`, `Link` and `SemanticContent`. Check each
member rather than replacing every import with the interactive barrel. The
[Designer export map](../packages/designer/package.json) and
[server entry](../packages/designer/src/components/server.ts) are the authority.

```tsx
"use client";
import { Button, Menu } from "@clossys/designer/components";
```

In a separate server module:

```tsx
import { buttonLinkClassName } from "@clossys/designer/components/server";
```

The page-renderer migration changes the input model as well as the import.
Move page sections and closing content into the document, retain Writer copy
references, and resolve them before rendering:

```tsx
import type { CopyResolver } from "@clossys/writer";
import {
  resolveSectionedViewDocument,
  type SectionedViewDocument,
} from "@clossys/publisher/core";
import { SectionedView } from "@clossys/publisher/web";

export function PageBody({ document, resolveCopy }: {
  document: SectionedViewDocument;
  resolveCopy: CopyResolver;
}) {
  const resolved = resolveSectionedViewDocument(document, resolveCopy);
  return <SectionedView document={resolved} landmark="none" />;
}
```

This example is a body inside an existing `SiteFrame`, which owns the main
landmark. A standalone `SectionedView` uses its default main landmark. Keep the
resolved document's `resolutions` for publication provenance. Writer preview
resolution can return a draft with `status: "draft"`. A site that requires
approved copy must retain that host boundary while preserving native stale
and production-approval checks. See the
[document examples](../packages/publisher/README.md#prose-recipe-example) and
[retired-renderer contract](../packages/publisher/README.md#retired-landingview-value).
The retired renderer's props are not an adapter for document data.

## Header and navigation data

Use the [SiteShellInput declaration](../packages/designer/src/frames/site-frame/types.ts)
to update frame data and its assertions together. Header position, plate and
ink are separate choices:

```json
{
  "header": { "position": "sticky", "surface": "solid", "tone": "base" },
  "navPlacement": "leading"
}
```

`header.surface` accepts `solid`, `transparent` or `glass`. Navigation retains
its label, trigger/close labels and links; it has no `tone` property. Verify the
result against the page ground in both themes. `footer.placement` remains the
separate `flow`/`overlay` footer setting; keep it when migrating header fields.

## Footer data and behavior

The [footer contract](../packages/designer/src/frames/site-frame/site-frame-contract.ts)
counts `footer.links`, `footer.legal.links` and the explicit privacy control
together: at most five flat links.
Move further destinations into labelled `footer.columns`. The frame throws
`SiteFooterContractError` for invalid inputs instead of truncating them.

```tsx
import type { SiteFooterInput } from "@clossys/designer/frames";

const footer = {
  columns: [{
    heading: { id: "footer.resources" },
    links: [{ href: "/guides", label: { id: "footer.guides" } }],
  }],
  legal: {
    entity: { id: "footer.entity" },
    links: [
      { href: "/privacy", label: { id: "footer.privacy" } },
      { href: "/terms", label: { id: "footer.terms" } },
    ],
  },
} satisfies SiteFooterInput;
```

Supply those copy records through the existing resolver. Validate the complete
shell: generic footer links exclude home, header-navigation duplicates and
the reserved `#privacy-choices` control. When the installed frame exposes
`footer.privacyChoices`, bind its `label` CopyRef there. That label-only port
resolves host copy through the supplied resolver and renders the fixed hash target;
the host retains consent state and dialog behavior. It counts toward the flat
link limit. Social links have four icon slots; the brand mark occupies the
fifth. Preserve required destinations and consent behavior when
regrouping. A required behavior that the current frame cannot express remains
an interface gap to resolve before adoption.

## Producer root and command effects

Producer discovers the nearest ancestor containing `clossys/clossys.config.ts`.
`--root` chooses the directory where that search starts. Discovery locates the
file without evaluating its contents. Establish the consumer's native root and
agent inputs through its setup flow before checking Studio.

```sh
clossys --help
clossys produce --root . --check --json
```

A missing root exits `2` before compilation or server startup. Root discovery
alone does not establish active cells, compiled projections or a working
Designer selection. Check those inputs and the rendered application separately.

| Command | Can write compiled consumer projections | Starts Studio |
| --- | --- | --- |
| `clossys --help` | No | No |
| `clossys produce --check` | No | No |
| `clossys produce --once` | Yes | No |
| `clossys produce --no-open` | Yes | Yes |

`--no-open` only disables browser opening. Normal `produce` writes Designer
and Writer projections below `clossys/agents/<agent>/compiled` before serving.
See [Producer](../packages/producer/README.md) and its
[root discovery](../packages/producer/src/cli/root.ts) and
[produce implementation](../packages/producer/src/cli/produce.ts).

## Rehearse with exact artifacts

1. Record the consumer's baseline source, lockfile, toolchain, focused tests,
   typecheck and build. Preserve its package versions and original files.
2. Pack one immutable candidate with Producer's native helper:
   `node packages/producer/scripts/pack-five.mjs --out-dir ../candidate-packages`.
   Use a fresh output directory. Retain `summary.json`; require clean source
   (`source.dirty: false`), five matching integrities and complete standalone
   Studio output (`complete: true`). Controller is built as a prerequisite
   but is not one of these five tarballs.
3. Install the exact tarballs with the consumer's pinned package manager.
   Verify both direct and transitive selected packages resolve to those bytes.
   Record other dependency changes; preserve a comparable test harness.
4. Run the consumer's focused render tests, typecheck and build again. Check
   frame input errors as well as missing exports. A successful install or an
   HTTP response does not prove the page rendered.
5. Validate the rendered frame, page content, interaction, console and package
   identities. Keep unresolved steps explicit, and retain a reversible patch
   and original lockfile for rollback.

A filtered frozen install can succeed while a later shared-lock update still
needs metadata for unrelated workspace dependencies. A site-local rehearsal
lock measures that isolated graph; record its resolution differences and run
the real shared-lock path separately. Keep private-package authorization and
baseline font-fetch failures separate from candidate API failures.

If bootstrap cannot enable a global package-manager shim, use the repository's
approved project toolchain, such as `corepack pnpm` with its declared pin.
Nested scripts must use the same version. A toolchain-only readiness check
does not establish that dependencies installed or that a build passed.
