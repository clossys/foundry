---
advisor: minor
---

The `clossys-advisor` skill lists repositories with `gh api --paginate 'user/repos?affiliation=owner,collaborator,organization_member&per_page=100'`, on every page and without archived ones, into a temporary directory outside the repository that is deleted afterwards (#1179).
