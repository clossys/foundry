'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { MoonIcon, PanelRightIcon, SunIcon } from 'lucide-react';
import type { ContentMapCommandGroup, ContentMapNavigation } from '@clossys/publisher/content-map';
import {
  Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, Button,
  CommandDialog, Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandShortcut,
  PopoverDescription, PopoverHeader, PopoverTitle, ScrollArea, Separator,
  ResizablePanel, ResizablePanelGroup, ResizableHandle, SidebarInset, SidebarProvider, SidebarTrigger,
  useSidebar,
} from '@clossys/designer-ui';
import { studioIcon } from '../../lib/studio-icons';
import { AppSidebar } from './app-sidebar';
import { useThemeMode } from '../../components/StudioProviders';
import { HeaderIconButton, HeaderPopover, HeaderTooltip } from './stock-header-controls';
import { StockChatSheet, StockChatSidebar } from './stock-chat-sidebar';

export { PageNotice, type PageNoticeData } from './PageNotice';

/** What a navigator popover's section is told: the target in view (scroll-spy) and how to bring one into view. */
export interface PopoverContext { active?: string; select: (target: string) => void }

/**
 * One header popover, as the page manifest declares it. A module popover places its pinned module
 * section (`render`) and names the page parts it points at (`targets`, followed by the scroll-spy);
 * an action popover shows the text it copies (`copy`: a prompt naming the page).
 */
export interface PopoverSpec {
  id: string;
  label: string;
  icon: string;
  shortcut?: string;
  description?: string;
  targets?: readonly string[];
  render?: (context: PopoverContext) => ReactNode;
  copy?: { kind: 'prompt'; prompt: string };
}

/** One page command for the command menu: opening one header popover, with its shortcut. */
export interface PageCommand { id: string; label: string; icon: string; shortcut?: string; run: () => void }

const POPOVER_PARAM = 'p';
const LEFT_COOKIE = 'sidebar_state';
const CHAT_COOKIE = 'chat_state';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 7;
const SPY_OFFSET = 96;

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

const readCookie = (name: string): boolean | undefined => {
  const row = document.cookie.split('; ').find(part => part.startsWith(`${name}=`));
  return row ? row.slice(name.length + 1) === 'true' : undefined;
};
const writeCookie = (name: string, value: boolean) => { document.cookie = `${name}=${value}; path=/; max-age=${COOKIE_MAX_AGE}`; };

/** The open popover from the URL (`?p=<id>`), when the page declares it. */
function readPopover(ids: readonly string[]): string | undefined {
  const id = new URLSearchParams(window.location.search).get(POPOVER_PARAM) ?? undefined;
  return id && ids.includes(id) ? id : undefined;
}
function writePopover(id: string | undefined) {
  const url = new URL(window.location.href);
  if (id) url.searchParams.set(POPOVER_PARAM, id);
  else url.searchParams.delete(POPOVER_PARAM);
  window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
}

const mainColumn = () => document.getElementById('studio-main');
const target = (selector: string) => {
  try { return mainColumn()?.querySelector<HTMLElement>(selector) ?? null; } catch { return null; }
};
async function copyText(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}
const typing = (element: EventTarget | null) => element instanceof HTMLElement && (element.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(element.tagName));
const sentence = (value: string) => value ? value.charAt(0).toUpperCase() + value.slice(1) : value;

/** An action popover's body: the text it copies, then the copy button. */
function CopyBody({ spec, prompt }: { spec: PopoverSpec; prompt: string }) {
  const [copied, setCopied] = useState(false);
  // The page link, without the popover state (it renders only once opened, in the browser).
  const [href] = useState(() => { const url = new URL(window.location.href); url.searchParams.delete(POPOVER_PARAM); return url.href; });
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const text = prompt.replaceAll('{url}', href);
  return <>
    <PopoverDescription data-popover-text={spec.id} className="max-h-48 overflow-y-auto rounded-md bg-muted px-2 py-1.5 font-mono text-xs break-all whitespace-pre-wrap">{text}</PopoverDescription>
    <Button size="sm" data-popover-copy={spec.id} onPress={() => { void copyText(text).then(ok => { if (!ok) return; setCopied(true); clearTimeout(timer.current); timer.current = setTimeout(() => setCopied(false), 1600); }); }}>
      {copied ? 'Copied' : 'Copy prompt'}
    </Button>
  </>;
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
    // The content column is the scroller, so a new page starts at its top.
    document.getElementById('studio-main')?.scrollTo({ top: 0 });
  }, [pathname, setOpenMobile]);
  return null;
}

