# Producer native records

`materializeCatalogCandidate` creates an unpinned canonical Designer candidate from a registered package surface and independently read package-export evidence. The target IA slot and contract must already exist; candidate versions are allocated from its filenames. The result includes the actual record hash and required binding ports. SiteFrame delegates to Designer's native `siteShellProps`, requires resolved content with matching provenance hashes, and remains server-required. This API grants no adoption, pin, approval, or browser qualification.

Use the existing canonical reader after materialization:

```ts
import { materializeCatalogCandidate, libraryRecordSource } from "@clossys/producer";

const result = await materializeCatalogCandidate(input);
const source = libraryRecordSource({ roots: [consumerClossysRoot] });
const record = await source.read(result.id, result.version);
```

Pass this `source` to Publisher's `resolveNativeNextDraft`, with the returned current candidate under `input.slot`: `{ element: input.element, version: result.version, contentHash: result.contentHash }`. The caller supplies the admitted page, other current candidates, Writer copy and assets; reading an explicit draft version creates no production pin.
