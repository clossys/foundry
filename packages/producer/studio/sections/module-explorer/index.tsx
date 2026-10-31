import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@clossys/designer-ui';

/** One explorer row: a group or a leaf of the page's IA, and the page part it brings into view. */
export interface ExplorerItem { id: string; label: string; depth: number; target: string }
/** One top group: the page's IA level 1. */
export interface ExplorerGroup { id: string; label: string; items: readonly ExplorerItem[] }

/** The `explorer` input of `sections.module.explorer`. `active` is the target in view; `onSelect` brings one into view. */
export interface ExplorerInput {
  label: string;
  searchLabel: string;
  empty: string;
  groups: readonly ExplorerGroup[];
  active?: string;
  onSelect: (target: string) => void;
}

const INDENT = ['pl-2', 'pl-5', 'pl-8', 'pl-11'] as const;

/**
 * `sections.module.explorer`: the page's map as a searchable tree (shadcn command). IA level 1 is the
 * top grouping; each row brings its page part into view, and the row in view is highlighted.
 */
export default function ExplorerSection({ explorer }: { explorer: ExplorerInput }) {
  const selected = explorer.groups.flatMap(group => group.items).find(item => item.target === explorer.active);
  return <Command data-studio-section="module-explorer" className="rounded-none! bg-transparent p-0">
    <CommandInput placeholder={explorer.searchLabel} />
    <CommandList
      aria-label={explorer.label}
      className="max-h-none"
      selectionMode="single"
      selectedKeys={selected ? [selected.id] : []}
      renderEmptyState={() => <CommandEmpty>{explorer.empty}</CommandEmpty>}
    >
      {explorer.groups.map(group => <CommandGroup key={group.id} id={group.id} heading={group.label}>
        {group.items.map(item => <CommandItem
          key={item.id}
          id={item.id}
          textValue={item.label}
          data-explorer-target={item.target}
          className={`${INDENT[Math.min(item.depth, INDENT.length - 1)]} [&>svg:last-child]:hidden`}
          shouldCloseOnSelect={false}
          onAction={() => explorer.onSelect(item.target)}
        >{item.label}</CommandItem>)}
      </CommandGroup>)}
    </CommandList>
  </Command>;
}
