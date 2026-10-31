'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { ChevronDownIcon, ChevronRightIcon, XIcon } from 'lucide-react';
import { Button, Card, CardAction, CardContent, CardHeader, CardTitle, Tooltip, TooltipTrigger } from '@clossys/designer-ui';
import { studioIcon } from '../../lib/studio-icons';

/** What a module section is told: the target in view (scroll-spy) and how to bring one into view. */
export interface ModuleContext { active?: string; select: (target: string) => void }

/** One page module, as the page manifest declares it; `render` places the pinned module section. */
export interface ModuleSpec {
  id: string;
  label: string;
  icon: string;
  shortcut?: string;
  /** Open when the URL names no open state (`?m` absent). */
  defaultOpen?: boolean;
  /** Selectors inside #studio-main the module points at, in page order; the scroll-spy follows them. */
  targets: readonly string[];
  render: (context: ModuleContext) => ReactNode;
}

/** A header action handler, as data: copy the page link, copy a prompt, or bring a page part into view. */
export type ModuleHandler = { kind: 'copy-link' } | { kind: 'copy-prompt'; prompt: string } | { kind: 'scroll'; target: string };

export interface ActionSpec { id: string; label: string; icon: string; shortcut?: string; cmdk: boolean; handler: ModuleHandler }

/** One page command for the command menu: a module toggle or a header action, with its shortcut. */
export interface PageCommand { id: string; label: string; icon: string; shortcut?: string; run: () => void }

/** What the frame hands the app shell: header icon buttons, the module column and the page commands. */
export interface ModuleChrome { toolbar: ReactNode; column: ReactNode; commands: readonly PageCommand[]; open: readonly string[] }

export interface ModuleFrameProps { modules: readonly ModuleSpec[]; actions: readonly ActionSpec[]; children: (chrome: ModuleChrome) => ReactNode }

const PARAM = 'm';
const SPY_OFFSET = 96;

/** Open modules from the URL (`?m=a,b`; `?m=` is none open), always in icon order. */
function readOpen(modules: readonly ModuleSpec[]): string[] {
  const ids = modules.map(module => module.id);
  const params = new URLSearchParams(window.location.search);
  if (!params.has(PARAM)) return modules.filter(module => module.defaultOpen).map(module => module.id);
  const listed = new Set((params.get(PARAM) ?? '').split(',').filter(Boolean));
  return ids.filter(id => listed.has(id));
}

function writeOpen(open: readonly string[]) {
  const url = new URL(window.location.href);
  if (open.length) url.searchParams.set(PARAM, open.join(','));
  else url.searchParams.delete(PARAM);
  window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
}

const mainColumn = () => document.getElementById('studio-main');
const target = (selector: string) => {
  try { return mainColumn()?.querySelector<HTMLElement>(selector) ?? null; } catch { return null; }
};

async function copy(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}

const typing = (element: EventTarget | null) => element instanceof HTMLElement && (element.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(element.tagName));

/** One open module: a title bar that collapses its body on click, a close button and a scroll body. */
function ModulePanel({ spec, context, onClose }: { spec: ModuleSpec; context: ModuleContext; onClose: () => void }) {
  const [collapsed, setCollapsed] = useState(false);
  const Icon = studioIcon(spec.icon, spec.id);
  return <Card size="sm" data-module={spec.id} data-collapsed={collapsed} className="shrink-0 gap-0 py-0">
    <CardHeader className="flex items-center gap-1 border-b px-1 py-1 group-data-[collapsed=true]/card:border-b-0">
      <CardTitle className="min-w-0 flex-1">
        <Button variant="ghost" size="sm" aria-expanded={!collapsed} data-module-title={spec.id} className="w-full justify-start gap-2 px-2" onPress={() => setCollapsed(value => !value)}>
          {collapsed ? <ChevronRightIcon /> : <ChevronDownIcon />}<Icon />{spec.label}
        </Button>
      </CardTitle>
      <CardAction className="self-center">
        <Button variant="ghost" size="icon-xs" aria-label={`Close ${spec.label}`} data-module-close={spec.id} onPress={onClose}><XIcon /></Button>
      </CardAction>
    </CardHeader>
    {!collapsed && <CardContent className="max-h-[60svh] overflow-y-auto px-3 py-3">{spec.render(context)}</CardContent>}
  </Card>;
}

/**
 * `frames.module`: the page module column and its chrome. Each module the page manifest declares
 * gets one header toggle (an icon button with a pressed state); open modules stack in a column
 * beside the page column in icon order, each with a collapsible title bar and its own scroll body.
 * Open state lives in the URL (`?m=`), Esc closes the top module, and every toggle and header
 * action is a page command with its shortcut.
 */
