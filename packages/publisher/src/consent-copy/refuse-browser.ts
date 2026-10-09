/**
 * What the `browser` condition resolves for the consent copy subpath.
 * Copy resolution is server-only, so importing it in a browser build throws.
 */
throw new Error(
  'The consent-copy subpath of the publisher package is server-only and refuses the "browser" condition. Resolve consent copy on the server and pass the resolved strings to the client.',
);

export {};
