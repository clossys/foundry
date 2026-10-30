'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { ArrowUpIcon, ChevronsUpDownIcon, MessageSquareIcon, MonitorIcon, MoonIcon, SearchIcon, SparklesIcon, SunIcon, TriangleAlertIcon } from 'lucide-react';
import type { ContentMapCommandGroup, ContentMapNavigation } from '@clossys/publisher/content-map';
import {
  Avatar, AvatarFallback, Badge, Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, Button,
  Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle, CommandDialog, Command, CommandEmpty, CommandGroup,
  CommandInput, CommandItem, CommandList, CommandShortcut, Popover, PopoverDescription, PopoverHeader, PopoverTitle, PopoverTrigger,
  ScrollArea, Separator, Sheet, SheetDescription, SheetHeader, SheetTitle, Sidebar, SidebarContent, SidebarFooter, SidebarGroup,
  SidebarGroupContent, SidebarGroupLabel, SidebarHeader, SidebarInset, SidebarMenu, SidebarMenuButton, SidebarMenuItem,
  SidebarProvider, SidebarRail, SidebarTrigger, Textarea, useSidebar, Tooltip, TooltipTrigger,
} from '@clossys/designer-ui';
import { studioBreadcrumbs, studioCommands, studioHome, studioNavigation, studioPageActions, studioRouteForPath, type StudioPageAction } from '../generated/studio-map';
import { studioIcon } from '../lib/studio-icons';
import type { StudioReport } from '../lib/studio-report';
import { useStudioData, useThemeMode, type ThemeMode } from './StudioProviders';

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
  if (!reports.length) return <p className="text-sm text-muted-foreground">{empty}</p>;
  return <ul className="flex flex-col gap-3">
    {reports.map(report => <li key={report.id} className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <Badge variant={SEVERITY_BADGE[report.severity]}>{sentence(report.severity)}</Badge>
        <span className="text-sm font-medium">{report.title}</span>
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">{report.detail}</p>
    </li>)}
  </ul>;
}

function ReportsPopover() {
  const { reports } = useStudioData();
  const list = reports.state === 'ready' ? reports.value : [];
  const attention = list.filter(report => report.severity !== 'info').length;
  return <PopoverTrigger>
    <TooltipTrigger>
      <Button variant="ghost" size="icon-sm" aria-label={`Reports, ${list.length} open`} className="relative">
        <TriangleAlertIcon />
        {attention > 0 && <span aria-hidden className="absolute -top-0.5 -right-0.5 flex size-4 items-center justify-center rounded-full bg-primary text-[10px] font-medium text-primary-foreground">{attention}</span>}
      </Button>
      <Tooltip>Reports</Tooltip>
    </TooltipTrigger>
    <Popover placement="bottom end" className="w-80">
      <PopoverHeader>
        <PopoverTitle>Reports</PopoverTitle>
        <PopoverDescription>Producer facts that do not block Studio.</PopoverDescription>
      </PopoverHeader>
      <Separator />
      {reports.state === 'error' ? <p className="text-sm text-destructive">{reports.message}</p> : <ReportList reports={list} />}
    </Popover>
  </PopoverTrigger>;
}

const THEME_OPTIONS: { mode: ThemeMode; label: string; Icon: typeof SunIcon }[] = [
  { mode: 'light', label: 'Light', Icon: SunIcon },
  { mode: 'dark', label: 'Dark', Icon: MoonIcon },
  { mode: 'system', label: 'System', Icon: MonitorIcon },
];

function AccountMenu() {
  const { mode, setMode } = useThemeMode();
  return <PopoverTrigger>
    <SidebarMenuButton size="lg" aria-label="Account and theme">
      <Avatar size="sm"><AvatarFallback>LW</AvatarFallback></Avatar>
      <span className="grid flex-1 text-left text-sm leading-tight">
        <span className="truncate font-medium">Local workspace</span>
        <span className="truncate text-xs text-muted-foreground">Producer on this machine</span>
      </span>
      <ChevronsUpDownIcon className="ml-auto" />
    </SidebarMenuButton>
    <Popover placement="top start" className="w-64">
      <PopoverHeader>
        <PopoverTitle>Local workspace</PopoverTitle>
        <PopoverDescription>Studio reads cells from the Producer running on this machine.</PopoverDescription>
      </PopoverHeader>
      <Separator />
      <div className="flex flex-col gap-2">
        <span className="text-xs font-medium text-muted-foreground">Theme</span>
        <div className="grid grid-cols-3 gap-1" role="group" aria-label="Theme">
          {THEME_OPTIONS.map(({ mode: option, label, Icon }) => <Button key={option} size="sm" variant={mode === option ? 'secondary' : 'ghost'} aria-pressed={mode === option} onPress={() => setMode(option)}>
            <Icon data-icon="inline-start" />{label}
          </Button>)}
        </div>
      </div>
    </Popover>
  </PopoverTrigger>;
}

