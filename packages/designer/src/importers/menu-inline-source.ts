import { sha256 } from "../catalog-core/digest.js";
import type { SourceFile } from "./rewrite.js";

/** Exact CommandList ancestry; this adds no collection or state owner. */
export function menuInlineSource(command: SourceFile): string {
  if (command.path !== "apps/v4/registry/bases/aria/ui/command.tsx" || sha256(command.content) !== "911e2d5972ca64ec2565b2c18281f0d9c0cb4d5caffa139dcd4eea2c853add11") throw new Error("menu-inline: pinned command receipt differs");
  const start = command.content.indexOf("function CommandList<T extends object>"), end = command.content.indexOf("\nfunction CommandEmpty(");
  if (start < 0 || end <= start) throw new Error("menu-inline: CommandList declaration differs");
  return command.content.slice(start, end)
    .replace("function CommandList<", "function InlineMenu<")
    .replace("<Menu\n", "<MenuPrimitive\n")
    .replace('className={cn(\n', 'className={composeRenderProps(className, (className) => cn(\n')
    .replace('      )}', '      ))}');
}
