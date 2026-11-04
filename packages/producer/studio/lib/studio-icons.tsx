import type { ComponentType, SVGProps } from 'react';
import {
  BotIcon, CheckCircle2Icon, CircleAlertIcon, CodeIcon, CompassIcon, FolderTreeIcon, HistoryIcon, HouseIcon,
  InfoIcon, LinkIcon, ListIcon, ListTodoIcon, MessageSquarePlusIcon, PaletteIcon, PenLineIcon, SendIcon, UsersIcon,
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
  'assets.icon-outline': ListIcon,
  'assets.icon-link': LinkIcon,
  'assets.icon-request': MessageSquarePlusIcon,
  'assets.icon-versions': HistoryIcon,
  'assets.icon-guide': CompassIcon,
  'assets.icon-layers': PaletteIcon,
  'assets.icon-document': PenLineIcon,
  'assets.icon-website': SendIcon,
};

/** The icon a content-map entry names; an entry without one gets the generic agent mark. */
export function studioIcon(asset: string | undefined): Icon {
  return (asset ? ASSET_ICONS[asset] : undefined) ?? (asset ? CircleAlertIcon : BotIcon);
}
