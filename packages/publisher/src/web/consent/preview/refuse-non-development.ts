/**
 * What every condition other than `development` resolves for the
 * web/consent/preview subpath. The fixed-clock preview exists for
 * development only, so a production build reaches this module and throws.
 */
throw new Error(
  'The web/consent/preview subpath of the publisher package resolves only under the "development" condition; this build did not set it.',
);

export {};
