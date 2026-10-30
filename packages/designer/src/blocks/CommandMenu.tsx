import { useShellCopy } from "../components/Banner.copy-context.js";
import { SHELL_COPY_REFS } from "../components/Banner.copy.js";
import { useEffect, type ReactElement } from "react";
import type { ModalOverlayProps, DialogProps, HeadingProps } from "react-aria-components";
import { X } from "../icons/X.js";
import type { CommandMenuProps, CommandMenuShortcutOptions } from "./command-menu-types.js";
import { componentLeaf } from "../runtime/component-leaf.js";

const SemanticContent = componentLeaf<typeof import("../components/SemanticContent.js").SemanticContent>("components.semantic-content");
const Button = componentLeaf<typeof import("../components/Button.js").Button>("components.button");
const Dialog = componentLeaf<(props: Omit<ModalOverlayProps, "children" | "className"> & { children: DialogProps["children"]; className?: string; showCloseButton?: boolean }) => ReactElement>("components.dialog");
const DialogTitle = componentLeaf<(props: Omit<HeadingProps, "slot">) => ReactElement>("components.dialog", "DialogTitle");
const Tooltip = componentLeaf<typeof import("../components/Tooltip.js").Tooltip>("components.tooltip");
const Icon = componentLeaf<typeof import("../components/Icon.js").Icon>("components.icon");
const Command = componentLeaf<typeof import("../components/command/index.js").Command>("components.command");
const CommandInput = componentLeaf<typeof import("../components/command/index.js").CommandInput>("components.command", "CommandInput");
const CommandList = componentLeaf<typeof import("../components/command/index.js").CommandList>("components.command", "CommandList");
const CommandGroup = componentLeaf<typeof import("../components/command/index.js").CommandGroup>("components.command", "CommandGroup");
const CommandItem = componentLeaf<typeof import("../components/command/index.js").CommandItem>("components.command", "CommandItem");
const CommandEmpty = componentLeaf<typeof import("../components/command/index.js").CommandEmpty>("components.command", "CommandEmpty");
const CommandShortcut = componentLeaf<typeof import("../components/command/index.js").CommandShortcut>("components.command", "CommandShortcut");

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

/** Selected command collection owns virtual focus, active descendants and keyboard activation. */
export function CommandMenu({
  heading, searchLabel, closeLabel, emptyMessage, groups, isOpen, onOpenChange,
  query, onQueryChange, filter, dir, resultCountMessage: suppliedResultCountMessage,
}: CommandMenuProps) {
  const copy = useShellCopy();
  const resultCountMessage = suppliedResultCountMessage ?? ((count: number) => copy(SHELL_COPY_REFS.commands.results, { count }));
  const visibleGroups = groups.map(group => ({ ...group, items: group.items.filter(item =>
    filter ? filter(item, query) : item.label.toLowerCase().includes(query.toLowerCase()),
  ) })).filter(group => group.items.length > 0);
  const count = visibleGroups.reduce((total, group) => total + group.items.length, 0);
  if (!isOpen) return null;
  return <Dialog isOpen={isOpen} onOpenChange={onOpenChange} showCloseButton={false}>
    <SemanticContent as="div" onKeyDownCapture={event => {
      if (!event.nativeEvent.isComposing && event.key === "Escape") {
        event.preventDefault(); event.stopPropagation(); onOpenChange(false);
      }
    }}>
      <Command dir={dir} inputValue={query} onInputChange={onQueryChange} filter={() => true}>
        <SemanticContent as="div" className="flex items-start justify-between gap-md">
          <DialogTitle>{heading}</DialogTitle>
          <Tooltip trigger={<Button aria-label={closeLabel} variant="ghost" size="sm" className="icon-control-sm rounded-control p-0" onPress={() => onOpenChange(false)}><Icon glyph={X} decorative size="sm" /></Button>}>{closeLabel}</Tooltip>
        </SemanticContent>
        <CommandInput aria-label={searchLabel} placeholder={searchLabel} />
        <CommandList aria-label={searchLabel} selectionMode="none" shouldFocusWrap>
          {visibleGroups.map(group => <CommandGroup key={group.id} id={group.id} heading={group.label}>
            {group.items.map(item => <CommandItem key={item.id} id={item.id} textValue={item.label} href={item.href} isDisabled={item.disabled}
              onAction={() => { item.onAction?.(); onOpenChange(false); }}>
              {item.icon ? <Icon glyph={item.icon} decorative size="sm" /> : null}
              <SemanticContent as="span" className="min-w-0 flex-1 break-words">
                <SemanticContent as="span" className="block">{item.label}</SemanticContent>
                {item.description && item.description.trim().toLocaleLowerCase() !== group.label.trim().toLocaleLowerCase() ? <SemanticContent as="span" className="block text-body-s text-ink-secondary">{item.description}</SemanticContent> : null}
              </SemanticContent>
              {item.shortcutHint ? <CommandShortcut>{item.shortcutHint}</CommandShortcut> : null}
            </CommandItem>)}
          </CommandGroup>)}
        </CommandList>
        {count === 0 ? <CommandEmpty>{emptyMessage}</CommandEmpty> : null}
        <SemanticContent as="span" role="status" aria-live="polite" aria-atomic="true" className="sr-only">{resultCountMessage(count)}</SemanticContent>
      </Command>
    </SemanticContent>
  </Dialog>;
}
