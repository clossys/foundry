/** Public access to the existing English Studio record; its draft state is retained. */
import source from "./catalog/records/admin-studio.r1.en.json" with { type: "json" };

type DeepReadonly<T> = T extends object ? { readonly [K in keyof T]: DeepReadonly<T[K]> } : T;

/** The complete shipped envelope, including bindings and review evidence. */
export type AdminStudioCopy = DeepReadonly<typeof source>;
/** One unchanged Studio string record, addressed by its existing opaque id. */
export type AdminStudioCopyRecord = AdminStudioCopy["records"][number];

function freeze<T>(value: T): DeepReadonly<T> {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value as DeepReadonly<T>;
}

/** Package access does not approve or activate these records. */
export const ADMIN_STUDIO_COPY_EN: AdminStudioCopy = freeze(source);

/** Read a record for host-owned Writer binding; unknown ids have no fallback. */
export function getAdminStudioCopyRecord(id: string): AdminStudioCopyRecord | undefined {
  return ADMIN_STUDIO_COPY_EN.records.find(record => record.id === id);
}
