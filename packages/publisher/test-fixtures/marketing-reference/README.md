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
