import { useShellCopy } from "../selected-components/Banner.copy-context.js";
import { SHELL_COPY_REFS } from "../selected-components/Banner.copy.js";
import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { FieldInputContext } from "react-aria-components";
import { Dialog } from "../selected-components/Dialog.js";
import { SearchField } from "../selected-components/SearchField.js";
import { Tooltip } from "../selected-components/Tooltip.js";
import { IconButton } from "../selected-components/IconButton.js";
import { Icon } from "../selected-components/Icon.js";
import { controlStateStyle } from "../selected-components/button-classes.js";
import { X } from "../icons/X.js";
import type { CommandMenuProps, CommandMenuShortcutOptions } from "./command-menu-types.js";


function CommandMenuGroupRegion({ label, children }: { label: string; children: ReactNode }) {
  const headingId = useId();
  return (
    <div role="group" aria-labelledby={headingId} className="flex flex-col gap-xs">
      <p id={headingId} className="m-0 px-sm py-xs text-caption text-ink-muted">{label}</p>
      {children}
    </div>
  );
}

/** Opt-in opening shortcut. Every open modal, including the command menu itself, keeps ownership of its keys. */
export function useCommandMenuShortcut({ onOpen, enabled = true }: CommandMenuShortcutOptions): void {
  useEffect(() => {
    if (!enabled) return;
    const apple = /Mac|iPhone|iPad|iPod/.test(navigator.platform);
    const keydown = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat || event.isComposing || event.altKey || event.shiftKey || typeof event.key !== "string" || event.key.toLowerCase() !== "k") return;
      if (apple ? !event.metaKey || event.ctrlKey : !event.ctrlKey || event.metaKey) return;
      const dialogs = document.querySelectorAll('[role="dialog"], [role="alertdialog"], [aria-modal="true"], dialog[open]');
      const openDialog = Array.from(dialogs).some(dialog => {
        if (dialog.matches("dialog:not([open])") || dialog.closest('[hidden], [aria-hidden="true"], [inert]')) return false;
        if (["hidden", "collapse"].includes(window.getComputedStyle(dialog).visibility)) return false;
        for (let ancestor: Element | null = dialog; ancestor; ancestor = ancestor.parentElement) {
          if (window.getComputedStyle(ancestor).display === "none") return false;
        }
        return true;
      });
      if (openDialog) return;
      event.preventDefault();
      onOpen();
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [enabled, onOpen]);
}

