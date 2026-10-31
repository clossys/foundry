import { Command, CommandGroup, CommandItem, CommandList } from '@clossys/designer-ui';

/** One section of the open page and the selector that finds it in the page column. */
export interface OutlineItem { id: string; label: string; target: string }

/** The `outline` input of `sections.module.outline`. `active` is the section in view; `onSelect` brings one into view. */
export interface OutlineInput { label: string; heading: string; items: readonly OutlineItem[]; active?: string; onSelect: (target: string) => void }

/** `sections.module.outline`: the open page's own sections in page order; a click brings one into view. */
export default function OutlineSection({ outline }: { outline: OutlineInput }) {
  const selected = outline.items.find(item => item.target === outline.active);
  return <Command data-studio-section="module-outline" className="rounded-none! bg-transparent p-0">
    <CommandList aria-label={outline.label} className="max-h-none" selectionMode="single" selectedKeys={selected ? [selected.id] : []}>
      <CommandGroup id="outline" heading={outline.heading}>
        {outline.items.map(item => <CommandItem
          key={item.id}
          id={item.id}
          textValue={item.label}
          data-outline-target={item.target}
          className="[&>svg:last-child]:hidden"
          onAction={() => outline.onSelect(item.target)}
        >{item.label}</CommandItem>)}
      </CommandGroup>
    </CommandList>
  </Command>;
}
