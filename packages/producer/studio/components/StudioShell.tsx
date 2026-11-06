'use client';
/**
 * The plumbing of `frames.studio-shell`. The pinned frame is a pure stock composition (it holds no
 * state and imports nothing but Designer parts); this renderer gives it every input already
 * resolved: the Studio map's navigation and commands as data with their glyphs, the header
 * popovers with their open state, the theme and chat controls, and the mobile sheet's panel. Open
 * states persist: the sidebars in cookies, the popover in the URL (`?p=`). The scroll-spy follows
 * the open popover's targets in the page column, and the keys open the search (Cmd/Ctrl+K), a
 * popover (its shortcut) or close it (Esc).
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { ChevronRightIcon, MessageSquareIcon, MoonIcon, PanelRightIcon, SparklesIcon, SunIcon } from 'lucide-react';
import type { ContentMapBreadcrumb, ContentMapCommandGroup, ContentMapNavigation, ContentMapNavigationNode } from '@clossys/publisher/content-map';
import { useSidebar } from '@clossys/designer-ui';
import type { NavMainItem, ShellCommand, ShellNavigation, ShellPopover, StudioShellCopy, StudioShellProps as FrameProps } from '../frames/studio-shell';
import { studioIcon } from '../lib/studio-icons';
import { useStudioData, useThemeMode } from './StudioProviders';

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

/** The page's inputs to the shell: Publisher's projections of the Studio map (`homeHref` is part of the projection; the shell links home through the map), the shell copy, the manifest popovers and the body. */
export interface StudioShellInputs {
  homeHref: string;
  navigation: ContentMapNavigation;
  commands: readonly ContentMapCommandGroup[];
  breadcrumbs: readonly ContentMapBreadcrumb[];
  copy: StudioShellCopy;
  popovers?: readonly PopoverSpec[];
  body?: 'plain' | 'detail';
  head?: ReactNode;
  children?: ReactNode;
}

const POPOVER_PARAM = 'p';
const LEFT_COOKIE = 'sidebar_state';
const CHAT_COOKIE = 'chat_state';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 7;
const SPY_OFFSET = 96;
const COPIED_MS = 1600;

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
/** The page link, without the popover state. */
function pageHref(): string {
  const url = new URL(window.location.href);
  url.searchParams.delete(POPOVER_PARAM);
  return url.href;
}

const mainColumn = () => document.getElementById('studio-main');
/** The page scrolls in the window (sidebar-15); the header row sits above the page column. */
const headerBottom = () => mainColumn()?.parentElement?.previousElementSibling?.getBoundingClientRect().bottom ?? 0;
/** A manifest target the column does not hold is null; a selector the browser cannot parse throws, so a bad manifest row is reported, not silently skipped. */
const target = (selector: string) => mainColumn()?.querySelector<HTMLElement>(selector) ?? null;
async function copyText(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}
const typing = (element: EventTarget | null) => element instanceof HTMLElement && (element.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(element.tagName));

/** The consumer's mark served for one ground (`dark` = a light mark for a dark ground). */
function BrandMark({ ground }: { ground: 'light' | 'dark' }) {
  return <img data-brand-mark={ground} src={`/api/brand/mark.svg?ground=${ground}`} alt="" width={16} height={16} />;
}

/**
 * The Studio map's navigation as the sidebar shows it: the map's root pages (Home: a projected
 * href) in one unlabeled group; each root group (a system: no href) one labeled group, its pages as
 * menu buttons and its child groups (the agents: projected children) as collapsible items.
 */
function shellNavigation(navigation: ContentMapNavigation, copy: StudioShellCopy['sidebar'], brandName: string | undefined, dark: boolean): ShellNavigation {
  const item = (node: ContentMapNavigationNode): NavMainItem => {
    const Icon = studioIcon(node.icon);
    return { id: node.id, title: node.label, ...(node.href ? { url: node.href } : {}), icon: <Icon />, isActive: navigation.activeId === node.id };
  };
  const group = (node: ContentMapNavigationNode): NavMainItem[] => {
    const items = (node.children ?? []).flatMap(child => (child.href ? [{ id: child.id, title: child.label, url: child.href, isActive: navigation.activeId === child.id }] : []));
    return items.length ? [{ ...item(node), items }] : [];
  };
  return {
    pages: navigation.tree.flatMap(node => (node.href ? [item(node)] : [])),
    systems: navigation.tree.flatMap(node => node.href ? [] : [{
      id: node.id, label: node.label,
      items: (node.children ?? []).flatMap(child => (child.children?.length ? group(child) : child.href ? [item(child)] : [])),
    }]),
    // The mark is drawn for the page theme's ground (the sidebar behind the Item image media).
    team: { name: copy.team, plan: brandName ? copy.plan : copy.localPlan, logo: <BrandMark ground={dark ? 'dark' : 'light'} /> },
    user: { name: copy.user.name, email: copy.user.email, initials: copy.user.initials },
    chevron: <ChevronRightIcon />,
  };
}

