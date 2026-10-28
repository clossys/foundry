import { useShellCopy } from "../components/Banner.copy-context.js";
import { SHELL_COPY_REFS } from "../components/Banner.copy.js";
import { useCallback, useContext, useEffect } from "react";
import { Autocomplete, AutocompleteStateContext, FieldInputContext } from "react-aria-components";
import { Dialog } from "../components/Dialog.js";
import { SearchField } from "../components/SearchField.js";
import { Tooltip } from "../components/Tooltip.js";
import { IconButton } from "../components/IconButton.js";
import { Icon } from "../components/Icon.js";
import { ListBox, ListBoxSection, ListBoxItem, ListBoxHeader } from "../components/ListBox.js";
import { Kbd } from "../components/Kbd.js";
import { SemanticContent } from "../components/SemanticContent.js";
import { controlStateStyle } from "../components/button-classes.js";
import { X } from "../icons/X.js";
import type { CommandMenuProps, CommandMenuShortcutOptions } from "./command-menu-types.js";

/** Keep the existing combobox semantics while forwarding Autocomplete's input ref and attributes. */
function CommandSearch({ searchLabel, query, onQueryChange }: { searchLabel: string; query: string; onQueryChange: (value: string) => void }) {
  const context = useContext(FieldInputContext);
  const state = useContext(AutocompleteStateContext);
  const inputRef = context && "ref" in context ? context.ref : undefined;
  const resultsId = context && "aria-controls" in context ? context["aria-controls"] : undefined;
  const configureInput = useCallback((element: Element | null) => {
    if (typeof inputRef === "function") inputRef(element as HTMLInputElement | null);
    else if (inputRef) inputRef.current = element as HTMLInputElement | null;
    if (element instanceof HTMLInputElement) {
      element.setAttribute("role", "combobox");
      element.setAttribute("aria-expanded", "true");
    }
  }, [inputRef]);
  useEffect(() => {
    const active = state?.focusedNodeId ? document.getElementById(state.focusedNodeId) : null;
    // The peer may delay its live active-descendant announcement while typing;
    // reveal the first available suggestion immediately without changing focus.
    const first = resultsId ? document.getElementById(resultsId)?.querySelector<HTMLElement>('[role="option"]:not([aria-disabled="true"])') : null;
    (active ?? first)?.scrollIntoView?.({ block: "nearest", inline: "nearest", behavior: "instant" });
  }, [state?.focusedNodeId, query, resultsId]);
  return <FieldInputContext.Provider value={{ ...context, ref: configureInput }}>
    <SearchField label={searchLabel} value={query} onChange={onQueryChange} autoFocus />
  </FieldInputContext.Provider>;
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

/** Navigation Material composed from the shared Command collection primitives and Dialog lifecycle. */
export function CommandMenu({
  heading, searchLabel, closeLabel, emptyMessage, groups, isOpen, onOpenChange,
  query, onQueryChange, filter, dir,
  resultCountMessage: suppliedResultCountMessage,
}: CommandMenuProps) {
  const copy = useShellCopy();
  const resultCountMessage = suppliedResultCountMessage ?? ((count: number) => copy(SHELL_COPY_REFS.commands.results, { count }));
  const visibleGroups = groups.map(group => ({ ...group, items: group.items.filter(item =>
    filter ? filter(item, query) : item.label.toLowerCase().includes(query.toLowerCase()),
  ) })).filter(group => group.items.length > 0);
  const visible = visibleGroups.flatMap(group => group.items);
  if (!isOpen) return null;
  return <Dialog trigger={null} isOpen={isOpen} onOpenChange={onOpenChange}>
    <SemanticContent as="div" dir={dir} className="flex min-h-0 min-w-0 flex-col gap-md" onKeyDownCapture={event => {
      if (event.key === "Escape" && !event.nativeEvent.isComposing) {
        event.preventDefault(); event.stopPropagation(); onOpenChange(false);
      }
    }}>
      <SemanticContent as="div" className="flex items-start justify-between gap-md">
        <Dialog.Heading>{heading}</Dialog.Heading>
        <Tooltip trigger={<IconButton label={closeLabel} icon={X} size="sm" shape="square" onPress={() => onOpenChange(false)} />}>{closeLabel}</Tooltip>
      </SemanticContent>
      <Autocomplete inputValue={query} onInputChange={onQueryChange}>
        <CommandSearch searchLabel={searchLabel} query={query} onQueryChange={onQueryChange} />
        <ListBox aria-label={searchLabel} selectionMode="single" shouldFocusWrap autoFocus="first"
          className="min-h-0 overflow-auto" disabledKeys={visible.filter(item => item.disabled).map(item => item.id)}>
          {visibleGroups.map(group => <ListBoxSection key={group.id} id={JSON.stringify(["group", group.id])} className="flex flex-col gap-xs">
            <ListBoxHeader className="m-0 px-sm py-xs text-caption text-ink-muted">{group.label}</ListBoxHeader>
            {group.items.map(item => <ListBoxItem key={item.id} id={item.id} textValue={item.label} aria-label={item.label}
              href={item.disabled ? undefined : item.href} selectionFollowsFocus
              onAction={() => { item.onAction?.(); queueMicrotask(() => onOpenChange(false)); }}
              className={({ isFocused }) => `flex min-w-0 items-center gap-sm rounded-control border-s-2 px-sm py-sm text-body text-ink-primary no-underline ${isFocused ? "border-s-accent bg-accent-tint forced-colors:border-current" : "border-s-transparent"}`}
              style={state => controlStateStyle(state)}>
              {item.icon ? <Icon glyph={item.icon} decorative size="sm" /> : null}
              <SemanticContent as="span" className="min-w-0 flex-1 break-words">
                <SemanticContent as="span" className="block">{item.label}</SemanticContent>
                {item.description && item.description.trim().toLocaleLowerCase() !== group.label.trim().toLocaleLowerCase() ? <SemanticContent as="span" className="block text-body-s text-ink-secondary">{item.description}</SemanticContent> : null}
              </SemanticContent>
              {item.shortcutHint ? <Kbd className="shrink-0 text-caption text-ink-muted">{item.shortcutHint}</Kbd> : null}
            </ListBoxItem>)}
          </ListBoxSection>)}
        </ListBox>
      </Autocomplete>
      {visible.length === 0 ? <SemanticContent as="div" className="text-body text-ink-secondary">{emptyMessage}</SemanticContent> : null}
      <SemanticContent as="span" role="status" aria-live="polite" aria-atomic="true" className="sr-only">{resultCountMessage(visible.length)}</SemanticContent>
    </SemanticContent>
  </Dialog>;
}