export default function ModuleFrame({ modules, actions, children }: ModuleFrameProps) {
  const pathname = usePathname();
  const ids = useMemo(() => modules.map(module => module.id), [modules]);
  const [open, setOpen] = useState<string[]>([]);
  const [active, setActive] = useState<string | undefined>(undefined);
  const [done, setDone] = useState<string | undefined>(undefined);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => { setOpen(readOpen(modules)); }, [ids.join(','), pathname]); // eslint-disable-line react-hooks/exhaustive-deps
  const update = useCallback((next: (current: string[]) => string[]) => setOpen(current => {
    const value = ids.filter(id => next(current).includes(id));
    writeOpen(value);
    return value;
  }), [ids]);
  const toggle = useCallback((id: string) => update(current => current.includes(id) ? current.filter(row => row !== id) : [...current, id]), [update]);
  const close = useCallback((id: string) => update(current => current.filter(row => row !== id)), [update]);

  const targets = useMemo(() => [...new Set(modules.filter(module => open.includes(module.id)).flatMap(module => module.targets))], [modules, open]);
  const chosen = useRef<string | undefined>(undefined);
  const spy = useCallback(() => {
    const main = mainColumn();
    if (!main) return;
    // A part chosen in a module stays highlighted while it is in view, until the reader scrolls
    // themselves (a short part, or one at the end of the column, may never reach the top).
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
    const release = () => { chosen.current = undefined; };
    main.addEventListener('scroll', onScroll, { passive: true });
    for (const name of ['wheel', 'touchstart', 'pointerdown', 'keydown'] as const) main.addEventListener(name, release, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      cancelAnimationFrame(frame);
      main.removeEventListener('scroll', onScroll);
      for (const name of ['wheel', 'touchstart', 'pointerdown', 'keydown'] as const) main.removeEventListener(name, release);
      window.removeEventListener('resize', onScroll);
    };
  }, [targets, spy]);
  const select = useCallback((selector: string) => {
    const element = target(selector);
    if (!element) return;
    chosen.current = selector;
    element.scrollIntoView({ block: 'start' });
    setActive(selector);
  }, []);

  const flash = (id: string) => { setDone(id); clearTimeout(timer.current); timer.current = setTimeout(() => setDone(undefined), 1600); };
  const run = useCallback((action: ActionSpec) => {
    const { handler } = action;
    if (handler.kind === 'scroll') { const element = target(handler.target); if (element) { element.scrollIntoView({ block: 'start' }); flash(action.id); } return; }
    const link = window.location.href;
    const text = handler.kind === 'copy-link' ? link : handler.prompt.replaceAll('{url}', link);
    void copy(text).then(ok => { if (ok) flash(action.id); });
  }, []);

  const commands = useMemo((): PageCommand[] => [
    ...modules.map(module => ({ id: `module:${module.id}`, label: `Toggle ${module.label}`, icon: module.icon, ...(module.shortcut ? { shortcut: module.shortcut } : {}), run: () => toggle(module.id) })),
    ...actions.filter(action => action.cmdk).map(action => ({ id: `action:${action.id}`, label: action.label, icon: action.icon, ...(action.shortcut ? { shortcut: action.shortcut } : {}), run: () => run(action) })),
  ], [modules, actions, toggle, run]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || document.querySelector('[role="dialog"]')) return;
      if (event.key === 'Escape') {
        if (!open.length || typing(event.target) && (event.target as HTMLInputElement).value) return;
        event.preventDefault();
        close(open[0]!);
        return;
      }
      if (typing(event.target)) return;
      const command = commands.find(row => row.shortcut && row.shortcut.toLowerCase() === event.key.toLowerCase());
      if (command) { event.preventDefault(); command.run(); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, close, commands]);

  const toolbar = <>
    {modules.map(module => {
      const Icon = studioIcon(module.icon, module.id);
      const pressed = open.includes(module.id);
      return <TooltipTrigger key={module.id}>
        <Button variant={pressed ? 'secondary' : 'ghost'} size="icon-sm" aria-label={module.label} aria-pressed={pressed} data-module-toggle={module.id} aria-keyshortcuts={module.shortcut} onPress={() => toggle(module.id)}><Icon /></Button>
        <Tooltip>{module.label}{module.shortcut ? ` (${module.shortcut.toUpperCase()})` : ''}</Tooltip>
      </TooltipTrigger>;
    })}
    {actions.map(action => {
      const Icon = studioIcon(action.icon, action.id);
      const available = action.handler.kind !== 'scroll' || Boolean(active !== undefined || target(action.handler.target));
      return <TooltipTrigger key={action.id}>
        <Button variant="ghost" size="icon-sm" aria-label={action.label} data-page-action={action.id} data-done={done === action.id} aria-keyshortcuts={action.shortcut} isDisabled={!available} onPress={() => run(action)}><Icon /></Button>
        <Tooltip>{done === action.id ? (action.handler.kind === 'scroll' ? action.label : 'Copied') : `${action.label}${action.shortcut ? ` (${action.shortcut.toUpperCase()})` : ''}`}</Tooltip>
      </TooltipTrigger>;
    })}
  </>;
  const context: ModuleContext = { ...(active ? { active } : {}), select };
  const column = open.length ? <aside aria-label="Page modules" data-module-column={open.join(',')} className="row-start-2 flex max-h-[45svh] min-h-0 w-full flex-col gap-3 overflow-y-auto border-b bg-background p-3 md:col-start-2 md:max-h-none md:w-80 md:border-b-0 md:border-l">
    {modules.filter(module => open.includes(module.id)).map(module => <ModulePanel key={module.id} spec={module} context={context} onClose={() => close(module.id)} />)}
  </aside> : null;
  return <>{children({ toolbar, column, commands, open })}</>;
}
