'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { MessageSquareIcon, PanelRightCloseIcon, SparklesIcon } from 'lucide-react';
import type { ContentMapCommandGroup, ContentMapNavigation } from '@clossys/publisher/content-map';
import {
  Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, Button,
  Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle, CommandDialog, Command, CommandEmpty, CommandGroup,
  CommandInput, CommandItem, CommandList, CommandShortcut, Separator,
  Sheet, SheetDescription, SheetHeader, SheetTitle, SidebarInset, SidebarProvider, SidebarTrigger, useSidebar, Tooltip, TooltipTrigger,
} from '@clossys/designer-ui';
import type { PageCommand } from '../studio-module';
import { studioIcon } from '../../lib/studio-icons';
import { AppSidebar } from './app-sidebar';

export { PageNotice, type PageNoticeData } from './PageNotice';

/* The open page's modules, as the page manifest's module frame reports them (read by section inputs). */
interface PageModules { open: readonly string[]; isOpen: (id: string) => boolean }
const PageModulesContext = createContext<PageModules>({ open: [], isOpen: () => false });
export function usePageModules() { return useContext(PageModulesContext); }

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    const media = window.matchMedia(query);
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, [query]);
  return matches;
}

const sentence = (value: string) => value ? value.charAt(0).toUpperCase() + value.slice(1) : value;

/** The right panel is chat only. Chat is not connected yet, so it shows its empty state; the close toggle sits in its top-right corner. */
function ChatPanel({ onClose }: { onClose?: () => void }) {
  return <Card className="flex h-full min-h-0 flex-col gap-0 rounded-none border-0 py-0 shadow-none ring-0">
    <CardHeader className="h-14 content-center border-b py-0">
      <CardTitle className="flex items-center gap-2"><SparklesIcon className="size-4 text-primary" />Chat</CardTitle>
      {onClose && <CardAction className="self-center">
        <TooltipTrigger>
          <Button variant="ghost" size="icon-sm" aria-label="Close chat" data-panel-toggle="chat" onPress={onClose}><PanelRightCloseIcon /></Button>
          <Tooltip>Close chat</Tooltip>
        </TooltipTrigger>
      </CardAction>}
    </CardHeader>
    <CardContent data-chat-empty className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
      <MessageSquareIcon className="size-5 text-muted-foreground" />
      <CardTitle className="text-sm">No conversation yet</CardTitle>
      <CardDescription>Chat with Director, Designer, Writer and Publisher will open here. Agents work through the CLI for now.</CardDescription>
    </CardContent>
  </Card>;
}

function CommandMenu({ commands, pageCommands, open, onOpenChange }: { commands: readonly ContentMapCommandGroup[]; pageCommands: readonly PageCommand[]; open: boolean; onOpenChange: (open: boolean) => void }) {
  const router = useRouter();
  return <CommandDialog open={open} onOpenChange={onOpenChange} title="Find a page" description="Search Studio pages and this page's commands">
    <Command>
      <CommandInput placeholder="Search pages and commands" />
      <CommandList aria-label="Pages" renderEmptyState={() => <CommandEmpty>No matching pages</CommandEmpty>}>
        {pageCommands.length > 0 && <CommandGroup id="page" heading="This page">
          {pageCommands.map(command => {
            const Icon = studioIcon(command.icon, command.id);
            return <CommandItem key={command.id} id={`page:${command.id}`} textValue={command.label} data-page-command={command.id} onAction={() => { onOpenChange(false); command.run(); }}>
              <Icon />{command.label}{command.shortcut && <CommandShortcut>{command.shortcut.toUpperCase()}</CommandShortcut>}
            </CommandItem>;
          })}
        </CommandGroup>}
        {commands.map(group => <CommandGroup key={group.id} id={group.id} heading={sentence(group.label)}>
          {group.items.flatMap(item => {
            if (!item.href) return [];
            const Icon = studioIcon(item.icon, item.id);
            const href = item.href;
            return [<CommandItem key={item.id} id={`${group.id}:${item.id}`} textValue={item.label} onAction={() => { onOpenChange(false); router.push(href); }}>
              <Icon />{item.label}
            </CommandItem>];
          })}
        </CommandGroup>)}
      </CommandList>
    </Command>
  </CommandDialog>;
}

/** The mobile navigation sheet closes once a destination is chosen. */
function CloseMobileNavigation() {
  const pathname = usePathname();
  const { setOpenMobile } = useSidebar();
  useEffect(() => {
    setOpenMobile(false);
    // The content column is the scroller now, so a new page starts at its top.
    document.getElementById('studio-main')?.scrollTo({ top: 0 });
  }, [pathname, setOpenMobile]);
  return null;
}

