'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { ArrowUpIcon, ChevronsUpDownIcon, MessageSquareIcon, MoonIcon, SearchIcon, SparklesIcon, SunIcon, TriangleAlertIcon } from 'lucide-react';
import type { ContentMapCommandGroup, ContentMapNavigation } from '@clossys/publisher/content-map';
import {
  Avatar, AvatarFallback, AvatarImage, Badge, Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, Button,
  Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle, CommandDialog, Command, CommandEmpty, CommandGroup,
  CommandInput, CommandItem, CommandList, CommandShortcut, Field, FieldContent, FieldDescription, FieldGroup, FieldTitle, Popover, PopoverDescription, PopoverHeader, PopoverTitle, PopoverTrigger,
  ScrollArea, Separator, Sheet, SheetDescription, SheetHeader, SheetTitle, Sidebar, SidebarContent, SidebarFooter, SidebarGroup,
  SidebarGroupContent, SidebarGroupLabel, SidebarHeader, SidebarInset, SidebarMenu, SidebarMenuButton, SidebarMenuItem,
  SidebarProvider, SidebarRail, SidebarTrigger, Skeleton, Textarea, useSidebar, Tooltip, TooltipTrigger,
} from '@clossys/designer-ui';
import type { ContentMapPageAction } from '@clossys/publisher/content-map';
import { studioIcon } from '../../lib/studio-icons';
import type { StudioReport } from '../../lib/studio-report';
import { useStudioData, useThemeMode } from '../../components/StudioProviders';

export { PageNotice, type PageNoticeData } from './PageNotice';
export type StudioPageAction = ContentMapPageAction;

/* Page modules: the header icon actions toggle the modules a page declares. */
interface PageModules { actions: readonly StudioPageAction[]; isOpen: (id: string) => boolean; toggle: (id: string) => void }
const PageModulesContext = createContext<PageModules>({ actions: [], isOpen: () => false, toggle: () => {} });
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
const SEVERITY_BADGE = { error: 'destructive', warning: 'secondary', info: 'outline' } as const;

export function ReportList({ reports, empty = 'Nothing needs attention.' }: { reports: readonly StudioReport[]; empty?: string }) {
  if (!reports.length) return <FieldDescription>{empty}</FieldDescription>;
  return <FieldGroup className="gap-3">
    {reports.map(report => <Field key={report.id} className="gap-1">
      <FieldTitle><Badge variant={SEVERITY_BADGE[report.severity]}>{sentence(report.severity)}</Badge>{report.title}</FieldTitle>
      <FieldDescription className="text-xs leading-relaxed">{report.detail}</FieldDescription>
    </Field>)}
  </FieldGroup>;
}

function ReportsPopover() {
  const { reports } = useStudioData();
  const list = reports.state === 'ready' ? reports.value : [];
  const attention = list.filter(report => report.severity !== 'info').length;
  return <PopoverTrigger>
    <TooltipTrigger>
      <Button variant="ghost" size="icon-sm" aria-label={`Reports, ${list.length} open`} className="relative">
        <TriangleAlertIcon />
        {attention > 0 && <Badge aria-hidden className="absolute -top-1 -right-1 h-4 min-w-4 px-1 text-[10px] tabular-nums">{attention}</Badge>}
      </Button>
      <Tooltip>Reports</Tooltip>
    </TooltipTrigger>
    <Popover placement="bottom end" className="w-80">
      <PopoverHeader>
        <PopoverTitle>Reports</PopoverTitle>
        <PopoverDescription>Producer facts that do not block Studio.</PopoverDescription>
      </PopoverHeader>
      <Separator />
      {reports.state === 'error' ? <FieldDescription className="text-destructive">{reports.message}</FieldDescription> : <ReportList reports={list} />}
    </Popover>
  </PopoverTrigger>;
}

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

function ChatPanel() {
  return <Card className="flex h-full min-h-0 flex-col gap-0 rounded-none border-0 py-0 shadow-none ring-0">
    <CardHeader className="border-b py-4">
      <CardTitle className="flex items-center gap-2"><SparklesIcon className="size-4 text-primary" />Chat</CardTitle>
      <CardDescription>Ask an agent about the open page.</CardDescription>
    </CardHeader>
    <CardContent className="min-h-0 flex-1 px-0">
      <ScrollArea className="h-full px-4 py-4">
        <CardContent className="flex flex-col gap-3 px-0">
          <CardDescription className="max-w-[85%] rounded-lg bg-muted px-3 py-2 text-foreground">Conversations with Director, Designer, Writer and Publisher will appear here.</CardDescription>
          <CardDescription className="text-xs">Chat is not connected in this build. Agents work through the CLI for now.</CardDescription>
        </CardContent>
      </ScrollArea>
    </CardContent>
    <CardFooter className="items-end gap-2 border-t p-3">
      <Textarea aria-label="Message" placeholder="Message an agent" rows={2} className="min-h-0 flex-1 resize-none" disabled />
      <Button size="icon" aria-label="Send message" isDisabled><ArrowUpIcon /></Button>
    </CardFooter>
  </Card>;
}

