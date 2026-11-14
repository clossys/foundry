import type { ComponentType, SVGProps } from 'react';
import { STUDIO_ICONS } from '../generated/studio-icons';

type Icon = ComponentType<SVGProps<SVGSVGElement>>;

/** A record that names no icon draws none. */
const NoIcon: Icon = () => null;

/**
 * The icon a Publisher record names, from the generated map of pinned assets.icon-* candidates.
 * An id with no pinned icon slot fails loudly (foundry-audit-0001): it is a dangling reference, not
 * an empty icon, and the fix is a Designer assets.icon-* slot, never a hand-written glyph here.
 */
export function studioIcon(asset: string | undefined): Icon {
  if (!asset) return NoIcon;
  const icon = STUDIO_ICONS[asset];
  if (icon === undefined) throw new Error(`icon ${asset} resolves to no pinned assets.icon-* slot (studio/generated/studio-icons.ts)`);
  return icon;
}
