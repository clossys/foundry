'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { ChevronsUpDownIcon, MessageSquareIcon, MoonIcon, PanelRightCloseIcon, SearchIcon, SparklesIcon, SunIcon } from 'lucide-react';
import type { ContentMapCommandGroup, ContentMapNavigation } from '@clossys/publisher/content-map';
import {
  Avatar, AvatarFallback, AvatarImage, Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, Button,
  Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle, CommandDialog, Command, CommandEmpty, CommandGroup,
  CommandInput, CommandItem, CommandList, CommandShortcut, FieldContent, FieldDescription, FieldTitle, Popover, PopoverDescription, PopoverHeader, PopoverTitle, PopoverTrigger,
  Sheet, SheetDescription, SheetHeader, SheetTitle, Sidebar, SidebarContent, SidebarFooter, SidebarGroup,
  SidebarGroupContent, SidebarGroupLabel, SidebarHeader, SidebarInset, SidebarMenu, SidebarMenuButton, SidebarMenuItem,
  SidebarProvider, SidebarRail, SidebarTrigger, Skeleton, useSidebar, Tooltip, TooltipTrigger,
} from '@clossys/designer-ui';
import type { PageCommand } from '../studio-module';
import { studioIcon } from '../../lib/studio-icons';
import { useStudioData, useThemeMode } from '../../components/StudioProviders';

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

/**
 * The consumer's mark for one ground. The shadcn avatar shows its fallback until the served SVG
 * has loaded and again if it fails, so the rail never shows an empty mark in either theme.
 */
function BrandMark({ ground, initial }: { ground: 'light' | 'dark'; initial: string }) {
  return <Avatar data-brand-mark={ground} className={`rounded-md after:hidden ${ground === 'light' ? 'dark:hidden' : 'hidden dark:flex'}`}>
    <AvatarImage src={`/api/brand/mark.svg?ground=${ground}`} alt="" className="rounded-none object-contain" />
    <AvatarFallback className="rounded-md bg-sidebar-primary font-heading text-sidebar-primary-foreground">{initial}</AvatarFallback>
  </Avatar>;
}

/** The consumer's own mark and name from its Designer output; Studio is the product beneath it. */
function BrandButton({ homeHref }: { homeHref: string }) {
  const { brand } = useStudioData();
  const name = brand.state === 'ready' ? brand.value.name : undefined;
  const initial = (name ?? 'Studio').charAt(0).toUpperCase();
  return <SidebarMenuButton size="lg" href={homeHref} tooltip={name ? `${name} Studio` : 'Studio'}>
    <BrandMark ground="light" initial={initial} />
    <BrandMark ground="dark" initial={initial} />
    <FieldContent className="min-w-0 gap-0 leading-tight">
      {brand.state === 'loading' ? <Skeleton className="h-4 w-20" /> : <FieldTitle className="w-full truncate font-heading text-[15px] font-semibold tracking-tight">{name ?? 'Studio'}</FieldTitle>}
      <FieldDescription className="truncate text-xs">{name ? 'Studio' : 'Local workspace'}</FieldDescription>
    </FieldContent>
  </SidebarMenuButton>;
}

function AccountMenu() {
  return <PopoverTrigger>
    <SidebarMenuButton size="lg" aria-label="Account">
      <Avatar size="sm"><AvatarFallback>LW</AvatarFallback></Avatar>
      <FieldContent className="min-w-0 gap-0 leading-tight">
        <FieldTitle className="w-full truncate">Local workspace</FieldTitle>
        <FieldDescription className="truncate text-xs">Producer on this machine</FieldDescription>
      </FieldContent>
      <ChevronsUpDownIcon className="ml-auto" />
    </SidebarMenuButton>
    <Popover placement="top start" className="w-64">
      <PopoverHeader>
        <PopoverTitle>Local workspace</PopoverTitle>
        <PopoverDescription>Studio reads cells from the Producer running on this machine.</PopoverDescription>
      </PopoverHeader>
    </Popover>
  </PopoverTrigger>;
}

