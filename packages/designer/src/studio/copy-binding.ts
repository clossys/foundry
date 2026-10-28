/** A presentation-only port supplied by the host's Writer resolver. */
export interface StudioCopyRef {
  readonly id: string;
  readonly locale?: string;
  readonly values?: Readonly<Record<string, string | number | boolean>>;
}
export type StudioCopyResolver = (ref: StudioCopyRef) => {
  readonly ref: StudioCopyRef;
  readonly text: string;
  readonly servedLocale?: string;
  readonly chain?: readonly string[];
} | undefined;
export interface StudioCopyBinding {
  readonly locale: string;
  readonly resolver: StudioCopyResolver;
  /** References authored by a later Writer metadata revision, supplied by the host. */
  readonly messages?: Readonly<Record<string, StudioCopyRef>>;
}
export class StudioCopyNeedsError extends Error {
  override readonly name = "StudioCopyNeedsError";
  constructor(readonly cellId: string, readonly recordId?: string) { super(cellId); }
}
export function studioCopyNeed(cellId: string): never { throw new StudioCopyNeedsError(cellId); }

export function readStudioMessage(binding: StudioCopyBinding, cellId: string, values?: Readonly<Record<string, string | number | boolean>>): string {
  const ref = binding.messages?.[cellId];
  if (!ref) return studioCopyNeed(cellId);
  return readStudioCopy(binding, ref, values);
}

/** The resolver retains approval, message formatting and locale policy. No local text fallback exists. */
export function readStudioCopy(
  binding: StudioCopyBinding,
  ref: StudioCopyRef,
  values?: Readonly<Record<string, string | number | boolean>>,
): string {
  if (!binding || typeof binding.locale !== "string" || !binding.locale || typeof binding.resolver !== "function") {
    throw new StudioCopyNeedsError("studio.copy.binding", ref.id);
  }
  const argumentsForWriter = ref.values || values ? { ...ref.values, ...values } : undefined;
  if (argumentsForWriter && Object.values(argumentsForWriter).some(value => !(typeof value === "string" || typeof value === "boolean"
    || typeof value === "number" && Number.isFinite(value)))) throw new StudioCopyNeedsError("studio.copy.arguments", ref.id);
  const request: StudioCopyRef = { id: ref.id, locale: binding.locale, ...(argumentsForWriter ? { values: argumentsForWriter } : {}) };
  const result = binding.resolver(request);
  if (!result || typeof result.text !== "string" || !result.text.trim() || result.ref?.id !== ref.id
    || result.ref.locale !== binding.locale || typeof result.servedLocale !== "string" || !result.servedLocale) {
    throw new StudioCopyNeedsError("studio.copy.unresolved", ref.id);
  }
  return result.text;
}
