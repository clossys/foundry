# CPF1 receipt: place queue.change in the Producer queue IA

- Serving model: claude-opus-5-5 (Claude Code subagent, low tier brief)
- Base: claude/r2f-int2 429393091; code commit aefeaad41 on claude/r2f-0048-cpf1
- Diff: 3 files, +17/-6 (queue.json +7 leaf node problems-changes/queue.change; SKILL.md names queue.change, "six queues"; producer.test.ts pins)
- DECIDED D1: P8 (enforced: skill must name every queue leaf) turned red once the leaf was placed, so SKILL.md names queue.change; no check edited.
- Test edits: world() drops the queue.change IA leaf with its already-filtered kind (P3 keeps it out of the all-green world); repo test now pins P1 [] and the report's first line GREEN P1.

## Validation
- npm run typecheck -w @clossys/producer: exit 0
- npm exec -w @clossys/producer -- vitest run src/catalog src/conform: exit 1; 173/174 pass. Sole failure conform.test.ts "upstream-pinned ... (U37)" fails identically at base (base run: exit 1, same single failure). No new named failure.
- node packages/producer/dist/cli/index.js conform --all --json: exit 1 (base exit 1). 152 cells each side. Changed: producer/P1 red -> green; producer/P7 green -> green (evidence only). None green to red (P8 green both).
- Builds (wt run --kind build, package-scoped): director, writer, designer, controller, publisher, producer exit 0 (deps unbuilt in fresh slot).
- Mutation: removed problems-changes in place (originals saved to mktemp -d): conform P1 red "producer IA queue: queue.change is not placed"; producer.test.ts exit 1 (repo-pin test fails). Restored; cmp equal for all 3 files.
- git merge-tree --write-tree claude/r2f-int2 HEAD: exit 0
