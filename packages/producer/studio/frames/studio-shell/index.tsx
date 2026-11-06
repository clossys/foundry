'use client';

import {
  Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, Button,
  CommandDialog, Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandShortcut,
  FieldGroup, Item, ItemActions, ItemContent,
  PopoverDescription, PopoverHeader, PopoverTitle, ScrollArea, Separator,
  Sidebar, SidebarGroup, SidebarInset, SidebarProvider, SidebarTrigger,
  useSidebar,
} from '@clossys/designer-ui';
import { AppSidebar, type ShellNavigation, type SidebarCopy } from './app-sidebar';
import { HeaderIconButton, HeaderPopover, HeaderTooltip } from './stock-header-controls';
import { ChatContent, type ChatCopy } from './stock-chat-sidebar';

export { PageNotice, type PageNoticeData } from './PageNotice';
export { AppSidebar, type ShellNavigation, type SidebarCopy } from './app-sidebar';
export type { NavMainItem } from './nav-main';
export type { ChatCopy } from './stock-chat-sidebar';
export type { ShellTeam } from './team-switcher';
export type { ShellUser } from './nav-user';

/** Every word the shell shows (Writer copy, resolved by the page): controls, the command menu, chat and sidebar (the page resolves `sidebar` into `navigation`). */
export interface StudioShellCopy {
  copied: string;
  copyPrompt: string;
  search: { title: string; description: string; placeholder: string; label: string; empty: string; page: string };
  resizeChat: string;
  toggleSidebar: string;
  toggleTheme: string;
  toggleChat: string;
  chat: ChatCopy;
  sidebar: SidebarCopy;
}

/** One header popover as the page shows it: its trigger glyph, open state, heading and body. */
export interface ShellPopover {
  id: string;
  label: string;
  icon?: React.ReactNode;
  shortcut?: string;
  description?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** A module popover's placed section. */
  body?: React.ReactNode;
  /** An action popover's text and its copy button state. */
  copy?: { text: string; copied: boolean; onCopy: () => void };
}

/** One command menu entry: a page to open or a page command to run. */
export interface ShellCommand { id: string; label: string; icon?: React.ReactNode; shortcut?: string; onAction: () => void; [data: `data-${string}`]: string }

/** The command menu: its open state and its groups (the page's own commands first). */
export interface ShellCommands {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  groups: readonly { id: string; heading: string; items: readonly ShellCommand[] }[];
}

/**
 * The inputs of `frames.studio-shell`, each already resolved by the page: navigation, commands and
 * breadcrumbs are Publisher's projections of the one Studio map, `popovers` the page manifest's
 * modules and actions (one header icon each). Every state is the page's: the left sidebar's open
 * state (`open`), the chat (`chat`), the theme control (`theme`) and the mobile sheet's panel.
 * `bridge` is rendered inside the stock SidebarProvider and draws nothing. `body` is the assembly's
 * layout: both stack the sections in the page column (`detail` keeps the first section as the head).
 */
export interface StudioShellProps {
  navigation: ShellNavigation;
  commands: ShellCommands;
  breadcrumbs: readonly { id: string; label: string; href?: string }[];
  copy: StudioShellCopy;
  popovers?: readonly ShellPopover[];
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  theme?: { dark: boolean; icon?: React.ReactNode; onToggle?: () => void };
  chat?: { open: boolean; pressed: boolean; icon?: React.ReactNode; titleIcon?: React.ReactNode; emptyIcon?: React.ReactNode; onToggle?: () => void };
  mobilePanel?: 'left' | 'chat';
  onLeftToggle?: () => void;
  bridge?: React.ReactNode;
  body?: 'plain' | 'detail';
  head?: React.ReactNode;
  children?: React.ReactNode;
}

/** An action popover's body: the text it copies, then the stock copy button. */
function CopyBody({ id, copy, words }: { id: string; copy: NonNullable<ShellPopover['copy']>; words: StudioShellCopy }) {
  return <>
    <PopoverDescription data-popover-text={id}>{copy.text}</PopoverDescription>
    <Button size="sm" data-popover-copy={id} onPress={copy.onCopy}>{copy.copied ? words.copied : words.copyPrompt}</Button>
  </>;
}

/** The stock command dialog over the given groups. */
function CommandMenu({ commands, copy }: { commands: ShellCommands; copy: StudioShellCopy['search'] }) {
  return <CommandDialog open={commands.open} onOpenChange={commands.onOpenChange} title={copy.title} description={copy.description}>
    <Command>
      <CommandInput placeholder={copy.placeholder} />
      <CommandList aria-label={copy.label} renderEmptyState={() => <CommandEmpty>{copy.empty}</CommandEmpty>}>
        {commands.groups.filter(group => group.items.length).map(group => <CommandGroup key={group.id} id={group.id} heading={group.heading}>
          {group.items.map(({ id, label, icon, shortcut, onAction, ...data }) => <CommandItem key={id} id={`${group.id}:${id}`} textValue={label} {...data} onAction={onAction}>
            {icon}{label}{shortcut && <CommandShortcut>{shortcut.toUpperCase()}</CommandShortcut>}
          </CommandItem>)}
        </CommandGroup>)}
      </CommandList>
    </Command>
  </CommandDialog>;
}

