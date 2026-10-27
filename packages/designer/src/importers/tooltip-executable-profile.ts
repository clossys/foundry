import { sha256 } from "../catalog-core/digest.js";
import type { SourceFile } from "./rewrite.js";

// Exact rewritten entry before this selected adaptation. Upstream bytes have
// already been authenticated independently by importShadcnAriaComponents.
const sourceHash = "07eeec7f086d838941487fe884ccd529938d7d6337f8b2d383a40e3b3639c0ce";
export const tooltipExecutableReads = Object.freeze([
  "tokens.behavior-timing.tooltip-close", "tokens.behavior-timing.tooltip-delay",
]);
export const tooltipExecutableProps = Object.freeze(["children", "className", "crossOffset", "offset", "placement", "ref", "style"]);

/** Bind exact consumer duration values explicitly; never read an ambient theme or invent timing. */
export function tooltipExecutableSource(file: SourceFile): SourceFile {
  if (file.path !== "components/tooltip/tooltip.tsx" || sha256(file.content) !== sourceHash) throw new Error("tooltip-profile: rewritten source receipt differs");
  let content = file.content;
  const replace = (before: string, after: string) => {
    if (content.split(before).length !== 2) throw new Error("tooltip-profile: exact source surface differs");
    content = content.replace(before, after);
  };
  replace("  Focusable,", "  composeRenderProps,\n  Focusable,");
  replace("function TooltipTrigger({", `export type TooltipBehaviorTiming = Readonly<{
  "tokens.behavior-timing.tooltip-delay": Readonly<{ value: number; unit: "ms" | "s" }>;
  "tokens.behavior-timing.tooltip-close": Readonly<{ value: number; unit: "ms" | "s" }>;
}>;

/** The caller supplies these values from its resolved consumer library. */
export function readTooltipTiming(behaviorTiming: TooltipBehaviorTiming): { delay: number; closeDelay: number } {
  const milliseconds = (value: Readonly<{ value: number; unit: "ms" | "s" }> | undefined): number => {
    if (!value || typeof value.value !== "number" || !Number.isFinite(value.value) || value.value < 0 || (value.unit !== "ms" && value.unit !== "s")) throw new Error("Missing or invalid tooltip timing binding");
    const result = value.unit === "s" ? value.value * 1000 : value.value;
    if (!Number.isFinite(result)) throw new Error("Invalid tooltip timing binding");
    return result;
  };
  return {
    delay: milliseconds(behaviorTiming?.["tokens.behavior-timing.tooltip-delay"]),
    closeDelay: milliseconds(behaviorTiming?.["tokens.behavior-timing.tooltip-close"]),
  };
}

function TooltipTrigger({`);
  replace("  delay = 0,\n  children,", "  behaviorTiming,\n  delay,\n  closeDelay,\n  children,");
  replace("}: React.ComponentProps<typeof TooltipTriggerPrimitive>) {", "}: React.ComponentPropsWithRef<typeof TooltipTriggerPrimitive> & { behaviorTiming: TooltipBehaviorTiming }) {\n  const timing = readTooltipTiming(behaviorTiming);");
  replace("      delay={delay}\n", "      delay={delay ?? timing.delay}\n      closeDelay={closeDelay ?? timing.closeDelay}\n");
  replace('}: Omit<\n  React.ComponentProps<typeof TooltipPrimitive>,\n  "children" | "className"\n> & {\n  className?: string\n  children?: React.ReactNode\n})', '}: React.ComponentPropsWithRef<typeof TooltipPrimitive>)');
  replace("      className={cn(", "      className={composeRenderProps(className, (className) => cn(");
  replace("        className\n      )}", "        className\n      ))}");
  replace("      {children}\n      <OverlayArrow", "      {composeRenderProps(children, (children) => <>\n      {children}\n      <OverlayArrow");
  replace("      />\n    </TooltipPrimitive>", "      />\n      </>)}\n    </TooltipPrimitive>");
  return { ...file, content };
}
