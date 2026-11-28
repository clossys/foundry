# CP1-RENDERCHECK report

Unit branch: `claude/r2f-0048-cp1-rendercheck` at `2f68e382de03804f9e7fbe91f1ef022e8c566a8c` (pushed as a fast-forward, no PR).

## Base

| step | sha | result |
|---|---|---|
| branch from `claude/r2f-int2` | e8deb2e7391eb29276aaa7500957697f9fc72d3c | `git cat-file -e` ok |
| merge `claude/r2f-0048-cp1-reviewqueue` | 613f4697a03ca533b593402cfa60f6ef167657b6 | merge commit 421d4eced; one conflict in `packages/producer/src/cli/args.ts` (USAGE), resolved by keeping both sides: the `FAST_USAGE` line from reviewqueue and the stricter record-suites wording from int2 |
| merge `claude/r2f-0048-cp1-factory0` | 009240d0023b3d05b893d9aefe9d4bc66642f059 | merge commit 6c4522bac, no conflict |
| unit commit | 2f68e382d | the work below |

No generated fixture was involved in either merge.

## Preflight (all exit 0)

- `git remote get-url origin` -> the clossys/foundry GitHub remote
- `git fetch origin claude/r2f-int2 claude/r2f-0048-cp1-reviewqueue claude/r2f-0048-cp1-factory0` -> 0; all three Base shas resolve with `git cat-file -e <sha>^{commit}`
- `git push --dry-run origin HEAD:refs/heads/claude/r2f-0048-cp1-rendercheck` -> 0 (and the `-report` branch -> 0)
- `node -v` v22.23.5, `npm -v` 10.9.9, `npm ci` -> 0 (19s)
- `npm run agent:cloud:bootstrap` -> 0 (24s), `npm run agent:cloud:check` -> 0

## What was built