/**
 * `frames.studio-shell` is the shadcn sidebar-15 page (aria-nova) composed of stock parts: the
 * provider, the left sidebar, the inset with its header row and body column, and the right sidebar
 * (the chat). The header's far-left icon toggles the left sidebar, its far-right icon (after a
 * divider) the chat; every other header icon opens its module or action as a popover anchored to
 * it. Below the stock `md` mobile boundary both sidebars open in the stock Sidebar's own mobile
 * sheet, one at a time. The frame holds no state of its own: the page owns every open state.
 */
export default function StudioShellFrame({ open, onOpenChange, bridge, ...given }: StudioShellProps & { [marker: `data-clossys-${string}`]: string }) {
  const provenance = Object.fromEntries(Object.entries(given).filter(([key]) => key.startsWith('data-clossys-'))) as { [marker: `data-clossys-${string}`]: string };
  const props = Object.fromEntries(Object.entries(given).filter(([key]) => !key.startsWith('data-clossys-'))) as unknown as StudioShellProps;
  return <SidebarProvider open={open} onOpenChange={onOpenChange} {...provenance}>
    {bridge}
    <StudioShellContent {...props} />
  </SidebarProvider>;
}

function StudioShellContent({ navigation, commands, breadcrumbs, copy, popovers = [], theme, chat, mobilePanel = 'left', onLeftToggle, body = 'plain', head, children }: StudioShellProps) {
  const { isMobile } = useSidebar();
  return <>
    {!isMobile && <AppSidebar navigation={navigation} />}
    <SidebarInset>
      <header>
      <Item size="sm" data-studio-header>
        <ItemActions>
          <HeaderTooltip label={copy.toggleSidebar}><SidebarTrigger data-panel-toggle="left" onPress={onLeftToggle} /></HeaderTooltip>
          <Separator orientation="vertical" className="mr-2 data-[orientation=vertical]:h-4" />
        </ItemActions>
        <ItemContent>
          <Breadcrumb>
            <BreadcrumbList>
              {breadcrumbs.map((crumb, index) => index < breadcrumbs.length - 1
                ? <BreadcrumbItem key={crumb.id} id={crumb.id}>
                  {crumb.href ? <BreadcrumbLink href={crumb.href}>{crumb.label}</BreadcrumbLink> : <BreadcrumbPage>{crumb.label}</BreadcrumbPage>}
                </BreadcrumbItem>
                : <BreadcrumbItem key={crumb.id} id={crumb.id}>
                  <BreadcrumbPage className="line-clamp-1">{crumb.label}</BreadcrumbPage>
                </BreadcrumbItem>)}
            </BreadcrumbList>
          </Breadcrumb>
        </ItemContent>
        <ItemActions>
          {popovers.map(spec => <HeaderPopover key={spec.id} id={spec.id} label={spec.label} shortcut={spec.shortcut} open={spec.open} onOpenChange={spec.onOpenChange} content={<>
            <PopoverHeader>
              <PopoverTitle>{spec.label}</PopoverTitle>
              {spec.description && <PopoverDescription>{spec.description}</PopoverDescription>}
            </PopoverHeader>
            {spec.copy ? <CopyBody id={spec.id} copy={spec.copy} words={copy} /> : <ScrollArea data-popover-body={spec.id}>{spec.body}</ScrollArea>}
          </>}>{spec.icon}</HeaderPopover>)}
          {theme && <HeaderIconButton label={copy.toggleTheme} aria-pressed={theme.dark} data-theme-toggle onPress={theme.onToggle}>{theme.icon}</HeaderIconButton>}
          <Separator orientation="vertical" className="mr-2 data-[orientation=vertical]:h-4" />
          <HeaderIconButton label={copy.toggleChat} aria-pressed={chat?.pressed ?? false} data-panel-toggle="chat" onPress={chat?.onToggle}>{chat?.icon}</HeaderIconButton>
        </ItemActions>
      </Item>
      </header>
      <SidebarGroup>
        <FieldGroup id="studio-main" data-body={body}>
          {head}{children}
        </FieldGroup>
      </SidebarGroup>
    </SidebarInset>
    {!isMobile && chat?.open && <Sidebar collapsible="none" className="sticky top-0 hidden h-svh border-l lg:flex" aria-label={copy.chat.title} data-panel="chat">
      <ChatContent copy={copy.chat} icon={chat.titleIcon} emptyIcon={chat.emptyIcon} />
    </Sidebar>}
    <CommandMenu commands={commands} copy={copy.search} />
    {isMobile && <Sidebar side={mobilePanel === 'chat' ? 'right' : 'left'} data-panel={mobilePanel}>
      {mobilePanel === 'chat' ? <ChatContent copy={copy.chat} icon={chat?.titleIcon} emptyIcon={chat?.emptyIcon} /> : <AppSidebar navigation={navigation} collapsible="none" />}
    </Sidebar>}
  </>;
}
