/**
 * Writer copy references. A server row Studio shows names its words by Studio copy key (the
 * pinned Writer strings), never as prose: Studio resolves each reference where it loads the row.
 * A plain string in the same place is data (an id, a candidate name, a hash, a validator issue).
 */
export interface CopyRef { readonly copy: string; readonly values?: Readonly<Record<string, string | number>> }
/** Data (a plain string) or a Writer copy reference. */
export type CopyText = string | CopyRef;

export const copyRef = (copy: string, values?: Readonly<Record<string, string | number>>): CopyRef => values ? { copy, values } : { copy };
export const isCopyRef = (value: unknown): value is CopyRef => !!value && typeof value === "object" && typeof (value as CopyRef).copy === "string";
