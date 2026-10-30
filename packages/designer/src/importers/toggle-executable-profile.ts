import { sha256 } from "../catalog-core/digest.js";
import type { SourceFile } from "./rewrite.js";

const sourceHashes = {
  "toggle-group": "6946ac25f24e71ed0ff53d8e2405e68ca1a9203a9b33bf33c0ddd1d854e20eb5",
  toggle: "0c17862bfbdc3f9c59ace9677226bc4316e71b289b49666536ac37409b2c6f30",
} as const;

/** Complete forwarding on the authenticated fill; keep its CVA and peer state owners. */
export function toggleExecutableSource(item: keyof typeof sourceHashes, file: SourceFile): SourceFile {
  if (sha256(file.content) !== sourceHashes[item]) throw new Error("toggle-profile: pinned source receipt differs");
  let content = file.content;
  const replace = (before: string, after: string) => {
    if (content.split(before).length !== 2) throw new Error("toggle-profile: source surface differs");
    content = content.replace(before, after);
  };
  replace('import {\n  ToggleButton', 'import {\n  composeRenderProps,\n  ToggleButton');
  if (item === "toggle-group") {
    replace('  size,\n  spacing = 2,', '  size,\n  style,\n  spacing = 2,');
    replace('}: Omit<ToggleButtonGroupProps, "children"> &', '}: Omit<React.ComponentPropsWithRef<typeof ToggleGroupPrimitive>, "children"> &');
    replace('    children?: React.ReactNode', '    children?: ToggleButtonGroupProps["children"]');
    replace('{ "--gap": `calc(var(--spacing) * ${spacing})` }', '{ ...style, "--gap": `calc(var(--spacing) * ${spacing})` }');
    replace('      className={cn(\n        "cn-toggle-group group', '      className={composeRenderProps(className, (className) => cn(\n        "cn-toggle-group group');
    replace('        className\n      )}\n      {...props}\n    >\n      <ToggleGroupContext.Provider', '        className\n      ))}\n      {...props}\n    >\n      <ToggleGroupContext.Provider');
    replace('      <ToggleGroupContext.Provider\n', '      {composeRenderProps(children, (children) => <ToggleGroupContext.Provider\n');
    replace('      </ToggleGroupContext.Provider>', '      </ToggleGroupContext.Provider>)}');
    replace('}: ToggleButtonProps & VariantProps<typeof toggleVariants>)', '}: React.ComponentPropsWithRef<typeof TogglePrimitive> & VariantProps<typeof toggleVariants>)');
    replace('  type ToggleButtonProps,\n', '');
    replace('      className={cn(\n', '      className={composeRenderProps(className, (className) => cn(\n');
    replace('        className\n      )}', '        className\n      ))}');
  } else {
    replace('import { cva, type VariantProps }', 'import type { ComponentPropsWithRef } from "react"\nimport { cva, type VariantProps }');
    replace('  type ToggleButtonProps,\n', '');
    replace('}: ToggleButtonProps & VariantProps<typeof toggleVariants>)', '}: ComponentPropsWithRef<typeof TogglePrimitive> & VariantProps<typeof toggleVariants>)');
    replace('className={cn(toggleVariants({ variant, size, className }))}', 'className={composeRenderProps(className, (className) => cn(toggleVariants({ variant, size, className })))}');
  }
  return { ...file, content };
}