/** The scroll-spy over the open popover's targets: the part at the top of the page column is active. */
function useScrollSpy(targets: readonly string[]) {
  const [active, setActive] = useState<string | undefined>(undefined);
  const chosen = useRef<string | undefined>(undefined);
  const spy = useCallback(() => {
    const main = mainColumn();
    if (!main) return;
    // A part chosen in a popover stays highlighted while it is in view (a short part, or one at
    // the end of the column, may never reach the top).
    const bounds = main.getBoundingClientRect();
    const kept = chosen.current ? target(chosen.current)?.getBoundingClientRect() : undefined;
    if (kept && kept.top < bounds.bottom && kept.bottom > bounds.top) { setActive(chosen.current); return; }
    chosen.current = undefined;
    const top = bounds.top + SPY_OFFSET;
    let current: string | undefined;
    for (const selector of targets) { const element = target(selector); if (element && element.getBoundingClientRect().top <= top) current = selector; }
    setActive(current ?? targets.find(selector => target(selector)));
  }, [targets]);
  useEffect(() => {
    const main = mainColumn();
    if (!main || !targets.length) return;
    let frame = 0;
    const onScroll = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(spy); };
    onScroll();
    main.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => { cancelAnimationFrame(frame); main.removeEventListener('scroll', onScroll); window.removeEventListener('resize', onScroll); };
  }, [targets, spy]);
  const select = useCallback((selector: string) => {
    const element = target(selector);
    const main = mainColumn();
    if (!element || !main) return;
    chosen.current = selector;
    // Scroll the page column only: scrolling an ancestor of the header would close the popover.
    main.scrollTo({ top: main.scrollTop + element.getBoundingClientRect().top - main.getBoundingClientRect().top });
    setActive(selector);
  }, []);
  return { active, select };
}

/**
 * The inputs of `frames.studio-shell`. Navigation, commands and breadcrumbs are projected by
 * Publisher from the one Studio map; `popovers` are the page manifest's modules and actions, one
 * header icon each. `body` is the assembly's layout: both stack the sections in the padded page
 * column with no outer card (`detail` keeps the first section as the head).
 */
export interface StudioShellProps {
  homeHref: string;
  navigation: ContentMapNavigation;
  commands: readonly ContentMapCommandGroup[];
  breadcrumbs: readonly { id: string; label: string; href?: string }[];
  popovers?: readonly PopoverSpec[];
  body?: 'plain' | 'detail';
  head?: ReactNode;
  children?: ReactNode;
}

/**
 * `frames.studio-shell`: the shadcn sidebar-15 block (a left and a right sidebar) as Studio's app
 * shell. The left sidebar is the N1 navigation (sidebar-07 content); the right sidebar is chat.
 * The header's far-left icon toggles the left sidebar, its far-right icon (after a divider) the
 * chat; every other header icon opens its module or action as a popover anchored to it. Open
 * states persist: the sidebars in cookies, the popover in the URL (`?p=`). Below `md` the left
 * sidebar is a sheet, below `lg` the chat is.
 */
