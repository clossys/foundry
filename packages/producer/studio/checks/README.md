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
boundary, and Next's route announcer with its specific single shadow alert.
Their descendants are still visited. There is no blanket script, hidden,
custom-element, class-name, or framework-wrapper exemption. Development overlay
elements fail; use a production server.

The runner covers Home, all four agent routes, and Apps, plus selected-cell,
empty, and API-error states. On each route it proves that unstamped descendants
of an existing Designer leaf pass, bare text passes, and both visible and hidden
unstamped body siblings fail. It does not add leaf stamps for those proofs.

DOM ancestry alone cannot distinguish a host-authored tree inside AppFrame from
Designer-authored content: both are within an existing leaf subtree. The separate
TypeScript AST rule therefore rejects host-authored `nav`, `ul`, and `li` JSX in
`CellsWorkspace.tsx`, where cell navigation must use Designer composition. Its
tests include a mutation from Designer composition to raw navigation/list JSX.
This focused rule does not claim to prohibit all raw JSX or validate leaf
registration or provenance; those remain separate contracts.

## Compiled theme parity

Run against the public origins of two production Studio builds, each served
through its Producer listener:

```sh
node --test packages/producer/studio/checks/check-theme-parity.test.cjs
node packages/producer/studio/checks/check-theme-parity.cjs http://127.0.0.1:4301 http://127.0.0.1:4302
```

The first origin is Foundry Studio and the second is the product Studio. The
check independently hashes the exact UTF-8 compiled CSS from each `/api/config`
response with SHA-256. It verifies the declared `theme.hash`, the built HTML
root's `data-theme-hash`, and the actual `studio-brand-theme` stylesheet bytes,
then requires both builds to match. Missing brand binding, failed compilation,
stale builds, and altered stylesheet bytes fail. Compiler provenance headers
are disabled before emission so consumer identities do not affect the hash.
This check compares compiled token CSS; it does not verify font asset delivery
or replace the Designer token checks.

The dependency-free Node tests serve two local HTTP fixtures. Identical CSS
passes across Foundry and adopted consumer sources; a product token mutation
fails even when its own API and built HTML remain internally consistent.