function ChatPanel() {
  return <Card className="flex h-full min-h-0 flex-col gap-0 rounded-none border-0 py-0 shadow-none ring-0">
    <CardHeader className="border-b py-4">
      <CardTitle className="flex items-center gap-2"><SparklesIcon className="size-4 text-primary" />Chat</CardTitle>
      <CardDescription>Ask an agent about the open page.</CardDescription>
    </CardHeader>
    <CardContent className="min-h-0 flex-1 px-0">
      <ScrollArea className="h-full px-4 py-4">
        <div className="flex flex-col gap-3">
          <div className="max-w-[85%] rounded-lg bg-muted px-3 py-2 text-sm">Conversations with Director, Designer, Writer and Publisher will appear here.</div>
          <p className="text-xs text-muted-foreground">Chat is not connected in this build. Agents work through the CLI for now.</p>
        </div>
      </ScrollArea>
    </CardContent>
    <CardFooter className="border-t p-3">
      <div className="flex w-full items-end gap-2">
        <Textarea aria-label="Message" placeholder="Message an agent" rows={2} className="min-h-0 resize-none" disabled />
        <Button size="icon" aria-label="Send message" isDisabled><ArrowUpIcon /></Button>
      </div>
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
  useEffect(() => { setOpenMobile(false); }, [pathname, setOpenMobile]);
  return null;
}

interface AppFrameProps {
  navigation: ContentMapNavigation;
  commands: readonly ContentMapCommandGroup[];
  breadcrumbs: readonly { id: string; label: string; href?: string }[];
  actions: readonly StudioPageAction[];
  children: ReactNode;
}

/** The Studio app shell, built from the stock shadcn sidebar block parts. */
function AppFrame({ navigation, commands, breadcrumbs, actions, children }: AppFrameProps) {
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

  return <SidebarProvider>
    <CloseMobileNavigation />
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" href={studioHome.href} tooltip="Studio">
              <span aria-hidden className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground"><svg viewBox="0 0 32 32" className="size-5" fill="none"><path d="M23 10H13a6 6 0 0 0 0 12h10M23 16H13" stroke="currentColor" strokeWidth="2.5" /></svg></span>
              <span className="grid flex-1 text-left leading-tight">
                <span className="truncate text-sm font-semibold">Studio</span>
                <span className="truncate text-xs text-muted-foreground">Clossys Producer</span>
              </span>
            </SidebarMenuButton>
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
        <SidebarMenu><SidebarMenuItem><AccountMenu /></SidebarMenuItem></SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
    <SidebarInset className="min-w-0">
      <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-2 border-b bg-background/95 px-3 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <SidebarTrigger aria-label="Toggle navigation" />
        <Separator orientation="vertical" className="mx-1 h-4 self-center!" />
        <Breadcrumb className="min-w-0 flex-1">
          <BreadcrumbList className="flex-nowrap overflow-hidden">
            {breadcrumbs.map((crumb, index) => <BreadcrumbItem key={crumb.id} id={crumb.id} className={index < breadcrumbs.length - 1 ? 'hidden truncate md:inline-flex' : 'truncate'}>
              {crumb.href && index < breadcrumbs.length - 1 ? <BreadcrumbLink href={crumb.href}>{crumb.label}</BreadcrumbLink> : <BreadcrumbPage className="truncate">{crumb.label}</BreadcrumbPage>}
            </BreadcrumbItem>)}
          </BreadcrumbList>
        </Breadcrumb>
        <div className="flex shrink-0 items-center gap-0.5" role="toolbar" aria-label="Page actions">
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
        </div>
      </header>
      <div className="flex min-h-0 flex-1">
        <main id="studio-main" className="min-w-0 flex-1 overflow-x-hidden">
          <PageModulesContext.Provider value={modules}>{children}</PageModulesContext.Provider>
        </main>
        {wide && chatOpen && <aside aria-label="Chat" className="sticky top-14 h-[calc(100svh-3.5rem)] w-80 shrink-0 border-l bg-background"><ChatPanel /></aside>}
      </div>
    </SidebarInset>
    <CommandMenu commands={commands} open={searchOpen} onOpenChange={setSearchOpen} />
    {!wide && <Sheet isOpen={chatSheet} onOpenChange={setChatSheet} side="right" className="w-[22rem] max-w-[90vw] p-0">
      <SheetHeader className="sr-only"><SheetTitle>Chat</SheetTitle><SheetDescription>Ask an agent about the open page.</SheetDescription></SheetHeader>
      <ChatPanel />
    </Sheet>}
  </SidebarProvider>;
}

/** Studio pages render through one shell; the projection owns navigation, commands and breadcrumbs. */
export function StudioFrame({ trail, children }: { trail?: string; children: ReactNode }) {
  const pathname = usePathname();
  const route = studioRouteForPath(pathname);
  const activeId = route?.instanceId ?? studioHome.id;
  const breadcrumbs = useMemo(() => {
    const base = studioBreadcrumbs[activeId] ?? studioBreadcrumbs[studioHome.id] ?? [];
    return trail ? [...base, { id: 'studio-trail', label: trail }] : base;
  }, [activeId, trail]);
  return <AppFrame
    navigation={studioNavigation[activeId] ?? studioNavigation[studioHome.id]!}
    commands={studioCommands}
    breadcrumbs={breadcrumbs}
    actions={studioPageActions[activeId] ?? []}
  >{children}</AppFrame>;
}
