# Receipted agent-command fixture

`agent-receipted/` is generated synthetic test data, using `seedLibrary` from
`agent-library.ts`. That helper starts with the existing completed catalog test
fixture, emits through the protected writer, then authors an explicit blur value
through `writeLibrary`. Its receipts retain the real generated manifest and write
history. The many generated JSON/CSS lines are not additional runtime behavior.
The fixture intentionally has a different current value from Foundry's blur fill,
so the required reselect dry run exercises an actual source change. No command
under test may change its bytes without `--write`.
