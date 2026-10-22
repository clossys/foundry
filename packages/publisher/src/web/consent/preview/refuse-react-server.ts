/**
 * What the `react-server` condition resolves for the web/consent/preview
 * subpath. The fixed-clock preview is client-only, so importing it in a
 * server component graph throws.
 */
throw new Error(
  'The web/consent/preview subpath of the publisher package is client-only and refuses the "react-server" condition.',
);

export {};
