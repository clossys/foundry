"use client";
import { forwardRef, type ReactNode, type ForwardedRef, type RefAttributes, type ReactElement } from "react";
import { Tree as AriaTree, TreeItem, TreeItemContent, Button, type TreeProps as AriaTreeProps, type TreeItemProps } from "react-aria-components";
import { Icon } from "./Icon.js";
import { useGlyph } from "./glyph-context.js";
import { cx } from "./internal/cx.js";
import { UI_ALPHA_DISABLED, UI_LAYOUT_TAP_TARGET, UI_RING_FOCUS } from "./internal/ui-vars.js";
export interface TreeProps<T extends object> extends AriaTreeProps<T> {}
export interface TreeNodeProps extends Omit<TreeItemProps, "children"> { label: ReactNode; children?: ReactNode; expandLabel: string }
const Root = forwardRef(function TreeRoot<T extends object>({ className, ...props }: TreeProps<T>, ref: ForwardedRef<HTMLDivElement>) {
  if (!props["aria-label"]?.trim() && !props["aria-labelledby"]?.trim()) throw new TypeError("Tree requires an accessible name.");
  return <AriaTree {...props} ref={ref} className={state => cx("w-full min-w-0 max-w-full text-body text-ink-primary outline-none", typeof className === "function" ? className(state) : className)} />;
}) as <T extends object>(props: TreeProps<T> & RefAttributes<HTMLDivElement>) => ReactElement | null;
const Node = forwardRef<HTMLDivElement, TreeNodeProps>(function TreeNode({ label, children, expandLabel, className, style, ...props }, ref) {
  const chevron = useGlyph("assets.icon-chevron-right");
  if (!expandLabel.trim()) throw new TypeError("Tree.Node requires an expandLabel.");
  return <TreeItem {...props} ref={ref} className={state => cx("min-w-0 max-w-full outline-none border-b border-s-2 border-line-base forced-colors:outline", state.isSelected ? "bg-accent-tint border-s-accent" : "border-s-transparent hover:bg-control-tonal-hover", typeof className === "function" ? className(state) : className)} style={state => ({ opacity: state.isDisabled ? UI_ALPHA_DISABLED : undefined, boxShadow: state.isFocusVisible ? `inset ${UI_RING_FOCUS}` : undefined, ...(typeof style === "function" ? style(state) : style) })}>
    <TreeItemContent>{state => <div className="flex min-w-0 max-w-full items-center gap-sm py-xs" style={{ minBlockSize: UI_LAYOUT_TAP_TARGET, paddingInlineStart: `calc(var(--spacing-md) * ${state.level})` }}>
      {state.hasChildItems && <Button slot="chevron" aria-label={expandLabel} aria-labelledby="" className="shrink-0 control-h-md aspect-square inline-flex items-center justify-center text-ink-secondary outline-none"><Icon glyph={chevron} decorative className={state.isExpanded ? "rotate-90" : undefined} /></Button>}
      {label}
    </div>}</TreeItemContent>
    {children}
  </TreeItem>;
});
/** Hierarchy and selection are controlled through native RAC collection props. */
export const Tree = Object.assign(Root, { Node });