/**
 * The inputs of `frames.studio-shell`. Navigation, commands and breadcrumbs are projected by
 * Publisher from the one Studio map; `toolbar`, `modules`, `pageCommands` and `open` come from the
 * page manifest's `frames.module` (header icon buttons, the module column, the page commands).
 * `body` is the assembly's layout: both stack the sections in the padded page column with no
 * outer card (`detail` keeps the first section as the head).
 */
export interface StudioShellProps {
  homeHref: string;
  navigation: ContentMapNavigation;
  commands: readonly ContentMapCommandGroup[];
  breadcrumbs: readonly { id: string; label: string; href?: string }[];
  toolbar?: ReactNode;
  modules?: ReactNode;
  pageCommands?: readonly PageCommand[];
  open?: readonly string[];
  body?: 'plain' | 'detail';
  head?: ReactNode;
  children?: ReactNode;
}

/**
 * `frames.studio-shell`: the shadcn sidebar-07 block (aria-nova) as Studio's app shell. The sidebar
 * and the page header are the block's; Studio adds the chat panel, the module column and the
 * command menu (⌘K) around the block's inset.
 */
export default function StudioShellFrame({ navigation, commands, breadcrumbs, toolbar, modules, pageCommands = [], open = [], body = 'plain', head, children }: StudioShellProps) {
  const [searchOpen, setSearchOpen] = useState(false);
  const wide = useMediaQuery('(min-width: 1280px)');
  const [chatOpen, setChatOpen] = useState(true);
  const [chatSheet, setChatSheet] = useState(false);
  const pageModules = { open, isOpen: (id: string) => open.includes(id) };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === 'k' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); setSearchOpen(value => !value); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const toggleChat = () => { if (wide) setChatOpen(value => !value); else setChatSheet(true); };

  // The frame is exactly viewport height: sidebar and chat stay put, only the content column scrolls.
  return <SidebarProvider className="h-svh overflow-hidden">
    <CloseMobileNavigation />
    <AppSidebar navigation={navigation} />
    <SidebarInset className="grid min-h-0 min-w-0 grid-cols-1 grid-rows-[auto_auto_minmax(0,1fr)] overflow-hidden md:grid-cols-[minmax(0,1fr)_auto] md:grid-rows-[auto_minmax(0,1fr)]">
      {/* The block's header; Studio places it across the grid and keeps the page toolbar at its end. */}
      <header className="flex h-16 shrink-0 items-center gap-2 transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-12 col-span-full pr-4 *:first:min-w-0 *:first:flex-1">
        <div className="flex items-center gap-2 px-4">
          <SidebarTrigger className="-ml-1" data-panel-toggle="rail" />
          <Separator
            orientation="vertical"
            className="mr-2 data-vertical:h-4 data-vertical:self-auto"
          />
          <Breadcrumb>
            <BreadcrumbList>
              {breadcrumbs.map((crumb, index) => index < breadcrumbs.length - 1
                ? <BreadcrumbItem key={crumb.id} id={crumb.id} className="hidden md:inline-flex">
                  {crumb.href ? <BreadcrumbLink href={crumb.href}>{crumb.label}</BreadcrumbLink> : <BreadcrumbPage>{crumb.label}</BreadcrumbPage>}
                </BreadcrumbItem>
                : <BreadcrumbItem key={crumb.id} id={crumb.id}>
                  <BreadcrumbPage>{crumb.label}</BreadcrumbPage>
                </BreadcrumbItem>)}
            </BreadcrumbList>
          </Breadcrumb>
        </div>
        {toolbar}
        {!(wide && chatOpen) && <TooltipTrigger>
          <Button variant="ghost" size="icon-sm" aria-label="Open chat" data-panel-toggle="chat" onPress={toggleChat}><MessageSquareIcon /></Button>
          <Tooltip>Open chat</Tooltip>
        </TooltipTrigger>}
      </header>
      <main id="studio-main" data-body={body} className="row-start-3 flex min-h-0 min-w-0 flex-col gap-6 overflow-x-hidden overflow-y-auto overscroll-contain p-4 md:col-start-1 md:row-start-2 md:p-6 *:shrink-0">
        <PageModulesContext.Provider value={pageModules}>{head}{children}</PageModulesContext.Provider>
      </main>
      {modules}
    </SidebarInset>
    {wide && chatOpen && <aside aria-label="Chat" className="h-svh min-h-0 w-80 shrink-0 border-l bg-background"><ChatPanel onClose={() => setChatOpen(false)} /></aside>}
    <CommandMenu commands={commands} pageCommands={pageCommands} open={searchOpen} onOpenChange={setSearchOpen} />
    {!wide && <Sheet isOpen={chatSheet} onOpenChange={setChatSheet} side="right" className="w-[22rem] max-w-[90vw] p-0">
      <SheetHeader className="sr-only"><SheetTitle>Chat</SheetTitle><SheetDescription>Ask an agent about the open page.</SheetDescription></SheetHeader>
      <ChatPanel />
    </Sheet>}
  </SidebarProvider>;
}