/** One binary light/dark icon beside the account button (shadcn sidebar footer pattern). */
function ThemeToggle() {
  const { resolved, setMode } = useThemeMode();
  const next = resolved === 'dark' ? 'light' : 'dark';
  return <TooltipTrigger>
    <Button variant="ghost" size="icon-sm" aria-label={`Switch to ${next} theme`} data-theme-toggle={resolved} className="shrink-0 group-data-[collapsible=icon]:hidden" onPress={() => setMode(next)}>
      {resolved === 'dark' ? <SunIcon /> : <MoonIcon />}
    </Button>
    <Tooltip>{next === 'dark' ? 'Dark theme' : 'Light theme'}</Tooltip>
  </TooltipTrigger>;
}

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

/** On a phone the rail is a sheet, so its toggle sits in the page header's top-left corner instead. */
function MobileRailToggle() {
  const { isMobile } = useSidebar();
  if (!isMobile) return null;
  return <SidebarTrigger aria-label="Open navigation" data-panel-toggle="rail" />;
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

/** `frames.studio-shell`: the Studio app shell, built from the shadcn sidebar-07 block parts. */
export default function StudioShellFrame({ homeHref, navigation, commands, breadcrumbs, toolbar, modules, pageCommands = [], open = [], body = 'plain', head, children }: StudioShellProps) {
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
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem className="flex h-10 items-center max-md:hidden">
            <TooltipTrigger>
              <SidebarTrigger aria-label="Toggle navigation" data-panel-toggle="rail" />
              <Tooltip>Toggle navigation</Tooltip>
            </TooltipTrigger>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <BrandButton homeHref={homeHref} />
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton tooltip="Search" onPress={() => setSearchOpen(true)} aria-label="Search pages">
              <SearchIcon /><span>Search</span><CommandShortcut className="ml-auto">⌘K</CommandShortcut>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        {navigation.tree.map(node => {
          const NodeIcon = studioIcon(node.icon, node.id);
          if (!node.children?.length) {
            return node.href ? <SidebarGroup key={node.id}><SidebarGroupContent><SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton href={node.href} isActive={navigation.activeId === node.id} tooltip={node.label}><NodeIcon /><span>{node.label}</span></SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu></SidebarGroupContent></SidebarGroup> : null;
          }
          return <SidebarGroup key={node.id}>
            <SidebarGroupLabel>{node.label}</SidebarGroupLabel>
            <SidebarGroupContent><SidebarMenu>
              {node.children.map(child => {
                if (!child.href) return null;
                const ChildIcon = studioIcon(child.icon, child.id);
                return <SidebarMenuItem key={child.id}>
                  <SidebarMenuButton href={child.href} isActive={navigation.activeId === child.id} tooltip={child.label}><ChildIcon /><span>{child.label}</span></SidebarMenuButton>
                </SidebarMenuItem>;
              })}
            </SidebarMenu></SidebarGroupContent>
          </SidebarGroup>;
        })}
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu><SidebarMenuItem className="flex items-center gap-1"><AccountMenu /><ThemeToggle /></SidebarMenuItem></SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
    <SidebarInset className="grid min-h-0 min-w-0 grid-cols-1 grid-rows-[auto_auto_minmax(0,1fr)] overflow-hidden md:grid-cols-[minmax(0,1fr)_auto] md:grid-rows-[auto_minmax(0,1fr)]">
      <header className="z-10 col-span-full flex h-14 shrink-0 items-center gap-1 border-b bg-background/95 px-3 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <MobileRailToggle />
        <Breadcrumb className="min-w-0 flex-1 px-1">
          <BreadcrumbList className="flex-nowrap overflow-hidden">
            {breadcrumbs.map((crumb, index) => <BreadcrumbItem key={crumb.id} id={crumb.id} className={index < breadcrumbs.length - 1 ? 'hidden truncate md:inline-flex' : 'truncate'}>
              {crumb.href && index < breadcrumbs.length - 1 ? <BreadcrumbLink href={crumb.href}>{crumb.label}</BreadcrumbLink> : <BreadcrumbPage className="truncate">{crumb.label}</BreadcrumbPage>}
            </BreadcrumbItem>)}
          </BreadcrumbList>
        </Breadcrumb>
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
