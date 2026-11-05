# apps/site template

A Next App Router project with no hand-written route: `npm run publish:site` (also run before `dev` and `build`) is `clossys publish --install --site site --next app --bind`, which writes every `app/**` route file and the `clossys/` assembly, states and page modules from the consumer's pinned `publication.site` records (frame and sections from Designer pins, copy from Writer keys).
Copied into a consumer's `apps/site` by `publisher-site-instantiate`; it is not built inside Foundry. Reinstall rather than editing a generated file.
Checked by `npm run check:route-parity -w @clossys/producer -- --surface site-template` and `check:routes-published -- --surface site-template`.
Notes: clossys.com/docs.
