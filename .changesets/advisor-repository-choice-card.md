---
advisor: minor
---

`repositoryChoiceCard(listing, { current? })` builds the hub's repository-choice card from the repositories a client's GitHub account can see, as the agent listed them (`{ nameWithOwner, description? }` entries); this package makes no network call and holds no credentials. The client may choose several repositories. The current repository, when named and listed, is recommended and listed first; the rest follow sorted by id, and `something-else` is last. Each id must satisfy the repository inventory contract's id rule (`docs/contracts/repository-inventory.json`, now packed beside the plan and brief contracts) and be `owner/name`. A malformed list, or two entries naming the same repository in any letter case, is refused with `repository-listing` findings that name a position and never a repository name (#1179).
