import type { ComponentType, SVGProps } from 'react';
import { STUDIO_ICONS } from '../generated/studio-icons';

type Icon = ComponentType<SVGProps<SVGSVGElement>>;

/** An icon id with no pinned icon slot draws nothing: the map is generated from the pins alone. */
const NoIcon: Icon = () => null;

/** The icon a Publisher record names, from the generated map of pinned assets.icon-* candidates. */
export function studioIcon(asset: string | undefined): Icon {
  return (asset ? STUDIO_ICONS[asset] : undefined) ?? NoIcon;
}
