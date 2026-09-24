/**
 * The shared print stylesheet for the materials site (#1206: "no built-in
 * PDF pipeline — a print stylesheet makes browser print-to-PDF clean").
 * One `<style>` block, reused by both the deck shell (one slide per page)
 * and the company-overview pages (clean paginated prose) so the two
 * surfaces do not each invent their own print rules.
 *
 * `@page` sets a landscape page for `.materials-deck` content and a
 * portrait page otherwise; a caller sets `data-materials-kind="deck"` on
 * `<body>` for a deck page.
 */
export function materialsPrintStylesheet(): string {
  return `
@media print {
  @page { margin: 0.5in; }
  body[data-materials-kind="deck"] { margin: 0; }
  body[data-materials-kind="deck"] @page { size: landscape; margin: 0; }
  .materials-no-print { display: none !important; }
  .materials-slide { break-after: page; page-break-after: always; }
  .materials-slide:last-child { break-after: auto; page-break-after: auto; }
  .materials-overview-section { break-inside: avoid; page-break-inside: avoid; }
  a[href]::after { content: ""; }
}
`.trim();
}
