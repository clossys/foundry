/** Record-kind transport for the shared /__specimen mount; the host renders its existing specimen component. */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { recordSpecimenInput, type RecordSpecimenInput } from './slot-gallery.js';

import { recordSpecimenViewport } from './record-specimen-viewport.js';
export { RECORD_SPECIMEN_THEME_HEADER, RECORD_SPECIMEN_WIDTH_HEADER, recordSpecimenViewport } from './record-specimen-viewport.js';

export interface RecordSpecimenRenderer {
  (input: RecordSpecimenInput, viewport: { width: 375 | 768 | 1280; theme: 'light' | 'dark' }): string | Promise<string>;
}

/** Mount before the Designer library specimen handler. Non-record requests fall through. */
export function recordSpecimens(options: { consumer: string; render: RecordSpecimenRenderer }) {
  return {
    async handle(request: IncomingMessage, response: ServerResponse, pathname: string): Promise<boolean> {
      if (pathname !== '/__specimen') return false;
      const params = new URL(request.url ?? '', 'http://studio.invalid').searchParams;
      const agent = params.get('agent');
      if (agent !== 'director' && agent !== 'writer') return false;
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        response.writeHead(405, { Allow: 'GET, HEAD' }); response.end(); return true;
      }
      const input = recordSpecimenInput(options.consumer, agent, params.get('slot') ?? '', params.get('candidate') ?? undefined);
      if (!input) { response.writeHead(404); response.end(); return true; }
      const html = await options.render(input, recordSpecimenViewport(params));
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      response.end(request.method === 'HEAD' ? undefined : html);
      return true;
    },
  };
}
