---
slot: "context.company.constraint"
source: {"kind": "derived", "ref": ["finding:foundry-public-repo-facts", "finding:owner-foundry-director-2026-11-11", "finding:foundry-public-studio-readonly-bound"]}
feeds: []
functions: ["ops"]
note: "Agent pick for the Foundry open-source project Director (C6-FDIR, 2026-11-11): project answer, cites the recommended project core options; re-cite when the owner picks."
---

## Direction
- Limit: the repository is public, so every record is world-readable and permanent.
- Bound: no prices, revenue, funding figures or private names in any record, and no link to any other repository's records.
- Effect: records carry only what the project can say in public; business details stay out.
- Studio stays read-only: no forms, saves or write endpoints.

## Because
- The repository is public (finding:foundry-public-repo-facts)
- The owner wants Foundry content independent, with nothing hard-linked (finding:owner-foundry-director-2026-11-11)
- The Studio requirements state read-only inspection (finding:foundry-public-studio-readonly-bound)

## Watch
- If records with money figures or links to another repository's records found at release review > 0 in any month, then remove them before release.
