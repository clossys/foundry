import type { Publication, PublicationCopy, PublicationsCopy } from '../sections/studio-publications';
import { studioCopy } from './studio-copy';

/** Resolve existing Publications labels without changing its route data. */
export function publicationsCopy(): PublicationsCopy {
  return {
    root: studioCopy('studio.publications-root'),
    path: studioCopy('studio.publications-path'),
    page: studioCopy('studio.publications-page'),
    frame: studioCopy('studio.publications-frame'),
    sections: studioCopy('studio.publications-sections'),
    status: studioCopy('studio.publications-status'),
    leaf: studioCopy('studio.publications-leaf'),
    none: studioCopy('studio.publications-none'),
  };
}

/** Counts use plain string interpolation, preserving the section's decimal wording. */
export function publicationCopy(publication: Publication): PublicationCopy {
  return {
    routeCount: publication.routes.length === 1 ? studioCopy('studio.publications-one-route')
      : studioCopy('studio.publications-many-routes', { count: String(publication.routes.length) }),
    routesLabel: studioCopy('studio.publications-routes-label', { title: publication.title }),
  };
}