/** The scroll-spy over the open popover's targets: the part at the top of the page column is active. */
function useScrollSpy(targets: readonly string[]) {
  const [active, setActive] = useState<string | undefined>(undefined);
  const chosen = useRef<string | undefined>(undefined);
  const spy = useCallback(() => {
    if (!mainColumn()) return;
    // A part chosen in a popover stays highlighted while it is in view (a short part, or one at
    // the end of the column, may never reach the top).
    const bounds = { top: headerBottom(), bottom: window.innerHeight };
    const kept = chosen.current ? target(chosen.current)?.getBoundingClientRect() : undefined;
    if (kept && kept.top < bounds.bottom && kept.bottom > bounds.top) { setActive(chosen.current); return; }
    chosen.current = undefined;
    const top = bounds.top + SPY_OFFSET;
    let current: string | undefined;
    for (const selector of targets) { const element = target(selector); if (element && element.getBoundingClientRect().top <= top) current = selector; }
    setActive(current ?? targets.find(selector => target(selector)));
  }, [targets]);
  useEffect(() => {
    if (!mainColumn() || !targets.length) return;
    let frame = 0;
    const onScroll = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(spy); };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => { cancelAnimationFrame(frame); window.removeEventListener('scroll', onScroll); window.removeEventListener('resize', onScroll); };
  }, [targets, spy]);
  const select = useCallback((selector: string) => {
    const element = target(selector);
    if (!element) return;
    chosen.current = selector;
    // Scrolling the window keeps the anchored header popover open.
    window.scrollTo({ top: window.scrollY + element.getBoundingClientRect().top - headerBottom() });
    setActive(selector);
  }, []);
  return { active, select };
}

/** The stock sidebar's mobile state, read inside the frame's provider. */
interface SidebarState { isMobile: boolean; openMobile: boolean; setOpenMobile: (open: boolean | ((open: boolean) => boolean)) => void }

/**
 * Rendered by the frame inside its SidebarProvider (draws nothing): reports the stock sidebar's
 * mobile state up, closes the mobile sheet on a new page or a crossed boundary, and starts a new
 * page at its top (the window is the scroller).
 */
function SidebarBridge({ onState }: { onState: (state: SidebarState) => void }) {
  const pathname = usePathname();
  const { isMobile, openMobile, setOpenMobile } = useSidebar();
  useEffect(() => { onState({ isMobile, openMobile, setOpenMobile: setOpenMobile as SidebarState['setOpenMobile'] }); }, [isMobile, openMobile, setOpenMobile, onState]);
  useEffect(() => { setOpenMobile(false); window.scrollTo({ top: 0 }); }, [pathname, setOpenMobile]);
  useEffect(() => { setOpenMobile(false); }, [isMobile, setOpenMobile]);
  return null;
}

