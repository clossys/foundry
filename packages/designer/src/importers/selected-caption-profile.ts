import { sha256 } from "../catalog-core/digest.js";
import type { SourceFile } from "./rewrite.js";

// Exact normalized G1 entries. Raw upstream pins remain authenticated separately.
const entries: Readonly<Record<string, string>> = {
  "components/select/select.tsx": "32bec40aac3856c64e0c9bda5e721a494cd5621e524be887001a1dc0f91f8ce6",
  "components/calendar/calendar.tsx": "dc0afbbb8cb9a44602ee1e3777e5e532b48491444897f34046bb96e2b28b5a47",
};
/**
 * Bounded caption adapter; it resolves no style finding or runtime observation.
 * All original K4 tuples remain blockers until independently measured bindings
 * or an explicitly accepted restyle can account for each exact design value.
 */
export function selectedCaptionSource(file: SourceFile): SourceFile {
  const expected = entries[file.path];
  if (!expected) return file;
  if (sha256(file.content) !== expected) throw new Error("selected-caption: normalized source receipt differs");
  if (file.path === "components/calendar/calendar.tsx") return file;
  let content = file.content;
  const replace = (before: string, after: string): void => {
    if (content.split(before).length !== 2) throw new Error("selected-caption: exact source surface differs");
    content = content.replace(before, after);
  };
  replace('className,\n  ...props\n}: SelectProps<T, M>)', 'className,\n  size = "md",\n  ...props\n}: SelectProps<T, M> & { size?: "sm" | "md" | "lg" })');
  replace('data-slot="select"\n      className={cn("w-fit", className)}', 'data-slot="select"\n      data-size={size}\n      className={composeRenderProps(className, (className) => cn("group/select w-fit", className))}');
  replace('size = "default",\n  children,', 'size,\n  children,');
  const start = content.indexOf("function SelectTrigger("), end = content.indexOf("function SelectContent(");
  let trigger = content.slice(start, end);
  trigger = trigger.replace('className={cn(', 'className={composeRenderProps(className, (className) => cn(').replace('        className\n      )}', '        className\n      ))}');
  // Every inherited rule requires absence of an explicit trigger size. An
  // explicit trigger size remains an override, including under a size="lg" root.
  trigger = trigger.replace('data-[size=default]:h-(--ui-control-h-md)', 'h-(--ui-control-h-md) group-data-[size=sm]/select:not-data-[size]:h-(--ui-control-h-sm) group-data-[size=lg]/select:not-data-[size]:h-(--ui-control-h-lg) group-data-[size=sm]/select:not-data-[size]:rounded-(--radius-control) data-[size=default]:h-(--ui-control-h-md)');
  content = content.slice(0, start) + trigger + content.slice(end);
  return { ...file, content };
}

/** Executable pointers target the single RAC Select root declared above. */
export const selectedCaptionMembers: Readonly<Record<string, string>> = Object.freeze({
  "selection.single": "Select.selectionMode=single",
  "size.sm": "Select.size=sm", "size.md": "Select.size=md", "size.lg": "Select.size=lg",
  "state.invalid": "Select.isInvalid=true",
});
