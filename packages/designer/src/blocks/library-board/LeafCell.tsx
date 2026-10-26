'use client';
import type { HTMLAttributes, ReactNode } from 'react';
import { Button } from '../../components/Button.js';
import { IconButton } from '../../components/IconButton.js';
import { Card } from '../../components/Card.js';
import { Tooltip } from '../../components/Tooltip.js';
import { Settings } from '../../icons/Settings.js';
import { SectionHeader } from '../SectionHeader.js';
import { CANVAS_COUNTER_SCALED_TITLE } from '../canvas/CanvasLod.js';

export interface LeafCellProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  /** The leaf's rendered members; absent for an unchosen leaf. */
  readonly preview?: ReactNode;
  /** The one status line: "Not chosen", an unavailable preview, or nothing for a filled leaf. */
  readonly status?: ReactNode;
  /** The one action slot: Foundry Buttons only, one size, in this slot on every layer. */
  readonly actions?: ReactNode;
}

/**
 * One leaf cell on every Designer layer. A filled, unchosen or unavailable leaf keeps
 * the same plate skeleton (preview, status, actions); only the content differs.
 * Empty slots stay in place but are hidden, so a filled cell looks exactly as before.
 * The slots share one centre line, so a status reads level with its action buttons.
 */
export function LeafCell({ preview, status, actions, className, ...rest }: LeafCellProps) {
  return <Card {...rest} variant="plate" data-candidate-cell="" className={['flex w-max items-center gap-md p-sm', className].filter(Boolean).join(' ')}>
    {preview}
    <div data-cell-status="" hidden={status == null} className={status == null ? undefined : 'text-ink-muted'}>{status}</div>
    <div data-cell-actions="" hidden={actions == null} className={actions == null ? undefined : 'flex items-center gap-sm'}>{actions}</div>
  </Card>;
}

export interface BoardHeaderProps {
  /** Id for the heading text; the board section names itself with `aria-labelledby`. */
  readonly id: string;
  readonly title: ReactNode;
  readonly editing: boolean;
  readonly labels: { readonly changeSelection: string; readonly done: string };
  readonly onEdit: () => void;
  readonly onDone: () => void;
  /** Optional board-level action, placed before the gear. */
  readonly action?: ReactNode;
}

/**
 * One board header on every Designer layer: heading, optional action, gear (or Done
 * while editing). The gear is the square small icon control (28px box, 44px hit area).
 */
export function BoardHeader({ id, title, editing, labels, onEdit, onDone, action }: BoardHeaderProps) {
  return <SectionHeader data-board-header="" title={<span id={id} data-canvas-title="" className={CANVAS_COUNTER_SCALED_TITLE}>{title}</span>} level={3} actions={<>
    {action}
    {editing ? <Button size="sm" onPress={onDone}>{labels.done}</Button> : <Tooltip trigger={<IconButton size="sm" shape="square" icon={Settings} label={labels.changeSelection} onPress={onEdit} />}>{labels.changeSelection}</Tooltip>}
  </>} />;
}

/**
 * The board plate on every Designer layer: the raised surface on the canvas ground,
 * edged with the hairline (`--color-line-base`), so a board reads as one object above
 * the canvas instead of a box drawn on it.
 */
export const BOARD_SURFACE_CLASS = 'flex h-max w-max shrink-0 flex-col gap-sm rounded-surface border border-line-base bg-surface-raised p-md';

/**
 * A leaf's row label, one treatment in view and edit mode: the human label (when it is not the id)
 * in the body face, then the leaf id underneath in the mono face with tabular figures. The weight is
 * set to regular so a row-header cell (`th`) never bolds it.
 */
export function LeafLabel({ id, label }: { readonly id: string; readonly label: ReactNode }) {
  const human = label !== id && label != null && label !== '' ? label : undefined;
  return <span data-leaf-label="" className="flex min-w-0 flex-col text-start font-normal">
    {human !== undefined ? <span className="break-words text-ink-primary">{human}</span> : null}
    <span data-leaf-id="" className={human !== undefined ? 'break-words font-mono tabular-nums text-caption text-ink-secondary' : 'break-words font-mono tabular-nums text-ink-primary'}>{id}</span>
  </span>;
}
