# Marketing reference rehearsal

This fictional Example Co. consumer exercises installed Designer, Writer, and
Publisher tarballs. It is outside the workspace and excluded by Publisher's
explicit package file list. The rehearsal also asserts the packed inventories
contain no `test-fixtures` paths.

Build the native Designer, Writer, and Publisher packages and their Strategist
and Controller runtime prerequisites first.
From the repository root, run `npm run rehearse:marketing`. The script packs
the three packages and those two runtime dependencies with their existing build
outputs, copies this fixture
to a temporary directory, installs the tarballs and existing runtime peers,
builds the site, starts a loopback server, and checks every declared page plus
the redirect, 404, robots, sitemap, security contact, and stylesheet. Each HTML
response must contain exactly one primary heading. The server and temporary
directory are removed even after a failed check.

`publication.json` owns the page inventory and redirect. Publisher projects
the public protocols and renders the marketing surfaces; Writer resolves the
fixture's generic copy; Designer supplies the components and generated CSS.
The static host is deliberately local. This rehearsal does not deploy a site
or certify the fixture's example legal copy for production.

The direct server and probe failure cases run with
`node --test scripts/marketing-reference-rehearsal.test.mjs`.

This fictional Example Co. consumer renders native Publisher SectionedView pages
and public Designer blocks using actual, unapproved native Writer passages. The
21 routes and their selected families are listed in `capture-manifest.json`.
Unavailable passage, asset and record-count inputs are listed as gaps rather
than placeholder pages. Generic proof quotes are draft examples, not customer
evidence. Contact is a disabled static preview without a submission service.

After building the native packages, run:

```sh
node scripts/marketing-reference-rehearsal.mjs --fixture packages/publisher/test-fixtures/marketing-reference/admitted-fixture.mjs --out work/marketing-reference-rehearsal
```

Every route has 24 explicit cases: light, dark and inverse; 1440 and 390 pixels;
LTR and RTL; motion allowed and reduced. RTL uses the existing English draft
records and does not claim translation. Inverse selects actual section ground;
dark selects the authored token theme. The body consumes native base-surface and
primary-ink utilities; the root also sets the matching native color scheme. The DOM probe checks exactly one h1,
decorative backdrop attributes, visible text and accessible names against real
Writer resolutions. FAQ uses the public block's supported one-row input; it
does not qualify the separate runtime adapter's four-to-six-row policy.

For actual full-page WebP captures, start local Chromium and supply the included
dependency-free CDP driver:

```sh
chromium --headless --remote-debugging-port=9431 about:blank
node scripts/marketing-reference-rehearsal.mjs --fixture packages/publisher/test-fixtures/marketing-reference/admitted-fixture.mjs --out work/marketing-reference-captures --driver packages/publisher/test-fixtures/marketing-reference/chromium-driver.mjs
```

The driver verifies viewport width, document direction, primary-heading count
and the browser's emulated reduced-motion preference. Capture reports record
actual image hashes, fixture and driver hashes, and Chromium version. Without
a driver, capture status is explicitly `not-run`. Images and HTML remain outside
the fixture. Static captures do not claim hydrated interactions, animation,
keyboard conformance or full accessibility qualification.

The installed-tarball rehearsal serves every available native family route,
checks its DOM copy against Writer resolutions, and preserves the real HTTP
checks for 404, redirect, robots, sitemap, security contact and CSS. All three
native packages build cleanly on the recorded integration baseline.

Known visible limit: the unbound native token root displays its CSS-generated
“No brand binding” debug badge. The DOM copy probe does not inspect CSS-generated
text. Theme selection does not establish brand binding. Draft evidence and exact
merged inputs are recorded in `evidence.json`; `capture-report.json` pins all 504 real image hashes.
