// Compile-time assertions for the shipped admin copy envelopes. This file has
// no runtime footprint and is not exported from `index.ts`; `tsc` compiling it
// is the check.

import { getAdminCopy } from "./admin-copy.js";
import { ADMIN_STUDIO_COPY_EN } from "./admin-studio.js";

const studio = ADMIN_STUDIO_COPY_EN;
const copy = getAdminCopy();

export function adminCopyIsReadonly(): void {
  // @ts-expect-error Shipped records cannot be rewritten through the accessor.
  studio.records[0]!.text = "changed";
  // @ts-expect-error The combined record list is immutable.
  copy.records.push(studio.records[0]!);
}
