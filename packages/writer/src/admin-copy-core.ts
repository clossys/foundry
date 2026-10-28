/** Preserve the shape of shipped copy while preventing edits through its accessor. */
export type DeepReadonly<T> = T extends object ? { readonly [K in keyof T]: DeepReadonly<T[K]> } : T;

export function freezeAdminCopy<T>(value: T): DeepReadonly<T> {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) freezeAdminCopy(child);
    Object.freeze(value);
  }
  return value as DeepReadonly<T>;
}
