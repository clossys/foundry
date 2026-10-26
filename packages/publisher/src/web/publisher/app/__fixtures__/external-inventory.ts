/** Node-only fixture host. Never import this module from browser entry points. */
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { projectAppInventory } from "../inventory.js";

export const APP_FIXTURE_SOURCE = {
  head: "6c0b58cfc425f84126a8653f89a2f65563930d31",
  tree: "fc8106dc47e212ac855e79d96d4e2186936c8868",
  sha256: "345bf0df951e5daec7d20665e5ff6858049642d060b9486dcdc1d76d3deabe2b",
} as const;
export async function loadExternalAppInventory(path = process.env.PUBLISHER_APP_INVENTORY, expected: { readonly head: string; readonly tree: string; readonly sha256: string } = APP_FIXTURE_SOURCE) {
  if (!path) throw new Error("PUBLISHER_APP_INVENTORY is required for the external App fixture");
  const bytes = await readFile(path);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (sha256 !== expected.sha256) throw new Error("External App inventory digest mismatch");
  const inventory = projectAppInventory(JSON.parse(bytes.toString("utf8")), [
    { id: "home", label: "Home", lane: "Dashboard" },
    { id: "settings", label: "Settings", lane: "Settings" },
    { id: "not-found", label: "Not found", lane: "Status" },
    { id: "error", label: "Error", lane: "Status" },
  ]);
  if (inventory.source.head !== expected.head || inventory.source.tree !== expected.tree) throw new Error("External App inventory source mismatch");
  return { inventory, sha256 };
}
