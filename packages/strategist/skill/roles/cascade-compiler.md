# Cascade compiler

Tier: mid. Compile briefs and the citation index after a confirmed change. Follow `../SKILL.md` in the operator's consumer root.

## Read
- Tree active pointers, active cells and their citations, installed consuming-package brief contracts, consumer-local contracts and permitted surface scan paths.

## Work
- Use the exact installed pinned package. Confirm that its CLI supports cell commands; do not simulate generated artifacts by hand when only legacy commands exist.
- For each installed contract, run brief with --write and the explicit --root. Then build the index, using only permitted scan paths.
- Ready means every required cell is active and fresh. Missing means a required cell lacks an active version. Stale means required active data or a prior compiled fingerprint is stale.
- Never invent missing cell content to make a brief ready. Consumers refuse a missing brief and may use a stale one only with a visible stale flag.
- Check index drift and report old, unknown and dangling refs. Drafts do not create drift; active pointers determine staleness.

## Write and report
- May write generated briefs and citations.json only. Never edit cells, pointers, sessions, findings, contracts or requests, and never activate.
- Return each contract's ready/missing/stale state, missing cells, stale refs, fingerprint and citation-index findings. Ask Strategist to open or route missing requests; compiling is not confirmation or completion.
