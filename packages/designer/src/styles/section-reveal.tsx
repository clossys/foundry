/** Shared, opt-in section reveal. Content is visible unless motion is permitted. */
export const SECTION_REVEAL_ATTRIBUTE = "data-designer-reveal";
export const SECTION_REVEAL_CSS = `
[data-designer-reveal] { opacity: 1; transform: none; animation: none; }
@keyframes reveal {
  from { opacity: 0; transform: translateY(var(--ui-motion-shift-reveal, 24px)); }
  to { opacity: 1; transform: none; }
}
@media (prefers-reduced-motion: no-preference) {
  [data-designer-reveal] { animation: var(--animate-reveal, reveal 600ms cubic-bezier(0, 0, 0.2, 1) both); }
}
@media (prefers-reduced-motion: reduce) {
  [data-designer-reveal] { animation: none; transform: none; opacity: 1; }
}`;
/** Mount beside an opted-in surface. Safe for server rendering; no hidden waiting state. */
export function SectionRevealStyle() {
  return <style>{SECTION_REVEAL_CSS}</style>;
}
