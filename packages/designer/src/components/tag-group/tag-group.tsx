import { inputCopy, INPUT_COPY_REFS, type InputCopyResolver } from "../_parts/rail-u1-copy/index.js";
import { type ComponentProps, type ReactNode } from "react";
import { TagGroup as Root, TagList, Tag, Label, Button } from "react-aria-components";
import { badgeVariants } from "../_parts/rail-u1-badge/badge.js";
import { buttonVariants } from "../_parts/rail-u1-button/button.js";
type Item = { id: string; label: string };
type Props = Omit<ComponentProps<typeof Root>, "children"> & { label: ReactNode; items: Item[]; removable?: boolean; removeLabel?: string; copy?: InputCopyResolver };
export function TagGroup({ label, items, removable, removeLabel, copy, ...props }: Props) {
 const remove = removable ? inputCopy(copy, "tagRemove", removeLabel) : undefined;
 return <Root {...props}><Label>{label}</Label><TagList items={items}>{item => <Tag id={item.id} textValue={item.label} className={({ isSelected }) => badgeVariants({ variant: isSelected ? "default" : "secondary" })}>{() => <>{item.label}{removable ? <Button slot="remove" aria-label={remove} data-copy-ref={INPUT_COPY_REFS.tagRemove.id} className={buttonVariants({ variant: "ghost", size: "icon" })}>{remove}</Button> : null}</>}</Tag>}</TagList></Root>;
}
