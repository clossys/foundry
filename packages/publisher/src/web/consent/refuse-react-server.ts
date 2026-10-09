/**
 * What the `react-server` condition resolves for the web/consent subpath.
 * The consent assembly is client-only, so importing it in a server component
 * graph throws.
 */
throw new Error(
  'The web/consent subpath of the publisher package is client-only and refuses the "react-server" condition. Import it from a client component.',
);

export {};
