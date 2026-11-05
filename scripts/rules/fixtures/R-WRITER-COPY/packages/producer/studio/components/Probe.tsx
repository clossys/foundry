// R-WRITER-COPY violation fixture: each line breaks one check-copy-source rule.
import { studioCopy } from '../lib/studio-copy';

export function Probe() {
  try { return <p>{studioCopy('studio.probe.held')}</p>; }
  catch (error) { return <p>{(error as Error).message}</p>; }
}
export const missing = studioCopy('studio.probe.missing');
export function Document() { return <html lang="en"><body><p>Hand written</p></body></html>; }
