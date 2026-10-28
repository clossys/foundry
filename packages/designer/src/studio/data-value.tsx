/** Raw values are data, distinct from Writer-owned display names and messages. */
export interface StudioDataValueProps {
  readonly kind: "identifier" | "json" | "number" | "status" | "command" | "hash" | "source" | "path" | "value" | "evidence";
  readonly value: unknown;
}
export function StudioDataValue({ kind, value }: StudioDataValueProps) {
  const text = value === undefined || value === null ? "" : typeof value === "object" ? JSON.stringify(value) : String(value);
  return <span data-studio-data-value="" data-studio-data-kind={kind} className={kind === "hash" || kind === "command" || kind === "json" ? "min-w-0 wrap-anywhere font-mono" : "min-w-0 wrap-anywhere"}>{text}</span>;
}
