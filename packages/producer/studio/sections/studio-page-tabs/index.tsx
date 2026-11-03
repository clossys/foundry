'use client';
import { ScrollArea, Tabs, TabsList, TabsTrigger } from '@clossys/designer-ui';

/** One tab: a route the content map projects under the page record. */
export interface PageTab {
  id: string;
  label: string;
  href: string;
}

/** The `tabs` input of `sections.studio.page-tabs`: the tab routes, in content-map order, and the active one. */
export interface PageTabsInput {
  label: string;
  active: string;
  tabs: readonly PageTab[];
}

/** `sections.studio.page-tabs`: stock shadcn Tabs in a ScrollArea; each tab is a link to its route. */
export default function PageTabsSection({ tabs, ...provenance }: { tabs: PageTabsInput } & { [marker: `data-clossys-${string}`]: string }) {
  return <ScrollArea {...provenance} className="w-full">
    <Tabs selectedKey={tabs.active}>
      <TabsList aria-label={tabs.label}>
        {tabs.tabs.map(tab => <TabsTrigger key={tab.id} id={tab.id} href={tab.href}>{tab.label}</TabsTrigger>)}
      </TabsList>
    </Tabs>
  </ScrollArea>;
}
