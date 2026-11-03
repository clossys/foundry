# Studio focused checks

## Publisher Studio map

```sh
node packages/producer/scripts/generate-studio-map.mjs --check
node --test packages/producer/studio/checks/check-studio-map.test.cjs
node packages/producer/studio/checks/check-studio-map.cjs
```

The map check reads the pinned Foundry Publisher slots under
`clossys/agents/publisher` (`publication.studio` and its `page.*` slots),
projects their content map and route pack, and regenerates the Studio
projection in memory to compare exact output bytes. Re-pinning a page without
regenerating fails. Navigation, command
search, breadcrumbs and routes are projections of that one publication map.
`lib/studio-route-map.ts` adds the record-store leaves to it at runtime
(`studioRuntimeMap`) and builds the frame inputs with Publisher's
`projectNavigation`, `projectCommands` and `projectBreadcrumbs`. The generic
renderer (`components/StudioPage.tsx`) must hand the pinned `frames.studio-shell`
those inputs only by spreading `studioShellProjection(...)`; explicit
`navigation`/`commands`/`breadcrumbs`/`homeHref` attributes or a hand-authored
`{ id, label }` node fail.

The source rule parses TypeScript/JavaScript ASTs throughout the Studio source
the App Router entries actually reach (the relative-import graph from `app/`),
including sections and frames. Executable root route strings, template route
prefixes and literal navigation destinations fail outside Publisher's exact
`generated/studio-map.ts` and the runtime map module `lib/studio-route-map.ts`. An unused
duplicate route array still fails. Internal `/api/` data paths, asset URLs,
path-delimiter operations and query/fragment cell or Source state are distinct
from Studio page routes. An API or asset literal used as a navigation
destination still fails. Comments, prose strings containing route examples and
regular expressions are parsed according to their AST role, rather than scanned
for route words.

This production source check excludes `checks/`, test/spec files, static public
assets, dependencies and Next output. Browser fixture route lists in the existing
focused checks are synthetic test inputs, outside this production navigation
contract. The direct tests prove the real checked-in projection passes, an
inserted redundant route list fails, replacing a projected frame input fails,
and changing an ordinary page cell without regenerating produces projection
drift. `studio-navigation.test.cjs` renders the frame for every runtime-map
entry and proves every rendered link, command and breadcrumb is a map path.
The check is scoped to Studio's publication seam; it does not modify or
replace repository-wide scanners.

## No page JSX

```sh
node --test packages/producer/studio/checks/check-no-page-jsx.test.cjs
node packages/producer/studio/checks/check-no-page-jsx.cjs
```

Every Studio page is a Publisher assembly (frame + ordered sections + bindings)
rendered by the one generic renderer, `components/StudioPage.tsx`. `app/` may
hold only `layout.tsx`, `globals.css` and the route files Publisher installs (they mount
`components/StudioInstalledPage.tsx`, which hands the page to the renderer).
Those files may render only the document shell, `StudioProviders` and
`StudioPage`. Any other app file, page JSX (fragments included), an import of a
section, frame, old view or binding module into `app/`, an installed route or
assembly that stops handing the page to the renderer, or a parked `views/`
folder fails. The tests
mutate a copy of the tree for each rule.

## Studio routes

```sh
node --test packages/producer/studio/checks/check-studio-routes.test.cjs
node packages/producer/studio/checks/check-studio-routes.cjs
```

Studio is published by Foundry's own Publisher: every page entry of the
`publication.studio` content map, expanded through each agent's `ia.json` into
one tab page per IA group, is a `page.tsx` under `app/`, and every tab with a
leaf template is a dynamic `[slug]/page.tsx`, both
installed by `clossys publish --install --next` (first line is Publisher's
route marker). The installed files are committed; the producer build
(`scripts/generate-studio-map.mjs`) reinstalls them the same way it
regenerates `generated/`, and the Studio Next build serves the committed files. The
check fails when a map page or leaf template has no installed file, when its
file lost the marker, or when `app/` holds any other route file. There is no
exemption: the Producer server serves `/__specimen` itself.
The tests mutate a copy of the tree and the publication for each rule.

## Rendered map and sections (DOM)

```sh
node packages/producer/studio/checks/studio-dom-check.mjs http://127.0.0.1:4641 --out report.json
```

Loads the runtime map the way Studio does (its own loaders against the live
Producer APIs), then visits every entry in headless Chrome over raw CDP. Each
entry must return 200, render the frame and a heading without an error or
not-found state, show no "No specimen" text, link only to map paths, and render
Options, History, Checks and References whenever the leaf's data has them. On
Home it opens the command menu and requires one item per map entry. Chrome is
read from `/Applications/Google Chrome.app` (override with `CHROME_PATH`).

## Designer composition

Run against a production Studio server after building Designer and Studio:

```sh
node --test packages/producer/studio/checks/check-no-handrolling.test.cjs
node packages/producer/studio/checks/check-no-handrolling.cjs http://127.0.0.1:4301
```

