import { ScrollArea, Tabs, TabsContent, TabsList, TabsTrigger } from '@clossys/designer-ui';
import { GalleryHeader } from './GalleryHeader';
import { LayerSection } from './LayerSection';
import type { AgentGalleryInput } from './types';

export type { AgentGalleryInput, GalleryCardData, GalleryCardState, GalleryGroupData, GalleryHeaderData, GalleryLayerData, GallerySectionData, GallerySelection, GalleryTone } from './types';

/**
 * `sections.studio.agent-gallery`: the one layout every agent page shares. The header names the
 * agent, its purpose and its pinned count; L0 layers are line tabs (scrolling sideways on narrow
 * screens); each tab lists its L1 groups beside the selected group's L2 headings and slot cards.
 * The page holds the selection (in the URL); the section only lays it out.
 */
export default function AgentGallerySection({ gallery }: { gallery: AgentGalleryInput }) {
  const { layers, selection, onSelect } = gallery;
  const firstGroup = (layer: string) => layers.find(row => row.id === layer)?.groups[0]?.id ?? '';
  return <section data-studio-section="agent-gallery" aria-label={gallery.header.title}>
    <GalleryHeader header={gallery.header} />
    <Tabs selectedKey={selection.layer} onSelectionChange={key => onSelect?.({ layer: String(key), group: firstGroup(String(key)) })} className="gap-6 pt-2">
      <ScrollArea className="-mx-1 px-1 pb-2">
        <TabsList variant="line" aria-label={gallery.header.title}>
          {layers.map(layer => <TabsTrigger key={layer.id} id={layer.id}>{layer.label}</TabsTrigger>)}
        </TabsList>
      </ScrollArea>
      {layers.map(layer => <TabsContent key={layer.id} id={layer.id}>
        <LayerSection layer={layer} group={layer.id === selection.layer ? selection.group : firstGroup(layer.id)} onGroup={group => onSelect?.({ layer: layer.id, group })} />
      </TabsContent>)}
    </Tabs>
  </section>;
}
