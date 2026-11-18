import { loadContentTree } from "../taxonomy.js";
import type { ContentTree } from "../taxonomy.js";

/**
 * Test-only consumer content tree. Publisher ships no content tree: the consumer supplies its own on the workspace
 * (`workspace.tree`). This fixture stands in for a consumer's tree so the content-slot fixtures keep their placements.
 */
export const contentTreeFixture = (): ContentTree => loadContentTree({
  schemaVersion: 1,
  nodes: [
    { id: "websites", label: "Websites", children: [
      { id: "site", label: "Site", frame: "site-shell" },
      { id: "admin", label: "Admin", frame: "app-shell" },
      { id: "auth", label: "Auth", frame: "auth-shell" },
      { id: "app", label: "App", frame: "app-shell" },
      { id: "demo", label: "Demo", frame: "site-shell" },
    ] },
    { id: "documents", label: "Documents", children: [{ id: "docs", label: "Docs", frame: "site-shell" }] },
    { id: "presentations", label: "Presentations", children: [{ id: "decks", label: "Decks", frame: "deck" }] },
    { id: "videos", label: "Videos", children: [{ id: "clips", label: "Clips", frame: "video" }] },
    { id: "messages", label: "Messages", children: [{ id: "email", label: "Email", frame: "message" }] },
    { id: "social", label: "Social", children: [{ id: "posts", label: "Posts", frame: "social" }] },
  ],
});
