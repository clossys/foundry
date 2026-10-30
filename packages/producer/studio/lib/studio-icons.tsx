import type { ComponentType, SVGProps } from 'react';
import {
  BotIcon, CheckCircle2Icon, CircleAlertIcon, CodeIcon, CompassIcon, FolderTreeIcon, HouseIcon,
  InfoIcon, ListTodoIcon, PaletteIcon, PenLineIcon, SendIcon, UsersIcon,
} from 'lucide-react';

type Icon = ComponentType<SVGProps<SVGSVGElement>>;

/** Publisher icon assets mapped onto the lucide set shadcn ships with. */
const ASSET_ICONS: Record<string, Icon> = {
  'assets.icon-home': HouseIcon,
  'assets.icon-team': UsersIcon,
  'assets.icon-explorer': FolderTreeIcon,
  'assets.icon-inspector': InfoIcon,
  'assets.icon-source': CodeIcon,
  'assets.icon-checks': CheckCircle2Icon,
  'assets.icon-needs': ListTodoIcon,
};
const AGENT_ICONS: Record<string, Icon> = { director: CompassIcon, designer: PaletteIcon, writer: PenLineIcon, publisher: SendIcon };

export function studioIcon(asset: string | undefined, id?: string): Icon {
  return (asset ? ASSET_ICONS[asset] : undefined) ?? (id ? AGENT_ICONS[id] : undefined) ?? (asset ? CircleAlertIcon : BotIcon);
}