export default function StudioShellFrame({ navigation, commands, breadcrumbs, popovers = [], body = 'plain', head, children }: StudioShellProps) {
  const pathname = usePathname();
  const { resolved, setMode } = useThemeMode();
  const [searchOpen, setSearchOpen] = useState(false);
  const wide = useMediaQuery('(min-width: 1024px)');
  const [leftOpen, setLeftOpen] = useState(true);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatSheet, setChatSheet] = useState(false);
  const ids = useMemo(() => popovers.map(spec => spec.id), [popovers]);
  const [open, setOpen] = useState<string | undefined>(undefined);
  useEffect(() => {
    setLeftOpen(readCookie(LEFT_COOKIE) ?? true);
    setChatOpen(readCookie(CHAT_COOKIE) ?? false);
  }, []);
  useEffect(() => { setOpen(readPopover(ids)); }, [ids.join(','), pathname]); // eslint-disable-line react-hooks/exhaustive-deps
  const show = useCallback((id: string | undefined) => {
    writePopover(id);
    setOpen(id);
  }, []);
  const toggleChat = () => {
    if (!wide) { setChatSheet(value => !value); return; }
    setChatOpen(value => { writeCookie(CHAT_COOKIE, !value); return !value; });
  };

  const openRef = useRef(open);
  openRef.current = open;
  const current = popovers.find(spec => spec.id === open);
  const spy = useScrollSpy(useMemo(() => current?.targets ?? [], [current]));
  const pageCommands = useMemo((): PageCommand[] => popovers.map(spec => ({
    id: `popover:${spec.id}`, label: spec.label, icon: spec.icon, ...(spec.shortcut ? { shortcut: spec.shortcut } : {}),
    // The menu returns focus to the page as it closes; the popover opens after that.
    run: () => { setTimeout(() => show(spec.id), 0); },
  })), [popovers, show]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === 'k' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); setSearchOpen(value => !value); return; }
      // A header popover is itself a dialog; only another dialog (the command menu, a sheet) takes the keys.
      const otherDialog = document.querySelector('[role="dialog"]:not([data-popover])');
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || typing(event.target) || otherDialog) return;
      const spec = popovers.find(row => row.shortcut && row.shortcut === event.key.toLowerCase());
      if (spec) { event.preventDefault(); show(spec.id); }
    };
    // Esc closes the open popover wherever focus is, in the capture phase: a popover's own fields
    // stop the key. A search with text keeps the first Esc, which clears it.
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !openRef.current || document.querySelector('[role="dialog"]:not([data-popover])')) return;
      if (event.target instanceof HTMLInputElement && event.target.value) return;
      show(undefined);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keydown', onEscape, true);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('keydown', onEscape, true); };
  }, [popovers, show]);

  const context: PopoverContext = { ...(spy.active ? { active: spy.active } : {}), select: spy.select };
  return <SidebarProvider open={leftOpen} onOpenChange={setLeftOpen} className="h-svh overflow-hidden">
    <CloseMobileNavigation />
    <AppSidebar navigation={navigation} />
    <ResizablePanelGroup orientation="horizontal" className="min-h-0 min-w-0 flex-1">
    <ResizablePanel id="studio-page">
    <SidebarInset className="h-full min-h-0 min-w-0 overflow-hidden">
      <header className="sticky top-0 flex h-14 shrink-0 items-center gap-2 bg-background">
        <div className="flex flex-1 items-center gap-2 px-3">
          <HeaderTooltip label="Toggle Sidebar"><SidebarTrigger data-panel-toggle="left" /></HeaderTooltip>
          <Separator
            orientation="vertical"
            className="mr-2 aria-[orientation=vertical]:h-4 aria-[orientation=vertical]:self-auto"
          />
          <Breadcrumb>
            <BreadcrumbList>
              {breadcrumbs.map((crumb, index) => index < breadcrumbs.length - 1
                ? <BreadcrumbItem key={crumb.id} id={crumb.id} className="hidden md:inline-flex">
                  {crumb.href ? <BreadcrumbLink href={crumb.href}>{crumb.label}</BreadcrumbLink> : <BreadcrumbPage>{crumb.label}</BreadcrumbPage>}
                </BreadcrumbItem>
                : <BreadcrumbItem key={crumb.id} id={crumb.id}>
                  <BreadcrumbPage className="line-clamp-1">{crumb.label}</BreadcrumbPage>
                </BreadcrumbItem>)}
            </BreadcrumbList>
          </Breadcrumb>
        </div>
        <div className="flex items-center gap-2 px-3">
        {popovers.map(spec => {
          const Icon = studioIcon(spec.icon, spec.id);
          return <HeaderPopover key={spec.id} label={spec.label} open={open === spec.id} onOpenChange={value => show(value ? spec.id : undefined)}
            data-popover-trigger={spec.id} aria-keyshortcuts={spec.shortcut} content={<>
              <PopoverHeader>
                <PopoverTitle>{spec.label}</PopoverTitle>
                {spec.description && <PopoverDescription>{spec.description}</PopoverDescription>}
              </PopoverHeader>
              {spec.copy?.kind === 'prompt' ? <CopyBody spec={spec} prompt={spec.copy.prompt} /> : <ScrollArea data-popover-body={spec.id} className="max-h-[60svh]">{spec.render?.(context)}</ScrollArea>}
            </>}><Icon /></HeaderPopover>;
        })}
        <HeaderIconButton label="Toggle theme" aria-pressed={resolved === 'dark'} data-theme-toggle
          onClick={() => setMode(resolved === 'dark' ? 'light' : 'dark')}>
          {resolved === 'dark' ? <SunIcon /> : <MoonIcon />}
        </HeaderIconButton>
        <Separator
          orientation="vertical"
          className="aria-[orientation=vertical]:h-4 aria-[orientation=vertical]:self-auto"
        />
        <HeaderIconButton label="Toggle chat" aria-pressed={wide ? chatOpen : chatSheet} data-panel-toggle="chat" onClick={toggleChat}><PanelRightIcon /></HeaderIconButton>
        </div>
      </header>
      <main id="studio-main" data-body={body} className="@container/main flex min-h-0 min-w-0 flex-1 flex-col gap-6 overflow-x-hidden overflow-y-auto overscroll-contain p-4 md:p-6 *:shrink-0">
        {head}{children}
      </main>
    </SidebarInset>
    </ResizablePanel>
    {wide && chatOpen && <>
      <ResizableHandle aria-label="Resize chat" />
      <ResizablePanel id="studio-chat" defaultSize="16rem" minSize="16rem" maxSize="50%" groupResizeBehavior="preserve-pixel-size">
        <StockChatSidebar />
      </ResizablePanel>
    </>}
    </ResizablePanelGroup>
    <CommandMenu commands={commands} pageCommands={pageCommands} open={searchOpen} onOpenChange={setSearchOpen} />
    {!wide && <StockChatSheet isOpen={chatSheet} onOpenChange={setChatSheet} />}
  </SidebarProvider>;
}