function CommandMenu({ commands, open, onOpenChange }: { commands: readonly ContentMapCommandGroup[]; open: boolean; onOpenChange: (open: boolean) => void }) {
  const router = useRouter();
  return <CommandDialog open={open} onOpenChange={onOpenChange} title="Find a page" description="Search Studio pages">
    <Command>
      <CommandInput placeholder="Search pages" />
      <CommandList aria-label="Pages" renderEmptyState={() => <CommandEmpty>No matching pages</CommandEmpty>}>
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

const defaultModules = (actions: readonly StudioPageAction[]): ReadonlySet<string> => new Set(actions.filter(action => action.defaultOpen).map(action => action.id));

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
 * The inputs of `frames.studio-shell`, all projected by Publisher from the one Studio map:
 * the rail navigation, the command menu, the breadcrumbs and the page's module actions.
 * `body` is the assembly's layout: both stack the sections in the padded page column with no
 * outer card (`detail` keeps the first section as the head).
 */
export interface StudioShellProps {
  homeHref: string;
  navigation: ContentMapNavigation;
  commands: readonly ContentMapCommandGroup[];
  breadcrumbs: readonly { id: string; label: string; href?: string }[];
  actions: readonly StudioPageAction[];
  body?: 'plain' | 'detail';
  head?: ReactNode;
  children?: ReactNode;
}

/** `frames.studio-shell`: the Studio app shell, built from the shadcn sidebar-07 block parts. */
export default function StudioShellFrame({ homeHref, navigation, commands, breadcrumbs, actions, body = 'plain', head, children }: StudioShellProps) {
  const [searchOpen, setSearchOpen] = useState(false);
  const wide = useMediaQuery('(min-width: 1280px)');
  const [chatOpen, setChatOpen] = useState(true);
  const [chatSheet, setChatSheet] = useState(false);
  // Module state belongs to the page: a new page starts from its declared defaults.
  const [state, setState] = useState(() => ({ actions, open: defaultModules(actions) }));
  if (state.actions !== actions) setState({ actions, open: defaultModules(actions) });
  const open = state.actions === actions ? state.open : defaultModules(actions);
  const toggle = useCallback((id: string) => setState(current => {
    const next = new Set(current.open);
    if (next.has(id)) next.delete(id); else next.add(id);
    return { actions: current.actions, open: next };
  }), []);
  const modules = useMemo(() => ({ actions, isOpen: (id: string) => open.has(id), toggle }), [actions, open, toggle]);
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
    <SidebarInset className="min-h-0 min-w-0 overflow-hidden">
      <header className="z-10 flex h-14 shrink-0 items-center gap-2 border-b bg-background/95 px-3 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <SidebarTrigger aria-label="Toggle navigation" />
        <Separator orientation="vertical" className="mx-1 h-4 self-center!" />
        <Breadcrumb className="min-w-0 flex-1">
          <BreadcrumbList className="flex-nowrap overflow-hidden">
            {breadcrumbs.map((crumb, index) => <BreadcrumbItem key={crumb.id} id={crumb.id} className={index < breadcrumbs.length - 1 ? 'hidden truncate md:inline-flex' : 'truncate'}>
              {crumb.href && index < breadcrumbs.length - 1 ? <BreadcrumbLink href={crumb.href}>{crumb.label}</BreadcrumbLink> : <BreadcrumbPage className="truncate">{crumb.label}</BreadcrumbPage>}
            </BreadcrumbItem>)}
          </BreadcrumbList>
        </Breadcrumb>
          {actions.map(action => {
            const Icon = studioIcon(action.icon, action.id);
            const pressed = open.has(action.id);
            return <TooltipTrigger key={action.id}>
              <Button variant={pressed ? 'secondary' : 'ghost'} size="icon-sm" aria-label={action.label} aria-pressed={pressed} onPress={() => toggle(action.id)}><Icon /></Button>
              <Tooltip>{action.label}</Tooltip>
            </TooltipTrigger>;
          })}
          {actions.length > 0 && <Separator orientation="vertical" className="mx-1 h-4 self-center!" />}
          <ReportsPopover />
          <TooltipTrigger>
            <Button variant={wide && chatOpen ? 'secondary' : 'ghost'} size="icon-sm" aria-label="Chat" aria-pressed={wide && chatOpen} onPress={toggleChat}><MessageSquareIcon /></Button>
            <Tooltip>Chat</Tooltip>
          </TooltipTrigger>
      </header>
      <main id="studio-main" data-body={body} className="flex min-h-0 min-w-0 flex-1 flex-col gap-6 overflow-x-hidden overflow-y-auto overscroll-contain p-4 md:p-6">
        <PageModulesContext.Provider value={modules}>{head}{children}</PageModulesContext.Provider>
      </main>
    </SidebarInset>
    {wide && chatOpen && <aside aria-label="Chat" className="h-svh min-h-0 w-80 shrink-0 border-l bg-background"><ChatPanel /></aside>}
    <CommandMenu commands={commands} open={searchOpen} onOpenChange={setSearchOpen} />
    {!wide && <Sheet isOpen={chatSheet} onOpenChange={setChatSheet} side="right" className="w-[22rem] max-w-[90vw] p-0">
      <SheetHeader className="sr-only"><SheetTitle>Chat</SheetTitle><SheetDescription>Ask an agent about the open page.</SheetDescription></SheetHeader>
      <ChatPanel />
    </Sheet>}
  </SidebarProvider>;
}
