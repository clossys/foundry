# Receipt BR-E2E6: Publisher install follows a composition's pinned meta.source.parts

- Branch: claude/r2f-0048-br-e2e6 at 445623ec0f578aa78f6e12dbc4b55a9fb785e8de (base claude/r2f-int2 a50a6cb78, merged at ec8d7291f with no conflicts)
- Serving model: claude-opus-5-5 (session_context.model and last_served_model)
- tier-outcome: mid, BLOCKED-D5

## Change
- e4eebd222 (earlier run, still applies as-is): packages/publisher/src/install/index.ts, 3 lines. After the registryDependencies loop, each `meta.source.parts[].slot` of a composition that has a pin goes through the same `visit(slot, "dependency", id)`; `done` deduplicates. Plus one test in install.test.ts.
- 445623ec0 (planner addition): packages/producer/src/check/e2e.test.ts title test now reads the title under record id `title` in the page.home.meta Writer file (e2e/home-meta.md), not the whole `page.home.meta#title` ref in site.md. It asserts the same title text, "Plain Studio home".

## Validation
- `npm run typecheck -w @clossys/publisher`: exit 0.
- `npm exec -w @clossys/publisher -- vitest run src/install`: exit 1, 2 failed, 144 passed, 1 skipped. Base int2 shows the same 2 failures (2 failed, 143 passed): both base red, nothing new.
  - page-host.test.ts > Publisher page host > renders a Designer SiteFrame page inside PublisherHost fed by the consumer's selection module (Cannot find module '../data/patch.json')
  - page-host.test.ts > installs a frame plus three section instances into a fixture Next app that builds (NEED component selection: components.button)
- New test `installs a composition's pinned meta.source.parts slot once, even when a registry dependency already names it`: passes.
- Producer e2e.test.ts: 30/30 pass (the title test was the 1 failure before).
- `npm run check:e2e -w @clossys/producer`: exit 1, but at `craft.hero-copy.submit`, before `build`, so the e2e never gets to `build`. Base int2 reds at the same step:
  `next --submit refused: submit refused by the constitution guard: R05.1 [requirement] copy.voice-derived: sections.hero.copy: the frontmatter has no provenance; provenance.voice must name director:identity.verbal.voice`
  Cause: e2e/hero-copy.md and e2e/home-meta.md (from BR-E2E4, 20d000594) have no `provenance` frontmatter, which c36b54d4f (U-VOICE-PROV) requires. site.md has it. I did not fix this: it is outside this spec.
- The runner has no list-all-reds mode (it stops at the first red), so render, repeat, release.manifest, release.gates and portable never run and I have no message for them.
- Probe only, not committed and reverted (cmp identical): I added `provenance: {"voice":"director:identity.verbal.voice"}` to both fixtures. Then:
  - with the change: `build` gets past the separator and fails at a new error: `Could not resolve "../../../../node_modules/@clossys/producer/e2e/component-selection" (clossys/publisher-host.tsx)`
  - mutation (parts line removed, publisher rebuilt): `build` shows `Could not resolve "@/components/ui/separator" (components/frames/site-shell.tsx)` again, next to the component-selection error.
- Unit mutation: with the parts line removed, the new test fails (1 failed, 27 passed). After restoring, `cmp` shows the file identical to the original and the tests pass 28/28. Publisher and producer were rebuilt from the restored source.
- `git merge-tree --write-tree origin/claude/r2f-int2 HEAD`: exit 0.
- No receipts/ directory on the branch.

## BLOCKED-D5 options
- A: fix the fixtures with the Writer verb path. Resubmit hero-copy.md and home-meta.md with `provenance.voice` so `craft.hero-copy.submit` and `craft.home-meta.submit` pass. Expected next red: `build` on the component-selection resolve shown above.
- B: then deal with the component-selection import that the publisher host resolves relative to the consumer's node_modules (`--selection` path under node_modules/@clossys/producer/e2e). This is a separate unit.

BLOCKED: check:e2e reds at craft.hero-copy.submit (base red, missing provenance.voice, R05.1) before build; with the fixtures probed, the separator error is gone and build reds on component-selection resolve
