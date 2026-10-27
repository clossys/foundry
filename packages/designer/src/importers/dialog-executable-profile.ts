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
  content = dialogContentPart(content);
  return { ...file, content };
}

/**
 * Lift the inner RAC Dialog, with its close button, out of the ModalOverlay/Modal wrapper into an exported
 * `DialogContent` part that `Dialog` composes. The part is the pinned inner dialog verbatim, except that naming,
 * description and ref arrive as props; it adds no state owner and is never modal, so it can be drawn open in place.
 */
function dialogContentPart(source: string): string {
  const open = '        <DialogPrimitive\n', close = '        </DialogPrimitive>\n';
  const start = source.indexOf(open), end = source.indexOf(close) + close.length;
  if (start < 0 || end < start + open.length || source.indexOf(open, start + 1) >= 0) throw new Error("dialog-profile: inner dialog surface differs");
  const routed = '          aria-label={ariaLabel}\n          aria-labelledby={ariaLabelledby}\n          aria-describedby={ariaDescribedby}\n          ref={ref}\n';
  const inner = source.slice(start, end);
  if (inner.split(routed).length !== 2) throw new Error("dialog-profile: inner dialog props differ");
  const part = inner.replace(routed, "").replace(/\n(\s*className="[^"]*")\n/, "\n$1\n          {...props}\n")
    .split("\n").map(line => line.slice(Math.min(4, line.length - line.trimStart().length))).join("\n");
  if (!part.includes("{...props}")) throw new Error("dialog-profile: inner dialog className differs");
  const composed = `        <DialogContent\n${routed}          showCloseButton={showCloseButton}\n        >\n          {children}\n        </DialogContent>\n`;
  const declaration = 'function DialogContent({\n  children,\n  showCloseButton = true,\n  ...props\n}: Omit<React.ComponentProps<typeof DialogPrimitive>, "className" | "style"> & {\n  showCloseButton?: boolean\n}) {\n  return (\n' + part + '  )\n}\n\n';
  let content = source.slice(0, start) + composed + source.slice(end);
  const header = content.indexOf("function DialogHeader(");
  if (header < 0 || content.split("\n  DialogClose,\n").length !== 2) throw new Error("dialog-profile: export surface differs");
  content = content.slice(0, header) + declaration + content.slice(header);
  return content.replace("\n  DialogClose,\n", "\n  DialogClose,\n  DialogContent,\n");
}

export const dialogExecutableMembers: Readonly<Record<string, string>> = Object.freeze({
  "role.modal": "Dialog",
  dismissable: "Dialog",
});
