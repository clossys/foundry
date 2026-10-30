# Studio no-handrolling check

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

The runner covers Home, all four agent routes, and Apps, plus opened command
menus, selected-cell, empty, and API-error states. On each route it proves that unstamped descendants
of an existing Designer leaf pass, bare text passes, and both visible and hidden
unstamped body siblings fail. It does not add leaf stamps for those proofs.

DOM ancestry alone cannot distinguish a host-authored tree inside AppFrame from
Designer-authored content: both are within an existing leaf subtree. The separate
TypeScript AST rule therefore rejects host-authored `nav`, `ul`, and `li` JSX in
`CellsWorkspace.tsx`, where cell navigation must use Designer composition. Its
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
