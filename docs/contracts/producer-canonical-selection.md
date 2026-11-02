# Producer canonical selection

Canonical selection persists an explicit existing candidate after checking an
owner-maintained `approvals.json` decision. For example, with values read from
the consumer's candidate, owner decision, and current pin:

```ts
import { persistCanonicalSelection } from "@clossys/producer";

const selected = persistCanonicalSelection({
  root: consumerRoot,
  agent: "designer",
  slot: candidate.slot,
  id: candidate.element, // Filename stem; selected.id is <slot>/<element>.
  version: candidate.version,
  contentHash: candidate.contentHash, // SHA256 of actual bytes, raw lowercase hex.
  approval: ownerDecisionId,
  expectedPinHash: currentPinHash, // SHA256 of pin.json bytes, or null if absent.
});
```

The existing owner decision must bind `action: "pin"`, slot, element, version,
and hash. Its reference and time become the pin's provenance. The API consumes
this evidence; it does not authenticate identities or author approvals. Missing
approval, invalid bytes, or a previous-pin conflict refuses before commit and
leaves the selection unchanged. An occupied per-slot guard refuses without
retry or takeover. Atomic rename of `pin.json` is the commit point; unexpected
I/O or readback failure afterward can leave the new pin persisted. Inspect the
actual canonical pin and its file reference before retrying after such a failure.
A successful result includes canonical file references, the validated decision,
and pin readback. Candidate creation alone leaves selection and approval unchanged.
