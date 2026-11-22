import { sha256 } from "../catalog-core/digest.js";
import type { SourceFile } from "./rewrite.js";
import { classFallback, type DeclaredFallbackReader } from "./declared-fallback-reader.js";

// Exact normalized G1 entries. Raw upstream pins remain authenticated separately.
const entries: Readonly<Record<string, string>> = {
  "components/select/select.tsx": "fdaf9d8b902e62f5368898abd63144286533bcad856e563821684a3754feae2d",
  "components/calendar/calendar.tsx": "c31c0d7b5a2053c87f42c929812daeb1710eaa6e25c169dd30ec77a02fd21e73",
};
/**
 * Bounded caption adapter; it resolves no style finding or runtime observation.
 * All original K4 tuples remain blockers until independently measured bindings
 * or an explicitly accepted restyle can account for each exact design value.
 */
export function selectedCaptionSource(file: SourceFile, reader: DeclaredFallbackReader): SourceFile {
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
  // Each control height reads the reader's declared value, as the rewrite's defaulted style reads do.
  const height = (name: string): string => `h-(${name},${classFallback(reader, name)})`;
  const md = height("--ui-control-h-md");
  trigger = trigger.replace(`data-[size=default]:${md}`, `${md} group-data-[size=sm]/select:not-data-[size]:${height("--ui-control-h-sm")} group-data-[size=lg]/select:not-data-[size]:${height("--ui-control-h-lg")} group-data-[size=sm]/select:not-data-[size]:rounded-(--radius-control) data-[size=default]:${md}`);
  content = content.slice(0, start) + trigger + content.slice(end);
  return { ...file, content };
}

/** Executable pointers target the single RAC Select root declared above. */
export const selectedCaptionMembers: Readonly<Record<string, string>> = Object.freeze({
  "selection.single": "Select.selectionMode=single",
  "size.sm": "Select.size=sm", "size.md": "Select.size=md", "size.lg": "Select.size=lg",
  "state.invalid": "Select.isInvalid=true",
});
