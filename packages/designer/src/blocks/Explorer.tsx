import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactElement, type ReactNode } from "react";

import { cx } from "../components/internal/cx.js";
import { ChevronRight } from "../icons/ChevronRight.js";
import { FileText } from "../icons/FileText.js";
import { Folder } from "../icons/Folder.js";
import { TOKENS } from "../tokens/tokens.js";
import { indexTree, type TreeNode } from "./tree-model.js";
import { dsAttrs } from "../catalog-core/provenance-attrs.js";
import { componentLeaf } from "../runtime/component-leaf.js";

const Button = componentLeaf<typeof import("../components/Button.js").Button>("components.button");
const Icon = componentLeaf<typeof import("../components/Icon.js").Icon>("components.icon");
const Link = componentLeaf<typeof import("../components/Link.js").Link>("components.link");
const SemanticContent = componentLeaf<typeof import("../components/SemanticContent.js").SemanticContent>("components.semantic-content");

/** Section root provenance (D1): the selected Foundry fill this block is. */
const SECTION_STAMP = dsAttrs("sections", "sections.explorer", "foundry/sections.explorer");

const ROW = "relative w-full min-w-0 justify-start gap-sm text-start";
const GUIDE = "pointer-events-none absolute border-s border-line-base";
const DETAILS = "flex min-w-0 items-center gap-xs text-caption text-ink-secondary";
const TREE = "min-w-0 overflow-x-auto text-ink-primary";
const PANES = "grid w-full min-w-0 grid-cols-1 gap-lg tablet-lg:grid-cols-12 tablet-lg:items-start";
const TREE_PANE = "tablet-lg:col-span-4";
const LIST_PANE = "min-w-0 tablet-lg:col-span-8";
const LABEL = "min-w-0 truncate";
const GUIDE_BRANCH = "border-b";
const OPEN_ICON = "rotate-90";
const CLOSED_ICON = "rtl:rotate-180";
const SPACING_SM = `var(--spacing-sm, ${TOKENS["--spacing-sm"]!.value})`;
const SPACING_MD = `var(--spacing-md, ${TOKENS["--spacing-md"]!.value})`;

export interface ExplorerProps<T extends TreeNode & { children?: readonly T[] } = TreeNode> {
  tree: readonly T[];
  label: string;
  /** Controlled single selection. Focus and arrow disclosure do not request selection. */
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  defaultExpandedIds?: readonly string[];
  /** Optional descriptive metadata, separate from each node's accessible name. */
  renderDetails?: (node: T) => ReactNode;
  /**
   * Optional host-owned list pane (the sections.explorer `list` region): the
   * contents of the selected folder. When supplied, the tree and the list sit
   * side by side and `className` applies to the two-pane wrapper.
   */
  list?: ReactNode;
  /** Accessible name of the list pane region. @default "Contents" */
  listLabel?: string;
  className?: string;
}

interface RowProps<T extends TreeNode & { children?: readonly T[] }> {
  node: T; level: number; position: number; count: number;
  expanded: ReadonlySet<string>; active: string | undefined; selectedId: string | null | undefined;
  activate: (node: T) => void; focus: (id: string) => void;
  keyboard: (event: KeyboardEvent, node: T) => void;
  register: (id: string, element: HTMLElement | null) => void;
  renderDetails?: (node: T) => ReactNode;
}

/** A group is owned by its folder treeitem; Button and Link retain native press semantics. */
function Row<T extends TreeNode & { children?: readonly T[] }>(props: RowProps<T>) {
  const { node, level, position, count, expanded, active, selectedId, activate, focus, keyboard, register, renderDetails } = props;
  const rowId = useId(); const groupId = useId(); const descriptionId = useId();
  const folder = node.children !== undefined;
  const open = folder && expanded.has(node.id);
  const details = renderDetails?.(node);
  // Depth is semantic and unlimited; only visual indentation stops growing after six steps.
  const style = { paddingInlineStart: `calc(${SPACING_SM} + ${SPACING_MD} * ${Math.min(level - 1, 6)})` };
  const semantics = {
    role: "treeitem", tabIndex: active === node.id ? 0 : -1,
    "aria-level": level, "aria-posinset": position, "aria-setsize": count,
    "aria-expanded": folder ? open : undefined, "aria-selected": selectedId === node.id,
    "aria-owns": folder ? groupId : undefined,
  } as const;
  const content = <>
    {Array.from({ length: level - 1 }, (_, index) => <SemanticContent as="span" key={index} data-explorer-guide="" aria-hidden="true"
      className={cx(GUIDE, index === level - 2 && GUIDE_BRANCH)}
      style={{ insetInlineStart: `calc(${SPACING_MD} * ${Math.min(index, 5)})`, insetBlockStart: 0,
        insetBlockEnd: index === level - 2 ? "50%" : 0, inlineSize: index === level - 2 ? SPACING_MD : 0 }} />)}
    {folder ? <Icon glyph={ChevronRight} decorative size="sm" className={open ? OPEN_ICON : CLOSED_ICON} /> : null}
    {node.icon ?? <Icon glyph={folder ? Folder : FileText} data-explorer-icon="" decorative size="sm" />}
    <SemanticContent as="span" className={LABEL}>{node.label}</SemanticContent>
    {details !== undefined && details !== null ? <SemanticContent as="span" id={descriptionId} className={DETAILS}>{details}</SemanticContent> : null}
  </>;
  return <SemanticContent as="div" role="none">
    <SemanticContent as="div" role="none" ref={element => register(node.id, element?.querySelector<HTMLElement>("button, a") ?? null)}>
      {node.href !== undefined ? <Link id={rowId} href={node.href} buttonVariant={selectedId === node.id ? "secondary" : "ghost"}
        className={ROW} style={style} aria-label={node.label} aria-describedby={details == null ? undefined : descriptionId}
        {...semantics}
        onFocus={() => focus(node.id)} onKeyDown={event => keyboard(event, node)} onPress={() => activate(node)}>{content}</Link> :
        <Button id={rowId} variant={selectedId === node.id ? "secondary" : "ghost"}
          className={ROW} style={style} aria-label={node.label} aria-describedby={details == null ? undefined : descriptionId}
          {...semantics}
          onFocus={() => focus(node.id)} onKeyDown={event => keyboard(event, node)} onPress={() => activate(node)}>{content}</Button>}
    </SemanticContent>
    {folder ? <SemanticContent as="div" id={groupId} role="group" aria-labelledby={rowId} hidden={!open}>
      {open ? (node.children as readonly T[]).map((child, index) => <Row {...props} key={child.id} node={child} level={level + 1} position={index + 1} count={node.children!.length} />) : null}
    </SemanticContent> : null}
  </SemanticContent>;
}

