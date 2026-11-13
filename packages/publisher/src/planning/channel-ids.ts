export const PUBLISHER_CHANNELS = [
  { id: "site", label: "Site" }, { id: "app", label: "App" },
  { id: "admin", label: "Admin" }, { id: "content", label: "Content" },
  { id: "messages", label: "Messages" }, { id: "documents", label: "Documents" },
] as const;
export type PublisherChannelId = typeof PUBLISHER_CHANNELS[number]["id"];