/** Renders the bound `frames.studio-shell` with every input resolved and every state held here. */
export function StudioShell({ frame: Frame, navigation, commands, breadcrumbs, copy, popovers = [], body = 'plain', head, children }: StudioShellInputs & { frame: ComponentType<FrameProps> }) {
  const pathname = usePathname();
  const router = useRouter();
  const { brand } = useStudioData();
  const { resolved, setMode } = useThemeMode();
  const dark = resolved === 'dark';

  const [leftOpen, setLeftOpen] = useState(true);
  const [chatOpen, setChatOpen] = useState(false);
  useEffect(() => { setLeftOpen(readCookie(LEFT_COOKIE) ?? true); setChatOpen(readCookie(CHAT_COOKIE) ?? false); }, []);

  const [sidebar, setSidebar] = useState<SidebarState>({ isMobile: false, openMobile: false, setOpenMobile: () => {} });
  const [mobilePanel, setMobilePanel] = useState<'left' | 'chat'>('left');
  useEffect(() => { if (!sidebar.openMobile) setMobilePanel('left'); }, [sidebar.openMobile]);

  const ids = useMemo(() => popovers.map(spec => spec.id), [popovers]);
  const [open, setOpen] = useState<string | undefined>(undefined);
  const [href, setHref] = useState('');
  useEffect(() => { setOpen(readPopover(ids)); setHref(pageHref()); }, [ids.join(','), pathname]); // eslint-disable-line react-hooks/exhaustive-deps
  const show = useCallback((id: string | undefined) => {
    writePopover(id);
    setHref(pageHref());
    setOpen(id);
  }, []);

  const [copied, setCopied] = useState<string | undefined>(undefined);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const [searchOpen, setSearchOpen] = useState(false);
  const openRef = useRef(open);
  openRef.current = open;
  const current = popovers.find(spec => spec.id === open);
  const spy = useScrollSpy(useMemo(() => current?.targets ?? [], [current]));

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

  const toggleChat = () => {
    if (sidebar.isMobile) {
      setMobilePanel('chat');
      sidebar.setOpenMobile(mobilePanel !== 'chat' || !sidebar.openMobile);
      return;
    }
    setChatOpen(value => { writeCookie(CHAT_COOKIE, !value); return !value; });
  };
  const onLeftToggle = () => {
    setMobilePanel('left');
    if (sidebar.isMobile && mobilePanel === 'chat') sidebar.setOpenMobile(false);
  };

  const brandName = brand.state === 'ready' ? brand.value.name : undefined;
  const shellNav = useMemo(() => shellNavigation(navigation, copy.sidebar, brandName, dark), [navigation, copy.sidebar, brandName, dark]);
  const context: PopoverContext = { ...(spy.active ? { active: spy.active } : {}), select: spy.select };
  const shellPopovers: ShellPopover[] = popovers.map(spec => {
    const Icon = studioIcon(spec.icon);
    const base = {
      id: spec.id, label: spec.label, icon: <Icon />, open: open === spec.id,
      onOpenChange: (value: boolean) => show(value ? spec.id : undefined),
      ...(spec.shortcut ? { shortcut: spec.shortcut } : {}), ...(spec.description ? { description: spec.description } : {}),
    };
    if (spec.copy?.kind === 'prompt') {
      const text = spec.copy.prompt.replaceAll('{url}', href);
      return { ...base, copy: { text, copied: copied === spec.id, onCopy: () => { void copyText(text).then(ok => {
        if (!ok) return;
        setCopied(spec.id);
        clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopied(undefined), COPIED_MS);
      }); } } };
    }
    return { ...base, body: spec.render?.(context) };
  });
  const pageCommands: ShellCommand[] = popovers.map(spec => {
    const Icon = studioIcon(spec.icon);
    return {
      id: `popover:${spec.id}`, label: spec.label, icon: <Icon />, 'data-page-command': `popover:${spec.id}`,
      ...(spec.shortcut ? { shortcut: spec.shortcut } : {}),
      // The menu returns focus to the page as it closes; the popover opens after that.
      onAction: () => { setSearchOpen(false); setTimeout(() => show(spec.id), 0); },
    };
  });
  const mapGroups = commands.map(group => ({
    id: group.id, heading: group.label,
    items: group.items.flatMap((item): ShellCommand[] => {
      if (!item.href) return [];
      const Icon = studioIcon(item.icon);
      const destination = item.href;
      return [{ id: item.id, label: item.label, icon: <Icon />, onAction: () => { setSearchOpen(false); router.push(destination); } }];
    }),
  }));

  return <Frame
    navigation={shellNav}
    commands={{ open: searchOpen, onOpenChange: setSearchOpen, groups: [{ id: 'page', heading: copy.search.page, items: pageCommands }, ...mapGroups] }}
    breadcrumbs={breadcrumbs}
    copy={copy}
    popovers={shellPopovers}
    open={leftOpen}
    onOpenChange={setLeftOpen}
    theme={{ dark, icon: dark ? <SunIcon /> : <MoonIcon />, onToggle: () => setMode(dark ? 'light' : 'dark') }}
    chat={{
      open: chatOpen, pressed: sidebar.isMobile ? sidebar.openMobile && mobilePanel === 'chat' : chatOpen,
      icon: <PanelRightIcon />, titleIcon: <SparklesIcon />, emptyIcon: <MessageSquareIcon />, onToggle: toggleChat,
    }}
    mobilePanel={mobilePanel}
    onLeftToggle={onLeftToggle}
    bridge={<SidebarBridge onState={setSidebar} />}
    body={body}
    head={head}
  >{children}</Frame>;
}
