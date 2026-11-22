"use client";
import { forwardRef, type ReactNode } from "react";
import { TagGroup as AriaTagGroup, TagList, Tag, Button, Label, Text, type TagGroupProps as AriaTagGroupProps, type TagProps, type TagListProps } from "react-aria-components";
import { Icon } from "./preview-runtime/components/icon/icon.js";
import { useGlyph } from "./glyph-context.js";
import { cx } from "./internal/cx.js";
export interface TagGroupProps extends AriaTagGroupProps { label: ReactNode; description?: ReactNode; children: ReactNode }
export interface TagGroupItemProps extends Omit<TagProps, "children"> { children: ReactNode; textValue: string; removeLabel?: string }
const Root = forwardRef<HTMLDivElement, TagGroupProps>(function TagGroup({ label, description, children, className, ...props }, ref) {
  return <AriaTagGroup {...props} ref={ref} className={cx("flex flex-col gap-2", className)}>
    <Label className="text-sm text-muted-foreground font-sans">{label}</Label>{children}
    {description && <Text slot="description" className="text-xs text-muted-foreground">{description}</Text>}
  </AriaTagGroup>;
});
function List<T extends object>({ className, ...props }: TagListProps<T>) {
  return <TagList {...props} className={state => cx("flex flex-wrap gap-2", typeof className === "function" ? className(state) : className)} />;
}
const Item = forwardRef<HTMLDivElement, TagGroupItemProps>(function TagGroupItem({ children, removeLabel, className, style, ...props }, ref) {
  const close = useGlyph("assets.icon-close");
  if (removeLabel !== undefined && !removeLabel.trim()) throw new TypeError("TagGroup.Item requires a nonempty removeLabel.");
  return <Tag {...props} ref={ref} className={state => cx("control-h-md inline-flex items-center gap-1 rounded-full px-2 text-xs outline-none forced-colors:outline", state.isSelected ? "bg-primary text-primary-foreground" : "bg-muted text-foreground", state.isFocusVisible && "ring-2 ring-ring", state.isDisabled && "opacity-50", typeof className === "function" ? className(state) : className)} style={style}>
    {state => {
      if (state.allowsRemoving && !removeLabel?.trim()) throw new TypeError("Removable TagGroup.Item requires a host removeLabel.");
      return <>{children}{state.allowsRemoving && <Button slot="remove" aria-label={removeLabel} aria-labelledby="" className={remove => cx("control-h-md aspect-square inline-flex items-center justify-center rounded-full outline-none", remove.isFocusVisible && "outline-solid outline-2 outline-offset-2 outline-ring")}><Icon glyph={close} decorative /></Button>}</>;
    }}
  </Tag>;
});
/** Selectable/removable tags; a chip alone is not a tag group. */
export const TagGroup = Object.assign(Root, { List, Item });
