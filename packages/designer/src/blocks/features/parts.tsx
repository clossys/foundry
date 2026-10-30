import { SectionRevealStyle } from "../../styles/section-reveal.js";

/** Scroll positioning is local; reveal keyframes come from the shared section style. */
export function FeatureMotionStyles() {
  return <><SectionRevealStyle /><style>{`
@keyframes features-sticky {
  from { transform: translateY(var(--spacing-sm)); }
  to { transform: none; }
}
@media (prefers-reduced-motion: reduce) {
  [data-feature-sticky], [data-feature-motion] { animation: none !important; transform: none !important; opacity: 1 !important; }
  [data-feature-sticky] { position: static !important; }
}
`}</style></>;
}
