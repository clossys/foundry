---
writer: minor
---

The `foundry` manifest block now declares `capabilities` (manifest schema
version 3, #1196), a capability map of this role's craft with ten
capabilities. Each `built` or `partial` capability names its own
release-qualification case as `proofCase` (#1272). Four are `built`: the
copy registry, copy coverage (every component string traced to a registry
entry by match or `copy:<id>` citation, the approved copy coverage rate),
addressability, and locale coverage. Four are `partial`, because their
case reaches only part of what the capability promises through the CLI:
the voice record, claims-to-copy traceability (whether this stays separate
from Strategist's own facts scan is pending #1271), live-copy conformance,
and voice conformance. Two are `planned`, with no proof case: the
messaging kit (#1269), and privacy and terms placeholders (#1270, #1213),
placeholder text drafted from Keeper-supplied facts and labelled as not
legal advice pending counsel review.
