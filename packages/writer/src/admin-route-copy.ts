import source from "./catalog/records/admin-writer.r1.en.json" with { type: "json" };
import paging from "./catalog/records/admin-writer-paging.r1.en.json" with { type: "json" };
import { freezeAdminCopy, type DeepReadonly } from "./admin-copy-core.js";
import type { StringRecord } from "./model/types.js";

/** Command-authored English draft display copy; no approval or activation is implied. */
export interface AdminRouteCopy {
  readonly version: number;
  readonly revision: number;
  readonly state: string;
  readonly locale: string;
  readonly activation: string;
  readonly records: readonly DeepReadonly<StringRecord>[];
  readonly bindings: readonly { readonly cellId: string; readonly recordId: string; readonly target: string; readonly kind: string }[];
}
export const ADMIN_WRITER_COPY_EN: AdminRouteCopy = freezeAdminCopy({ ...source, records: [...source.records, ...paging.records], bindings: [...source.bindings, ...paging.bindings] } as AdminRouteCopy);
