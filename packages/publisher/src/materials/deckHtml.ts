import type { RenderSlidesResult } from "../slides/index.js";
import { materialsPrintStylesheet } from "./printStylesheet.js";

export interface RenderPitchDeckHtmlOptions {
  /** Deck title, shown in `<title>` and as an offscreen heading for screen readers. */
  title: string;
  /** Optional audience label, shown in the deck chrome (e.g. "Investor"). */
  audience?: string;
}

const ESCAPE_RE = /[&<>"']/g;
const ESCAPE_MAP: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
function escapeHtml(value: string): string {
  return value.replace(ESCAPE_RE, (character) => ESCAPE_MAP[character] ?? character);
}

/**
 * Renders a rendered pitch deck (`renderSlidesDeck`'s own output — this
 * function never re-derives slide content) as one self-contained HTML page
 * with keyboard navigation (#1206: "HTML slides with keyboard navigation")
 * and the shared print stylesheet (one slide per printed page). No
 * external script or stylesheet: the whole page is one file, exactly like
 * `renderSlidesDeck`'s own SVG output is self-contained.
 *
 * Keys: ArrowRight/ArrowDown/Space/PageDown advance; ArrowLeft/ArrowUp/
 * PageUp go back; Home/End jump to the first/last slide. Deck order is
 * `result.slides`' own order — never re-sorted.
 */
export function renderPitchDeckHtml(result: RenderSlidesResult, options: RenderPitchDeckHtmlOptions): string {
  const title = escapeHtml(options.title);
  const audienceLabel = options.audience ? ` — ${escapeHtml(options.audience)}` : "";
  const slidesMarkup = result.slides
    .map(
      (slide, position) =>
        `<section class="materials-slide" id="slide-${escapeHtml(slide.id)}" data-index="${position}" ${position === 0 ? "" : 'hidden aria-hidden="true"'}>${slide.svg}</section>`,
    )
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}${audienceLabel}</title>
<style>
  :root { color-scheme: light; }
  html, body { margin: 0; padding: 0; height: 100%; background: #111; }
  .materials-deck { position: relative; width: 100vw; height: 100vh; display: flex; align-items: center; justify-content: center; overflow: hidden; }
  .materials-slide { max-width: 100%; max-height: 100%; }
  .materials-slide svg { width: 100%; height: 100%; display: block; }
  .materials-nav { position: fixed; bottom: 1rem; right: 1rem; font: 14px system-ui, sans-serif; color: #fff; background: rgba(0,0,0,0.6); padding: 0.25rem 0.75rem; border-radius: 999px; }
  ${materialsPrintStylesheet()}
  @media print {
    .materials-deck { position: static; width: auto; height: auto; display: block; }
    .materials-slide { display: block !important; visibility: visible !important; }
  }
</style>
</head>
<body data-materials-kind="deck">
<div class="materials-deck" role="region" aria-roledescription="carousel" aria-label="${title}${audienceLabel}">
${slidesMarkup}
</div>
<div class="materials-nav materials-no-print"><span id="materials-position">1</span> / ${result.slides.length}</div>
<script>
(function () {
  var slides = Array.prototype.slice.call(document.querySelectorAll(".materials-slide"));
  var position = document.getElementById("materials-position");
  var current = 0;
  function show(index) {
    if (index < 0 || index >= slides.length) return;
    slides[current].hidden = true;
    slides[current].setAttribute("aria-hidden", "true");
    current = index;
    slides[current].hidden = false;
    slides[current].removeAttribute("aria-hidden");
    if (position) position.textContent = String(current + 1);
  }
  document.addEventListener("keydown", function (event) {
    if (["ArrowRight", "ArrowDown", " ", "PageDown"].indexOf(event.key) !== -1) { show(current + 1); event.preventDefault(); }
    else if (["ArrowLeft", "ArrowUp", "PageUp"].indexOf(event.key) !== -1) { show(current - 1); event.preventDefault(); }
    else if (event.key === "Home") { show(0); event.preventDefault(); }
    else if (event.key === "End") { show(slides.length - 1); event.preventDefault(); }
  });
})();
</script>
</body>
</html>
`;
}
