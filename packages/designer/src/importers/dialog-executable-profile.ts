import { sha256 } from "../catalog-core/digest.js";
import type { SourceFile } from "./rewrite.js";

const sourceHash = "ff8a8e6b372e7eb06c931975d8ac1ea59d9271051ac178a62c95f6acae20bb35";

/** Adapt only the authenticated selected Dialog; its overlay remains the state owner. */
export function dialogExecutableSource(file: SourceFile): SourceFile {
  if (sha256(file.content) !== sourceHash) throw new Error("dialog-profile: pinned source receipt differs");
  let content = file.content;
  const replace = (before: string, after: string): void => {
    if (content.split(before).length !== 2) throw new Error("dialog-profile: source surface differs");
    content = content.replace(before, after);
  };
  replace('  isDismissable = true,\n  ...props\n}', '  isDismissable = true,\n  "aria-label": ariaLabel,\n  "aria-labelledby": ariaLabelledby,\n  "aria-describedby": ariaDescribedby,\n  ref,\n  ...props\n}');
  replace('    children: React.ReactNode\n    showCloseButton?: boolean', '    children: DialogPrimitiveProps["children"]\n    "aria-label"?: DialogPrimitiveProps["aria-label"]\n    "aria-labelledby"?: DialogPrimitiveProps["aria-labelledby"]\n    "aria-describedby"?: DialogPrimitiveProps["aria-describedby"]\n    ref?: React.ComponentProps<typeof DialogPrimitive>["ref"]\n    showCloseButton?: boolean');
  replace('          data-slot="dialog"\n', '          data-slot="dialog"\n          aria-label={ariaLabel}\n          aria-labelledby={ariaLabelledby}\n          aria-describedby={ariaDescribedby}\n          ref={ref}\n');
  replace('          {children}\n          {showCloseButton && (', '          {composeRenderProps(children, (children) => (\n            <>\n          {children}\n          {showCloseButton && (');
  replace('          )}\n        </DialogPrimitive>', '          )}\n            </>\n          ))}\n        </DialogPrimitive>');
  replace('  Dialog as DialogPrimitive,', '  composeRenderProps,\n  Dialog as DialogPrimitive,');
  // The rebound Button leaf is the consumer's open member-dispatch facade, so its props no longer carry
  // the pinned Button's string className; DialogClose keeps that contract for the cn call it makes.
  replace('}: React.ComponentProps<typeof Button>) {', '}: React.ComponentProps<typeof Button> & { className?: string }) {');
  return { ...file, content };
}

export const dialogExecutableMembers: Readonly<Record<string, string>> = Object.freeze({
  "role.modal": "Dialog",
  dismissable: "Dialog",
});