- **(a) Verb.** `clossys check --render [--routes <file>] [--json] [--file] [--out <dir>] [--browser <path>] [--root <dir>]` (`packages/producer/src/cli/render-check.ts`, dispatched from `pipeline/runner.ts`, documented in `check --help`). Routes come from a `clossys.render-routes/1` file (`site`: a built static folder; `origin`: a loopback server; `preview`: the file `clossys preview` now writes beside its build, served with the existing preview server) or, by default, the newest preview build. Each route is captured in Chromium at 1280x800 and 375x812.
- **How the audit works.** `check/render-audit.ts`: `measureRender` runs in the browser and writes layout facts onto the elements (`data-render-box`, `-hidden`, `-clips`, `-spill`, `-paint`, `-viewport`). That HTML is saved as the capture. `auditRender` reads only the document and those marks, so a saved capture re-audits to the same findings without a browser. Rules: RENDER_EMPTY_ICON, RENDER_GLYPH (U+FFFD, private-use code points, escaped entities shown as text), RENDER_NO_NAME, RENDER_OVERFLOW (blamed on the element that runs past the viewport, not its container), RENDER_COPY_UNKEYED / RENDER_COPY_UNRESOLVED (Writer `data-copy` keys), RENDER_SLOT_UNATTRIBUTED, RENDER_NOT_CAPTURED.
- **(b) Fails closed.** `RENDER: FAIL` with reason `no-routes` (no route, or zero captures), `no-browser`, `no-build`, `capture-error` or `findings`. It never passes on nothing.
- **(c) Requests.** Every finding carries `slot` (the nearest `data-slot="<agent>/<slot>"`; shadcn parts such as `data-slot="button"` are skipped) and `agent` (Writer for copy, the slot's agent otherwise, publisher when no slot owns it). `--file` files one request per owning slot through `clossys request`: `--kind fix --check check.render` to a placed slot's agent, else `--kind report --about agent/<agent>`.
- **Record.** `clossys.render-check/1`, the same shape as the REVIEWQUEUE verdict records (`verdict`, `ran.commands`/`ran.missing`, `findings`, last `line`).
- **(d) Rule and skill.** `R-RENDER-AUDIT`, `owner_agent: reviewer`, check `.#check:render-audit` (`scripts/check-render-audit.mjs` plus its node test), run from `@clossys/reviewer`'s `test` the same way the REVIEWQUEUE checks are. It has 3 violation fixtures (a skill without the rule, a PASS that captured nothing, a finding with no slot). `packages/reviewer/skill/SKILL.md` states the rule and lists R-RENDER-AUDIT in its owned rules.

## (e) Parity: NOT met against the harness

The packet says the launch prompt attaches 3 recorded page audits from `bin/visual-capture/` (saved HTML plus the harness's findings). **They were not attached.** Nothing like them is in the repository, and the packet forbids reading outside it. So `packages/producer/src/check/__fixtures__/render-parity/{clean,icon-name,overflow}/` holds **stand-ins written by hand for this unit**: a clean page, an empty icon with a missing accessible name, and an overflow. Each `recorded.json` says `"recordedBy": "stand-in"`, and its expected findings were written from the markup, not produced by this verb. The test "render check matches the recorded audits" passes against these stand-ins only. That shows the verb agrees with a hand-derived audit. It does not show the verb agrees with what the harness recorded, and the harness's own rule names and blame may differ.

To close (e): replace each `capture.html` and the `findings` in each `recorded.json` with the scrubbed recordings (mapped to these rule ids, or the ids mapped to the harness's), then run `npx vitest run src/check/render-check.test.ts` in packages/producer.

## Live browser smoke (not a test; tests use saved HTML only)

No browser was installed. The preinstalled Chromium 1243 was used through `CHROMIUM_PATH`, from a scratch esbuild bundle (nothing tracked was built or written):

- Without CHROMIUM_PATH: `RENDER: FAIL 0/0 capture(s) 0 finding(s)`, reason `no-browser` (the repo's playwright expects headless-shell build 1248, which is absent). This is fail-closed behaving correctly on a real host.
- With CHROMIUM_PATH: stand-in pages with their marks stripped gave `RENDER: FAIL 6/6 capture(s) 4 finding(s)` (NO_NAME and EMPTY_ICON on the icon page at both widths). A page with real CSS overflow at 375px gave 2 RENDER_OVERFLOW findings: `> div` (right edge 516px) and `> a` (content wider than box).
- The live runs exposed two defects, both fixed before commit:
  1. An empty unsized svg lays out at 0x0 and was skipped as not shown.
  2. Overflow was blamed on the spilling `<section>` instead of its overrunning child.

  Both live captures are kept as fixtures (`__fixtures__/render-live/`) with a regression test.
- **BLOCKED-D5 note:** live capture needs Chromium. This cloud host has one, but the playwright version installed by the repo does not match it, so the default launch fails closed. Options: (1) pass `--browser <path>` or `CHROMIUM_PATH` (works today); (2) align the playwright pin with the host's browser; (3) run live capture only on the owner machine. No browser was installed.

## Validation (commands and exit codes)

| command | exit | time |
|---|---|---|
| `npm run build -w @clossys/director` / `controller` / `writer` / `designer` / `publisher` (deps of producer, package-scoped) | 0 each (an earlier out-of-order pass exited 2 for designer/writer/publisher on missing director/controller dist, then reran clean) | 2-22s; publisher ~10 min (client-boundary scan) |
| `npm run typecheck -w @clossys/producer` | 0 | 10s |
| `npm run typecheck -w @clossys/reviewer` | 0 | <5s |
| `npx vitest run src/check/render-check.test.ts` (packages/producer) | 0, 7/7 | 20s |
| `npm test -w @clossys/reviewer` (vitest 6/6, check:fast-before-review, check:review-fail-closed, check:render-audit) | 0 | 1s |
| `npm run check:render-audit` | 0 (node test 3/3 pass, 0 findings) | <1s |
| `node scripts/check-render-audit.mjs --root <each fixture> [--record ...]` | 1 each, `missing-rule` / `pass-on-nothing` / `unattributed-finding` | <1s |
| `node scripts/check-public-safety.mjs . --allow-changelogs` | 0, **PARTIAL** (no denylist in cloud; not a clearance) | |
| `node scripts/check-rules.mjs` | 1: 33 rules, 25 enforced, failing R-DS-ONLY, R-WRITER-COPY, R-DECISIONS-BY-CLI, R-PIPELINE-IS-CODE, R-ROUTES-PUBLISHED, R-PIN-PROPAGATION, R-EVERY-CANDIDATE-PREVIEWABLE, R-E2E-CONSUMER, plus 2 unmapped check:studio sub-checks. R-RENDER-AUDIT is not among them: its 3 fixture runs fail as required. A base run of check:rules was not measured. | 263s |
| `git merge-tree --write-tree origin/claude/r2f-int2 HEAD` | 0 | |
| `runFast({ base: 6c4522bac })` (`clossys check --fast` from source; see the note below) | **FAST PASS 2f68e382de03804f9e7fbe91f1ef022e8c566a8c**; typecheck 2 packages pass; 7 of 44 related units red, all 7 base-red | 269s |

The fast run was invoked from an esbuild bundle in a gitignored cache, because building producer's `dist` runs generators that rewrite tracked files. A first attempt bundled to another path and could not resolve its reporter. It reported `render-check.test.ts` "no result", which was an invocation artifact and is superseded by the PASS above.

### Related tests: new red

None.

### Related tests: base red (each also fails alone at base 6c4522bac)

- packages/producer/src/check/ref-verbatim-default.test.ts
- packages/producer/src/check/slot-resolve.test.ts
- packages/producer/src/cli/inline-gates.e2e.test.ts
- packages/producer/src/pipeline/chain.test.ts
- packages/producer/src/pipeline/interview.test.ts
- packages/producer/src/preview/preview.test.ts (this unit touches preview; this failure is "Writer copy is unresolved" and a 404, and is present at base)
- scripts/accept-unit.test.mjs

## Mutations (each failed a named test, restored, `cmp` identical)

| mutation | killed by |
|---|---|
| `renderVerdict`: zero captures returns PASS | "render check fails when zero routes are captured" |
| early `fail()`: reason no-routes becomes PASS | "render check fails when zero routes are captured" |
| `auditRender` add(): `slot: null` (drop the slot attribution) | "render check flags an empty icon with its slot", "render check flags a missing accessible name", "a finding files as a request to its owning agent", "render check matches the recorded audits" (+2 more) |

## Files touched (6c4522bac..2f68e382d)

- M	package.json
- A	packages/producer/src/check/__fixtures__/render-live/icon-name-375.html
- A	packages/producer/src/check/__fixtures__/render-live/wide-375.html
- A	packages/producer/src/check/__fixtures__/render-parity/clean/capture.html
- A	packages/producer/src/check/__fixtures__/render-parity/clean/recorded.json
- A	packages/producer/src/check/__fixtures__/render-parity/icon-name/capture.html
- A	packages/producer/src/check/__fixtures__/render-parity/icon-name/recorded.json
- A	packages/producer/src/check/__fixtures__/render-parity/overflow/capture.html
- A	packages/producer/src/check/__fixtures__/render-parity/overflow/recorded.json
- A	packages/producer/src/check/render-audit.ts
- A	packages/producer/src/check/render-check.test.ts
- A	packages/producer/src/check/render-check.ts
- M	packages/producer/src/cli/args.ts
- M	packages/producer/src/cli/preview.ts
- A	packages/producer/src/cli/render-check-usage.ts
- A	packages/producer/src/cli/render-check.ts
- M	packages/producer/src/pipeline/runner.ts
- M	packages/producer/src/preview/serve.ts
- M	packages/reviewer/package.json
- M	packages/reviewer/skill/SKILL.md
- A	scripts/check-render-audit.mjs
- A	scripts/check-render-audit.test.mjs
- A	scripts/rules/fixtures/R-RENDER-AUDIT/record/packages/reviewer/skill/SKILL.md
- A	scripts/rules/fixtures/R-RENDER-AUDIT/record/render-pass-zero.json
- A	scripts/rules/fixtures/R-RENDER-AUDIT/record/render-unattributed.json
- A	scripts/rules/fixtures/R-RENDER-AUDIT/skill/packages/reviewer/skill/SKILL.md
- M	scripts/rules/registry.json

Not touched: versions, changelogs, release catalog, `gate.py`, `retired-leaves.ts`, any allowlist, baseline, gap list or scanner. No `vitest -u`, no root build, no PR.

## After the fold (planner)

Retiring `bin/visual-capture/` is the planner's step and is out of scope here. It should wait until (e) is proven against the real recordings.

BLOCKED: everything in the packet is implemented and pushed at 2f68e382d. The verb, fail-closed reasons, slot and agent attribution with `--file` requests, and R-RENDER-AUDIT with its failing fixtures are all done. Typecheck exits 0 for both packages, the 5 named tests plus 2 more pass, the mutations are killed, merge-tree exits 0, and FAST PASS shows no new red. Validation (e) is not met: the three recorded audits from the `bin/visual-capture/` harness were not attached to the launch prompt and are not in the repository. The parity test therefore runs on hand-written stand-ins, which do not prove the verb matches what the harness recorded. To unblock, attach the scrubbed recordings and swap them into `packages/producer/src/check/__fixtures__/render-parity/`. Separately, default live capture fails closed (`no-browser`) on this host because the repo's playwright pin does not match the installed Chromium; `--browser` or `CHROMIUM_PATH` works.
model: claude-opus-5-5