The runner needs Playwright available to Node and Chromium at `CHROMIUM_PATH`
(default `/usr/bin/chromium`). It launches headless Chromium with `--no-sandbox`.
Its HTTP cell fixtures are installed through browser interception; no consumer
repository or private fixture path is required.

The DOM rule checks every element beneath `body`, including open shadow roots.
Each application element must be a Designer leaf root (`data-ds-leaf`) or a
descendant of one. Text and comment nodes are not elements. Document containers
(`html`, `head`, `body`) are outside this application check; a document-level
leaf stamp does not cover body children. An unstamped wrapper around a stamped
child fails. Hidden application elements receive the same check as visible ones.

The only framework exceptions are narrowly recognized direct-body Next static
runtime scripts, Flight/bootstrap scripts, React's empty hidden suspense comment
boundary, Next's hydrated empty metadata boundary, and Next's route announcer
with its specific single shadow alert. The hydrated metadata state must be a
direct-body, hidden-only, empty div whose actual React host Fiber has the
immediate framework owner `__next_metadata_boundary__`; hidden application
nodes without that owner still fail.
Their descendants are still visited. There is no blanket script, hidden,
custom-element, class-name, or framework-wrapper exemption. Development overlay
elements fail; use a production server.

The runner covers Home and all four agent routes, plus opened command
menus, selected-cell, empty, and API-error states. On each route it proves that unstamped descendants
of an existing Designer leaf pass, bare text passes, and both visible and hidden
unstamped body siblings fail. It does not add leaf stamps for those proofs.

DOM ancestry alone cannot distinguish a host-authored tree inside AppFrame from
Designer-authored content: both are within an existing leaf subtree. The separate
TypeScript AST rule therefore rejects host-authored `nav`, `ul`, and `li` JSX in
`components/StudioPage.tsx`, where cell navigation must use Designer composition. Its
tests include a mutation from Designer composition to raw navigation/list JSX.
This focused rule does not claim to prohibit all raw JSX or validate leaf
registration or provenance; those remain separate contracts.

## Rendered consumer selection

Cell fixtures include original frontmatter and body text. Each cell must begin
with Source closed, expose its complete raw text only after the selected
Disclosure trigger opens, and hide it again when Source closes. The runner
checks that the raw text belongs to `components.disclosure` and that selecting a
different cell resets Source to closed.

The same runner also compares every rendered `data-ds-leaf` and `data-ds-fill`
with Producer's compiled `/api/config` selection and checks the live selection
hash. A missing consumer leaf may use its compiled Designer default only with a
per-leaf `NEED` on the Designer page. Unknown rendered leaves, stale fill stamps,
unavailable selected fills, or a fallback without its `NEED` fail.

Every React Aria element (`data-rac` or `data-rac-*`) must have a component leaf
ancestor; a frame or section ancestor alone is insufficient. Each route proves
both checks reject mutations by changing an existing fill stamp and inserting
an unowned React Aria element inside the existing frame. These proofs preserve
the original subtree coverage and framework checks.

## Applied consumer theme

Run against the public origins of two production Studio builds, each served
through its Producer listener:

```sh
node --test packages/producer/studio/checks/check-theme-parity.test.cjs
node packages/producer/studio/checks/check-theme-parity.cjs http://127.0.0.1:4301 http://127.0.0.1:4302
node packages/producer/studio/checks/check-theme-parity.cjs --require-different http://127.0.0.1:4301 http://127.0.0.1:4302
```

Each origin is checked against its own consumer's `/api/config`; two consumers
can have different brands. The runner uses Playwright and Chromium with the
same setup as the DOM check above. It independently hashes the exact UTF-8
compiled CSS with SHA-256, then verifies the declared `theme.hash`, the live
root's `data-theme-hash`, and the enabled `studio-brand-theme` stylesheet bytes
after hydration. It compares live computed token properties with the same CSS
applied in an isolated browser document, detecting overriding styles even when
hash stamps and stylesheet bytes match. A default theme requires a visible
Designer unbranded notice. Missing binding, failed compilation, stale hashes,
and overridden or altered CSS fail. `--require-different` additionally requires
distinct consumer theme hashes for a two-brand fixture proof; it does not
require unrelated consumers to share a brand.

The tests serve two synthetic brands over local HTTP and check them in a real
browser. They accept different brands and client application after initial
default CSS, and reject a live token override despite matching hash stamps and
stylesheet bytes. This check does not verify font asset delivery or replace
the Designer token checks.

## Selected utility CSS

```sh
cd packages/producer
npx vitest run src/server/selection-css.test.ts
```

Producer compiles CSS from the actual emitted selected source strings with
Designer's existing Tailwind generator. It includes the official foundation
and shipped package utility candidates, plus arbitrary selected variants and
values, then supplies the CSS and its SHA-256 hash in the selection response.
Studio verifies that hash and applies the stylesheet in the same React commit
as the selected runtime. It imports no separate default token or utility CSS.

The focused test renders a synthetic selected utility in Chromium: its width
changes to 137 pixels only when the generated stylesheet is applied, and its
descendant variant changes the label's computed weight. A companion case
omits that selected candidate and verifies the rule is absent. Playwright and
Chromium use the same setup as the checks above.
