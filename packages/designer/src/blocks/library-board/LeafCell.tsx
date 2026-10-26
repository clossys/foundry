'use client';
import type { HTMLAttributes, ReactNode } from 'react';
import { Button } from '../../components/Button.js';
import { Card } from '../../components/Card.js';
import { Icon } from '../../components/Icon.js';
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
 */
export function LeafCell({ preview, status, actions, className, ...rest }: LeafCellProps) {
  return <Card {...rest} variant="plate" data-candidate-cell="" className={['flex w-max items-start gap-md p-sm', className].filter(Boolean).join(' ')}>
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

/** One board header on every Designer layer: heading, optional action, gear (or Done while editing). */
export function BoardHeader({ id, title, editing, labels, onEdit, onDone, action }: BoardHeaderProps) {
  return <SectionHeader data-board-header="" title={<span id={id} data-canvas-title="" className={CANVAS_COUNTER_SCALED_TITLE}>{title}</span>} level={3} actions={<>
    {action}
    {editing ? <Button size="sm" onPress={onDone}>{labels.done}</Button> : <Tooltip trigger={<Button variant="ghost" size="sm" aria-label={labels.changeSelection} onPress={onEdit}><Icon glyph={Settings} decorative size="sm" /></Button>}>{labels.changeSelection}</Tooltip>}
  </>} />;
}
