import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { installedSpecimenRoutes } from './installed-specimens.js';
import { sandboxSpecimenFrames, specimenHostCsp } from './publication.js';

// A specimen that frames another specimen (components.studio.block-viewer-iframe frames
// /__specimen?element=components.card/card), loaded in a real browser through the real specimen
// routes and policies in both contexts that show it:
//   - a Studio card: the page frames /__specimen unsandboxed, the specimen keeps Studio's origin
//     and its nested /__specimen loads (specimenSiteCsp frame-src);
//   - a served preview: the page carries specimenHostCsp and sandboxSpecimenFrames gives the
//     specimen `allow-scripts` only, an opaque origin, so the nested /__specimen refuses it
//     (`frame-ancestors 'self'`). That refusal is the boundary: no allow-same-origin, no wildcard.
const VIEWER = '/__specimen?element=components.studio.block-viewer-iframe/block-viewer-iframe&width=1280';
const CARD_TEXT = 'card specimen';

describe('a specimen that frames a specimen', () => {
  it('loads its nested specimen in a Studio card and is refused by frame-ancestors in a served preview', async () => {
    const dist = mkdtempSync(join(tmpdir(), 'specimen-nested-'));
    mkdirSync(join(dist, 'assets'));
    writeFileSync(join(dist, 'index.html'), '<!doctype html><html><head><script src="/__specimen-site/0123abcd/assets/index.js" defer></script></head><body></body></html>');
    writeFileSync(join(dist, 'assets/index.js'), `const page = new URLSearchParams(location.search).get('page');
if (page === 'viewer') { const frame = document.createElement('iframe'); frame.title = 'nested'; frame.src = '/__specimen?element=components.card/card&width=1280'; document.body.append(frame); }
else document.body.textContent = ${JSON.stringify(CARD_TEXT)};`);
    const build = '0123abcd';
    const site = { key: build, builds: [{ key: build, dist }], findings: [], pages: new Map([
      ['components.studio.block-viewer-iframe/block-viewer-iframe@v4', { page: 'viewer', element: 'block-viewer-iframe', version: 4, build }],
      ['components.card/card@v1', { page: 'card', element: 'card', version: 1, build }],
    ]) };
    const routes = installedSpecimenRoutes(Promise.resolve(site));
    let origin = '';
    const server = createServer((req, res) => {
      const pathname = new URL(req.url!, 'http://x').pathname;
      if (pathname === '/studio-card.html') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(`<!doctype html><iframe src="${VIEWER}" width="1280" height="600"></iframe>`); return; }
      if (pathname === '/served-preview.html') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': specimenHostCsp(origin, 'studio') });
        res.end(sandboxSpecimenFrames(`<!doctype html><iframe src="${VIEWER}" width="1280" height="600"></iframe>`, 'studio'));
        return;
      }
      void routes.handle(req, res, pathname).then(handled => { if (!handled) { res.writeHead(404); res.end(); } });
    });
    await new Promise<void>(accept => server.listen(0, '127.0.0.1', accept));
    origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const { launchChrome } = createRequire(import.meta.url)('../../studio/checks/chrome-launch.cjs');
    const browser = await launchChrome({ args: ['--no-sandbox'] });
    const open = async (path: string) => {
      const page = await browser.newPage(), errors: string[] = [];
      page.on('console', (message: { type(): string; text(): string }) => { if (message.type() === 'error') errors.push(message.text()); });
      await page.goto(`${origin}${path}`, { waitUntil: 'load' });
      const texts = async () => Promise.all(page.frames().map(async (frame: { evaluate(fn: () => string): Promise<string> }) => frame.evaluate(() => document.body?.innerText ?? '').catch(() => '')));
      // Settled when the nested specimen shows, or when a frame-ancestors refusal is reported.
      for (let wait = 0; wait < 100 && !(await texts()).includes(CARD_TEXT) && !errors.some(error => error.includes('frame-ancestors')); wait++) await page.waitForTimeout(100);
      const result = { nested: (await texts()).includes(CARD_TEXT), errors, frames: page.frames().map((frame: { url(): string }) => frame.url()) };
      await page.close();
      return result;
    };
    try {
      const card = await open('/studio-card.html');
      // Nothing is refused by a policy (the frame page's stylesheet and favicon are not part of this server).
      expect(card.errors.filter(error => /Content Security Policy|frame-ancestors|refused/i.test(error))).toEqual([]);
      expect(card.nested).toBe(true);
      const preview = await open('/served-preview.html');
      expect(preview.nested).toBe(false);
      // Chrome names only the refused frame's origin; the specimen chain shows that only the nested one is refused.
      expect(preview.errors.some(error => /^Framing 'http:\/\/127\.0\.0\.1:\d+\/' violates the following Content Security Policy directive: "frame-ancestors 'self'"/.test(error)), preview.errors.join('\n')).toBe(true);
      expect(preview.frames.slice(1, 3)).toEqual([`${origin}${VIEWER}`, `${origin}/__specimen-site/${build}/index.html?page=viewer`]);
    } finally {
      await browser.close();
      await new Promise(accept => server.close(accept));
      rmSync(dist, { recursive: true, force: true });
    }
  }, 60_000);
});
