---
advisor: minor
---

`skill/SKILL.md` states an explicit degraded mode outside the hub (#1507): in the hub the skill works as described everywhere else in the file; with a hub checkout beside the current repository, it reads that hub's engagement state (`plan.json`, `STATUS`, `brief.json`) read-only and refuses to record a decision here -- no hiring, no plan change, no approval, no `advisor-resolve-packages`; with no hub reachable, it gives a read-only report from `clossys/brief.json` and refuses decisions the same way. In both cases it never installs this package in a product repository; a bin that must run does so unpinned-locally through the hub's exact pin, `npx --package=@clossys/advisor@<hub version> <bin>`.
