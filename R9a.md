# R9a receipt

- Serving model: claude-opus-5-5 (session_context.model and last_served_model both claude-opus-5-5)
- Base: 5a2e197ea42dde155f0882fef533f7f4bf414605 (claude/r2f-int2 at run time; it was the same sha)
- Head: 5a2e197ea42dde155f0882fef533f7f4bf414605. No commit: nothing was changed, and the receipt stays outside the repository (planner update).
- Diff size: 0 files, 0 lines.

## Commands
| command | exit |
|---|---|
| npm ci | 0 |
| npm run build -w @clossys/advisor | 0 |
| npm run build -w @clossys/controller | 0 |
| npm run build -w @clossys/director | 0 |
| npm run build -w @clossys/designer | 0 |
| npm run build -w @clossys/writer | 0 |
| npm run build -w @clossys/publisher | 0 |
| npm run build -w @clossys/producer | 0 |
| node packages/producer/dist/cli/index.js conform --all --json (base) | 1 (reds exist) |
| ia sync --check --root packages/producer/test-fixtures/consumer (base) | 1: 15 drift (designer 3 contract: components.semantic-content, components.icon, components.logo; writer 12 lexicon contract), 88 unconsumed listed |
| ia sync --agent designer --at 2026-11-23T00:00:00Z --root packages/producer/test-fixtures/consumer | 0: wrote only the 3 consumerAssets slots (removed contract.fixture from components.icon/logo/semantic-content); placed no leaf; S1 unchanged. Reverted with git checkout, because any change touching the consumerAssets slots is BLOCKED by the spec |
| ia designer/components.link --contract <package slot contract> --under components.components/components-actions --dry | 1: "contract $.requirements must be a non-empty list of {check} naming registered criteria" |
| npm run typecheck -w @clossys/designer | 0 |
| npm exec -w @clossys/designer -- vitest run src/catalog | 1 at base (31 failed tests, e.g. provenance.test.ts, ref-verbatim.test.ts, site-configs.test.ts, wave-one.test.ts); no change made, so no new failure |
| npm exec -w @clossys/producer -- vitest run src/conform src/cli/ia-sync.test.ts | 1 at base: 1 failed / 165 passed (conform.test.ts "upstream-pinned on a model read from disk ... (U37)"); no new failure |
| git fetch origin claude/r2f-int2:claude/r2f-int2 | 0 |
| git merge-tree --write-tree claude/r2f-int2 HEAD | 0 |
| git push -u origin claude/r2f-0048-r9a | 128 at first: refused by the git proxy (403, repository not in the session's authorized set). After the owner had the repository attached to the session: 0 (branch at the base sha; it has no unit commit) |

Mutation proof: not applicable; there is no change to mutate.
Fixtures repointed: none. Leaves placed: none.
Gate script: run once after the push (python3 cloud-gate-run.py --spec specs/R9a.json --receipt R9a.md --publish). It is expected to FAIL on the designer:S1 filter and the base test reds, and its result is published to claude/r2f-0048-r9a-gate.

## Target cells
- designer S1: red before; nothing changed. 53 rows: "package tree has 252 leaves, the placed tree 212". 46 package-tree leaves are not placed (for example components.native-action, components.link, sections.cards and frames.document). Six leaves are placed but not in the package tree: themes.success, themes.warning, themes.info, sections.producer.team-strip, sections.producer.system-empty and components.studio.specimen-document.
- designer DF.designer.CREATE: red before; nothing changed. All 3 rows name consumerAssets slots only (components.semantic-content, components.icon, components.logo). That is the known red handed to Q6; no non-consumerAssets slot needed repointing.
- No cell changed colour (no change).

## BLOCKED-D5 analysis
1. The 46 unplaced leaves: `ia sync` places only the package leaves that a declared or seated publication reaches (packages/producer/src/cli/owner.ts:315, "CONSISTENCY D5 option 1", consumed.ts). None of the 46 appears even in sync's unconsumed list, so sync never places them. The per-leaf fallback `clossys ia designer/<id> --under` needs a `--contract` that carries registered `requirements`. The package slot data (packages/designer/src/catalog/slots/*.json) carries none, so placing a leaf means authoring contract content, which this unit may not do.
2. The six "placed, not in the package tree" leaves are package leaves of @clossys/producer (packages/producer/src/studio-defaults/designer-slots.json: "clossys ia sync places them ... in every consumer"). S1 counts only the Designer trees in packages/designer/conform.json, so any synced consumer keeps them red. packages/designer/src/catalog/retired-pieces.json already retires components.studio.specimen-document and sections.producer.team-strip ("owner decision 8 (no Studio)").

Options:
- A (default): an owner decision that S1 judges only the leaves sync places, i.e. consumed Designer leaves plus the package-slot leaves Producer contributes. That is a check change for the planner and owner to make, not for this unit.
- B: give the fixture consumer a declared publication that reaches the 46 leaves, so sync places them. Separately, retire the six Studio slots from producer studio-defaults (in line with owner decision 8), so sync takes them out.
- C: per-leaf `ia --under` placement with authored contracts. Not recommended: it invents requirements and contradicts the consumed-only rule.

tier-outcome: mid, blocked
BLOCKED: designer S1 cannot be turned green with the allowed verbs. `ia sync` places only consumed leaves (owner.ts:315, CONSISTENCY D5 option 1), so it places none of the 46 unplaced Designer leaves, and per-leaf `ia --under` refuses the package contract without authored requirements. Six Producer-defined Studio leaves (studio-defaults/designer-slots.json) are synced into every consumer but lie outside the Designer trees S1 counts. DF.designer.CREATE already names only the three consumerAssets slots (Q6). Default option A is above. The unit branch is pushed at the base sha and the gate result is published to claude/r2f-0048-r9a-gate.