/** Single-select files and folders, with unrestricted semantic depth and independent disclosure. */
export function Explorer<T extends TreeNode & { children?: readonly T[] }>(props: ExplorerProps<T>): ReactElement;
export function Explorer(props: ExplorerProps): ReactElement;
export function Explorer<T extends TreeNode & { children?: readonly T[] }>({ tree, label, selectedId, onSelect, defaultExpandedIds = [], renderDetails, list, listLabel = "Contents", className }: ExplorerProps<T>) {
  const index = indexTree(tree);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set(defaultExpandedIds));
  const [focused, setFocused] = useState<string>();
  const controls = useRef(new Map<string, HTMLElement>());
  const ownsFocus = useRef(false);
  const visible: T[] = [];
  const pending = [...tree].reverse();
  while (pending.length) {
    const node = pending.pop()!; visible.push(node);
    if (expanded.has(node.id) && node.children) for (let i = node.children.length - 1; i >= 0; i--) pending.push(node.children[i] as T);
  }
  const active = visible.some(node => node.id === focused) ? focused : visible[0]?.id;
  const move = (id: string) => { setFocused(id); controls.current.get(id)?.focus(); };
  const toggle = (id: string) => setExpanded(previous => { const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const activate = (node: T) => {
    move(node.id);
    if (node.children !== undefined) toggle(node.id);
    node.onSelect?.(); onSelect?.(node.id);
  };
  const keyboard = (event: KeyboardEvent, node: T) => {
    const position = visible.findIndex(item => item.id === node.id);
    let destination: string | undefined;
    if (event.key === "ArrowDown") destination = visible[Math.min(position + 1, visible.length - 1)]?.id;
    else if (event.key === "ArrowUp") destination = visible[Math.max(position - 1, 0)]?.id;
    else if (event.key === "Home") destination = visible[0]?.id;
    else if (event.key === "End") destination = visible.at(-1)?.id;
    else if (event.key === "ArrowRight") {
      if (node.children !== undefined && !expanded.has(node.id)) toggle(node.id);
      else destination = node.children?.[0]?.id;
    } else if (event.key === "ArrowLeft") {
      if (node.children !== undefined && expanded.has(node.id)) toggle(node.id);
      else destination = index.parents.get(node.id);
    } else return;
    event.preventDefault(); event.stopPropagation(); if (destination !== undefined) move(destination);
  };
  useLayoutEffect(() => { if (ownsFocus.current && active !== undefined) controls.current.get(active)?.focus(); }, [active]);
  const register = (id: string, element: HTMLElement | null) => { if (element) controls.current.set(id, element); else controls.current.delete(id); };
  const panes = list !== undefined && list !== null && list !== false;
  const treeElement = <SemanticContent as="div" {...(panes ? {} : SECTION_STAMP)} role="tree" aria-label={label} aria-multiselectable={false} data-explorer="" className={cx(TREE, panes ? TREE_PANE : className)}
    onFocusCapture={() => { ownsFocus.current = true; }} onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) ownsFocus.current = false; }}>
    {tree.map((node, position) => <Row key={node.id} node={node} level={1} position={position + 1} count={tree.length}
      expanded={expanded} active={active} selectedId={selectedId} activate={activate} focus={setFocused} keyboard={keyboard} register={register} renderDetails={renderDetails} />)}
  </SemanticContent>;
  if (!panes) return treeElement;
  return <SemanticContent as="div" {...SECTION_STAMP} data-explorer-layout="panes" className={cx(PANES, className)}>
    {treeElement}
    <SemanticContent as="section" aria-label={listLabel} data-explorer-region="list" className={LIST_PANE}>{list}</SemanticContent>
  </SemanticContent>;
}
