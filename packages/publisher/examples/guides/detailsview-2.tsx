"use client";
import { DetailsView, type DetailsViewTab } from "@clossys/publisher/web/client";

const tabs: DetailsViewTab[] = [{ id: "overview", label: "Overview", sections: [
  { id: "identity", title: "Identity", block: { kind: "detail", props: { fields: [{ label: "Identifier", value: "one" }] } } },
  { id: "activity", title: "Activity", block: { kind: "panel", props: { children: "Recent activity" } }, state: { kind: "loading", label: "Loading activity" } },
  { id: "attachments", title: "Attachments", region: "aside", block: { kind: "panel", props: { children: "Files" } }, state: { kind: "empty", props: { title: "No attachments" } } },
  { id: "history", title: "History", region: "aside", block: { kind: "panel", props: { children: "Changes" } }, state: { kind: "error", props: { children: "History could not load." } } },
] }, { id: "notes", label: "Notes", sections: [] }];

export function TabbedRecordArea({ tab, onTabChange }: { tab: string; onTabChange: (tab: string) => void }) {
  return <DetailsView
    layout="main-aside"
    tabs={tabs}
    tab={tab}
    onTabChange={onTabChange}
    tabsLabel="Record sections"
    empty={{ title: "No sections" }}
  />;
}

export const smokeProps = { tab: "overview", onTabChange: (_tab: string): void => {} } satisfies Parameters<typeof TabbedRecordArea>[0];
export default TabbedRecordArea;
