import { materialsPrintStylesheet } from "./printStylesheet.js";
import type { MaterialsIndexEntry } from "./types.js";

const ESCAPE_RE = /[&<>"']/g;
const ESCAPE_MAP: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
function escapeHtml(value: string): string {
  return value.replace(ESCAPE_RE, (character) => ESCAPE_MAP[character] ?? character);
}
function escapeAttribute(value: string): string {
  return escapeHtml(value);
}

/**
 * Renders the materials site index (#1206): "An index page lists every
 * overview and deck version with its status, version, and last-published
 * time from the pack manifest (#1204)." Entries are never re-sorted by
 * this function — a caller controls display order (typically: overviews
 * before decks, newest version first).
 */
export function renderMaterialsIndexHtml(entries: readonly MaterialsIndexEntry[]): string {
  const rows = entries
    .map((entry) => {
      const lastPublished = entry.lastPublishedAt ? new Date(entry.lastPublishedAt).toISOString() : "never published";
      return `<tr>
  <td><a href="${escapeAttribute(entry.href)}">${escapeHtml(entry.title)}</a></td>
  <td>${escapeHtml(entry.kind)}</td>
  <td data-status="${escapeAttribute(entry.status)}">${escapeHtml(entry.status)}</td>
  <td data-condition="${escapeAttribute(entry.condition)}">${escapeHtml(entry.condition)}</td>
  <td>${escapeHtml(entry.version)}</td>
  <td>${escapeHtml(lastPublished)}</td>
</tr>`;
    })
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Materials</title>
<style>
  body { font: 16px/1.5 system-ui, sans-serif; margin: 2rem; color: #111; }
  table { border-collapse: collapse; width: 100%; }
  th, td { text-align: left; padding: 0.5rem 0.75rem; border-bottom: 1px solid #ddd; }
  th { font-weight: 600; }
  ${materialsPrintStylesheet()}
</style>
</head>
<body>
<h1>Materials</h1>
<p class="materials-no-print">Internal working artifacts. Not deployed, not public. Print-to-PDF from the browser to send one.</p>
<table>
<thead><tr><th>Item</th><th>Kind</th><th>Status</th><th>Condition</th><th>Version</th><th>Last published</th></tr></thead>
<tbody>
${rows}
</tbody>
</table>
</body>
</html>
`;
}
