"use client";
import { forwardRef, type ReactNode } from "react";
import { TagGroup as AriaTagGroup, TagList, Tag, Button, Label, Text, type TagGroupProps as AriaTagGroupProps, type TagProps, type TagListProps } from "react-aria-components";
import { Icon } from "./Icon.js";
import { useGlyph } from "./glyph-context.js";
import { cx } from "./internal/cx.js";
import { UI_ALPHA_DISABLED, UI_FOCUS_OFFSET, UI_OUTLINE_FOCUS, UI_RING_FOCUS } from "./internal/ui-vars.js";
export interface TagGroupProps extends AriaTagGroupProps { label: ReactNode; description?: ReactNode; children: ReactNode }
export interface TagGroupItemProps extends Omit<TagProps, "children"> { children: ReactNode; textValue: string; removeLabel?: string }
const Root = forwardRef<HTMLDivElement, TagGroupProps>(function TagGroup({ label, description, children, className, ...props }, ref) {
  return <AriaTagGroup {...props} ref={ref} className={cx("flex flex-col gap-sm", className)}>
    <Label className="text-body-s text-ink-secondary font-body">{label}</Label>{children}
    {description && <Text slot="description" className="text-caption text-ink-muted">{description}</Text>}
  </AriaTagGroup>;
});
function List<T extends object>({ className, ...props }: TagListProps<T>) {
  return <TagList {...props} className={state => cx("flex flex-wrap gap-sm", typeof className === "function" ? className(state) : className)} />;
}
const Item = forwardRef<HTMLDivElement, TagGroupItemProps>(function TagGroupItem({ children, removeLabel, className, style, ...props }, ref) {
  const close = useGlyph("assets.icon-close");
  if (removeLabel !== undefined && !removeLabel.trim()) throw new TypeError("TagGroup.Item requires a nonempty removeLabel.");
  return <Tag {...props} ref={ref} className={state => cx("control-h-md inline-flex items-center gap-xs rounded-pill px-sm text-caption outline-none forced-colors:outline", state.isSelected ? "bg-accent text-ink-on-accent" : "bg-surface-sunken text-ink-primary", typeof className === "function" ? className(state) : className)} style={state => ({ opacity: state.isDisabled ? UI_ALPHA_DISABLED : undefined, boxShadow: state.isFocusVisible ? UI_RING_FOCUS : undefined, ...(typeof style === "function" ? style(state) : style) })}>
    {state => {
      if (state.allowsRemoving && !removeLabel?.trim()) throw new TypeError("Removable TagGroup.Item requires a host removeLabel.");
      return <>{children}{state.allowsRemoving && <Button slot="remove" aria-label={removeLabel} aria-labelledby="" className="control-h-md aspect-square inline-flex items-center justify-center rounded-pill outline-none" style={remove => ({ outline: remove.isFocusVisible ? UI_OUTLINE_FOCUS : undefined, outlineOffset: remove.isFocusVisible ? UI_FOCUS_OFFSET : undefined })}><Icon glyph={close} decorative /></Button>}</>;
    }}
  </Tag>;
});
/** Selectable/removable tags; a chip alone is not a tag group. */
export const TagGroup = Object.assign(Root, { List, Item });