/** Navigation Material over host data. Dialog owns the overlay, focus containment and opener restoration. */
export function CommandMenu({
  heading, searchLabel, closeLabel, emptyMessage, groups, isOpen, onOpenChange,
  query, onQueryChange, filter, dir,
  /** Writer owns the omitted formatter's plural selection. */
  resultCountMessage: suppliedResultCountMessage,
}: CommandMenuProps) {
  const copy = useShellCopy();
  const resultCountMessage = suppliedResultCountMessage ?? ((count: number) => copy(SHELL_COPY_REFS.commands.results, { count }));
  const id = useId();
  const input = useRef<HTMLInputElement | null>(null);
  const options = useRef(new Map<string, HTMLAnchorElement>());
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [pressedId, setPressedId] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  useEffect(() => { setActiveId(null); setHoveredId(null); setPressedId(null); }, [isOpen, query]);
  const configureInput = useCallback((element: Element | null) => {
    input.current = element instanceof HTMLInputElement ? element : null;
    // SearchField exposes its exact input through this public context ref.
    // These static semantics exist only while the open menu's input exists.
    input.current?.setAttribute("role", "combobox");
    input.current?.setAttribute("aria-expanded", "true");
  }, []);
  const visibleGroups = groups.map(group => ({ ...group, items: group.items.filter(item =>
    filter ? filter(item, query) : item.label.toLowerCase().includes(query.toLowerCase()),
  ) })).filter(group => group.items.length > 0);
  const visible = visibleGroups.flatMap(group => group.items);
  const enabled = visible.filter(item => !item.disabled);
  const active = enabled.find(item => item.id === activeId) ?? enabled[0];
  const activeResultId = active?.id;
  useEffect(() => {
    if (isOpen && activeResultId !== undefined) {
      options.current.get(activeResultId)?.scrollIntoView?.({ block: "nearest", inline: "nearest", behavior: "instant" });
    }
  }, [activeResultId, isOpen, query, groups]);
  const optionId = (itemId: string) => `${id}-option-${encodeURIComponent(itemId)}`;
  const keydown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Escape") {
      // Capture before SearchField's clear-on-Escape behavior.
      event.preventDefault();
      event.stopPropagation();
      onOpenChange(false);
      return;
    }
    if (event.target !== input.current) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      event.stopPropagation();
      if (!enabled.length) return;
      const current = enabled.findIndex(item => item.id === active?.id);
      const next = (current + (event.key === "ArrowDown" ? 1 : -1) + enabled.length) % enabled.length;
      setActiveId(enabled[next]!.id);
    } else if (event.key === "Enter" && active) {
      event.preventDefault();
      event.stopPropagation();
      options.current.get(active.id)?.click();
    }
  };
  if (!isOpen) return null;
  return (
    <Dialog trigger={null} isOpen={isOpen} onOpenChange={onOpenChange}>
      <div dir={dir} className="flex min-h-0 min-w-0 flex-col gap-md" onKeyDownCapture={keydown}>
        <div className="flex items-start justify-between gap-md">
          <Dialog.Heading>{heading}</Dialog.Heading>
          <Tooltip trigger={<IconButton label={closeLabel} icon={X} size="sm" shape="square" onPress={() => onOpenChange(false)} />}>{closeLabel}</Tooltip>
        </div>
        <FieldInputContext.Provider value={{
          ref: configureInput, "aria-controls": `${id}-results`, "aria-autocomplete": "list",
          "aria-activedescendant": active ? optionId(active.id) : undefined,
        }}>
          <SearchField label={searchLabel} value={query} onChange={onQueryChange} autoFocus />
        </FieldInputContext.Provider>
        <div id={`${id}-results`} role="listbox" aria-label={searchLabel} className="min-h-0 overflow-auto">
          {visibleGroups.map(group => (
            <CommandMenuGroupRegion key={group.id} label={group.label}>
              {group.items.map(item => (
                <a key={item.id} id={optionId(item.id)} role="option" aria-label={item.label}
                  aria-selected={active?.id === item.id} aria-disabled={item.disabled || undefined}
                  href={item.disabled ? undefined : item.href} tabIndex={-1}
                  ref={element => { if (element) options.current.set(item.id, element); else options.current.delete(item.id); }}
                  onMouseDown={event => event.preventDefault()}
                  onPointerMove={() => { if (!item.disabled) { setActiveId(item.id); setHoveredId(item.id); } }}
                  onPointerEnter={() => { if (!item.disabled) setHoveredId(item.id); }}
                  onPointerLeave={() => { setHoveredId(null); setPressedId(null); }}
                  onPointerDown={() => { if (!item.disabled) setPressedId(item.id); }}
                  onPointerUp={() => setPressedId(null)}
                  onPointerCancel={() => setPressedId(null)}
                  onClick={event => {
                    if (item.disabled) { event.preventDefault(); return; }
                    item.onAction?.();
                    onOpenChange(false);
                  }}
                  className={`flex min-w-0 items-center gap-sm rounded-control border-s-2 px-sm py-sm text-body text-ink-primary no-underline ${active?.id === item.id ? "border-s-accent bg-accent-tint forced-colors:border-current" : "border-s-transparent"}`}
                  style={controlStateStyle({ isDisabled: item.disabled, isHovered: hoveredId === item.id, isPressed: pressedId === item.id })}
                >
                  {item.icon ? <Icon glyph={item.icon} decorative size="sm" /> : null}
                  <span className="min-w-0 flex-1 break-words">
                    <span className="block">{item.label}</span>
                    {item.description && item.description.trim().toLocaleLowerCase() !== group.label.trim().toLocaleLowerCase() ? <span className="block text-body-s text-ink-secondary">{item.description}</span> : null}
                  </span>
                  {item.shortcutHint ? <span className="shrink-0 text-caption text-ink-muted">{item.shortcutHint}</span> : null}
                </a>
              ))}
            </CommandMenuGroupRegion>
          ))}
        </div>
        {visible.length === 0 ? <div className="text-body text-ink-secondary">{emptyMessage}</div> : null}
        <span role="status" aria-live="polite" aria-atomic="true" className="sr-only">{resultCountMessage(visible.length)}</span>
      </div>
    </Dialog>
  );
}
