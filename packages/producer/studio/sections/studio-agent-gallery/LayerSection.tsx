import { Badge, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Tabs, TabsContent, TabsList, TabsTrigger } from '@clossys/designer-ui';
import { GroupSection } from './GroupSection';
import type { GalleryLayerData } from './types';

/**
 * One L0 tab's body: the L1 groups as a vertical tab list with slot counts beside the selected
 * group's cards; below `lg` the list collapses to a select above the content. Only the selected
 * group's panel renders. The list uses the default variant: nested in the L0 tabs, the line
 * variant's indicator also matches the outer horizontal group and collapses to a dot.
 */
export function LayerSection({ layer, group, onGroup }: { layer: GalleryLayerData; group: string; onGroup: (group: string) => void }) {
  return <Tabs orientation="vertical" selectedKey={group} onSelectionChange={key => onGroup(String(key))} className="flex-col gap-4 lg:flex-row lg:gap-6">
    <Select aria-label={layer.label} selectedKey={group} onSelectionChange={key => key !== null && onGroup(String(key))} className="w-full lg:hidden">
      <SelectTrigger><SelectValue /></SelectTrigger>
      <SelectContent>
        {layer.groups.map(row => <SelectItem key={row.id} id={row.id} textValue={row.label}>{row.label}<Badge variant="secondary" className="ml-auto">{row.count}</Badge></SelectItem>)}
      </SelectContent>
    </Select>
    <TabsList aria-label={layer.label} className="hidden w-56 shrink-0 items-stretch self-start lg:flex">
      {layer.groups.map(row => <TabsTrigger key={row.id} id={row.id}>{row.label}<Badge variant="secondary" className="ml-auto">{row.count}</Badge></TabsTrigger>)}
    </TabsList>
    {layer.groups.map(row => <TabsContent key={row.id} id={row.id} className="flex min-w-0 flex-1 flex-col gap-8">
      {row.sections.map(section => <GroupSection key={section.id} section={section} />)}
    </TabsContent>)}
  </Tabs>;
}
