import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build as bundle } from 'esbuild';
import { describe, expect, it } from 'vitest';
import { installedSpecimenRoutes } from './installed-specimens.js';
import { sandboxSpecimenFrames, specimenHostCsp } from './publication.js';

// A specimen that frames another specimen (components.studio.block-viewer-iframe frames
// /__specimen?element=components.card/card), loaded in a real browser through the real specimen
// routes and policies in both contexts that show it:
//   - a Studio card: the page frames /__specimen unsandboxed, the specimen keeps Studio's origin
//     and its nested /__specimen loads (specimenSiteCsp frame-src);
//   - a served preview: the page carries specimenHostCsp and sandboxSpecimenFrames gives the
//     specimen `allow-scripts` only, an opaque origin, so every nested projected route refuses it
//     (`frame-ancestors 'self'`). That refusal is the boundary (no allow-same-origin, no wildcard);
//     the pinned candidate answers it by rendering a static card instead of the nested frame.
// The viewer page is the pinned candidate's own code (and v4, the last one without that answer).
const repo = resolve(fileURLToPath(new URL('../../../..', import.meta.url)));
const SLOT_DIR = join(repo, 'clossys/agents/designer/components.studio.block-viewer-iframe');
const CARD_FILE = join(repo, 'packages/designer/references/shadcn-aria/card@4.23.0/registry/aria-nova/ui/card.tsx');
const VIEWER = '/__specimen?element=components.studio.block-viewer-iframe/block-viewer-iframe&width=1280';
const CARD_TEXT = 'card specimen';
const TITLE = 'Specimen title';
const BUILD = '0123abcd';

type Candidate = { files: { path: string; content: string }[]; meta: { preview: { fixtures: { props: Record<string, unknown> } } } };
const candidate = (file: string): Candidate => JSON.parse(readFileSync(join(SLOT_DIR, 'candidates', file), 'utf8'));
const viewerCode = (item: Candidate) => item.files.find(file => file.path === 'block-viewer-iframe.tsx')!.content;

async function specimenDist(dist: string, pinned: string): Promise<{ props: Record<string, unknown> }> {
  const pin = candidate(pinned), v4 = candidate('block-viewer-iframe-v4.json');
  const props = { ...pin.meta.preview.fixtures.props, title: TITLE };
  const src = join(dist, 'src');
  mkdirSync(src);
  writeFileSync(join(src, 'pinned.tsx'), viewerCode(pin));
  writeFileSync(join(src, 'v4.tsx'), viewerCode(v4));
  writeFileSync(join(src, 'cn.ts'), 'export const cn = (...names: unknown[]) => names.filter(Boolean).join(" ");\n');
  writeFileSync(join(src, 'main.tsx'), `import { createRoot } from "react-dom/client";
import { BlockViewerIframe as Pinned } from "./pinned";
import { BlockViewerIframe as V4 } from "./v4";
const page = new URLSearchParams(location.search).get("page");
const props = ${JSON.stringify(props)};
if (page === "card") document.body.textContent = ${JSON.stringify(CARD_TEXT)};
else { const View = page === "viewer-v4" ? V4 : Pinned; createRoot(document.body.appendChild(document.createElement("div"))).render(<View {...props} />); }
`);
  mkdirSync(join(dist, 'assets'));
  await bundle({
    entryPoints: [join(src, 'main.tsx')], outfile: join(dist, 'assets/index.js'), bundle: true, format: 'iife', jsx: 'automatic', logLevel: 'silent',
    define: { 'process.env.NODE_ENV': '"production"' }, nodePaths: [join(repo, 'node_modules')],
    plugins: [{ name: 'aliases', setup(build) {
      build.onResolve({ filter: /^@\/components\/ui\/card$/ }, () => ({ path: CARD_FILE }));
      build.onResolve({ filter: /^cn$/ }, () => ({ path: join(src, 'cn.ts') }));
    } }],
  });
  writeFileSync(join(dist, 'index.html'), `<!doctype html><html><head><script src="/__specimen-site/${BUILD}/assets/index.js" defer></script></head><body></body></html>`);
  return { props };
}

describe('a specimen that frames a specimen', () => {
  it('loads its nested specimen in a Studio card and renders a static card in a served preview', async () => {
    const pinned = JSON.parse(readFileSync(join(SLOT_DIR, 'pin.json'), 'utf8')).candidate as string;
    const version = Number(/-v(\d+)\.json$/.exec(pinned)![1]);
    const dist = mkdtempSync(join(tmpdir(), 'specimen-nested-'));
    const { props } = await specimenDist(dist, pinned);
    const site = { key: BUILD, builds: [{ key: BUILD, dist }], findings: [], pages: new Map([
      [`components.studio.block-viewer-iframe/block-viewer-iframe@v${version}`, { page: 'viewer', element: 'block-viewer-iframe', version, build: BUILD }],
      ['components.studio.block-viewer-iframe/block-viewer-iframe@v4', { page: 'viewer-v4', element: 'block-viewer-iframe', version: 4, build: BUILD }],
      ['components.card/card@v1', { page: 'card', element: 'card', version: 1, build: BUILD }],
    ]) };
    const routes = installedSpecimenRoutes(Promise.resolve(site));
    let origin = '';
    const host = (viewer: string, preview: boolean) => {
      const body = `<!doctype html><iframe src="${viewer}" width="1280" height="600"></iframe>`;
      return preview ? sandboxSpecimenFrames(body, 'studio') : body;
    };
    const server = createServer((req, res) => {
      const url = new URL(req.url!, 'http://x');
      const viewer = url.searchParams.get('v') === '4' ? `${VIEWER}&v=4` : VIEWER;
      if (url.pathname === '/studio-card.html') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(host(viewer, false)); return; }
      if (url.pathname === '/served-preview.html') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': specimenHostCsp(origin, 'studio') });
        res.end(host(viewer, true));
        return;
      }
      void routes.handle(req, res, url.pathname).then(handled => { if (!handled) { res.writeHead(404); res.end(); } });
    });
    await new Promise<void>(accept => server.listen(0, '127.0.0.1', accept));
    origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const { launchChrome } = createRequire(import.meta.url)('../../studio/checks/chrome-launch.cjs');
    const browser = await launchChrome({ args: ['--no-sandbox'] });
    type Frame = { url(): string; evaluate<T>(fn: () => T): Promise<T> };
    const open = async (path: string) => {
      const page = await browser.newPage(), errors: string[] = [];
      page.on('console', (message: { type(): string; text(): string }) => { if (message.type() === 'error') errors.push(message.text()); });
      page.on('pageerror', (error: Error) => errors.push(`pageerror: ${error.message}`));
      await page.goto(`${origin}${path}`, { waitUntil: 'load' });
      const state = async () => {
        const frames = page.frames() as Frame[];
        const read = await Promise.all(frames.map(frame => frame.evaluate(() => ({ text: document.body?.innerText ?? '', static: document.querySelector('[data-specimen-static]')?.textContent ?? null })).catch(() => ({ text: '', static: null }))));
        return { nested: read.some(entry => entry.text.includes(CARD_TEXT)), staticCard: read.map(entry => entry.static).find(text => text !== null) ?? null, frames: frames.map(frame => frame.url()) };
      };
      // Settled when the nested specimen or the static card shows, or a frame-ancestors refusal is reported.
      for (let wait = 0; wait < 100; wait++) {
        const now = await state();
        if (now.nested || now.staticCard !== null || errors.some(error => error.includes('frame-ancestors'))) break;
        await page.waitForTimeout(100);
      }
      await page.waitForTimeout(300);
      const result = { ...(await state()), errors };
      await page.close();
      return result;
    };
    // Only policy refusals and page errors count (the frame page's stylesheet and favicon are not part of this server).
    const refusals = (errors: string[]) => errors.filter(error => /Content Security Policy|frame-ancestors|refused|pageerror/i.test(error));
    const specimenSite = (page: string) => `${origin}/__specimen-site/${BUILD}/index.html?page=${page}`;
    try {
      const card = await open('/studio-card.html');
      expect(refusals(card.errors)).toEqual([]);
      expect(card.nested).toBe(true);
      expect(card.staticCard).toBeNull();

      const preview = await open('/served-preview.html');
      expect(refusals(preview.errors), preview.errors.join('\n')).toEqual([]);
      expect(preview.nested).toBe(false);
      expect(preview.staticCard).toBe(TITLE);
      // No nested projected route is requested at all: the chain stops at the specimen page.
      expect(preview.frames.slice(1)).toEqual([`${origin}${VIEWER}`, specimenSite('viewer')]);

      // The boundary itself is unchanged: v4, which frames the nested route anyway, is still refused.
      const refused = await open('/served-preview.html?v=4');
      expect(refused.nested).toBe(false);
      expect(refused.errors.some(error => /^Framing 'http:\/\/127\.0\.0\.1:\d+\/' violates the following Content Security Policy directive: "frame-ancestors 'self'"/.test(error)), refused.errors.join('\n')).toBe(true);
      expect(refused.frames.slice(1, 3)).toEqual([`${origin}${VIEWER}&v=4`, specimenSite('viewer-v4')]);
      expect(props.src).toBe('/__specimen?element=components.card/card&width=1280');
    } finally {
      await browser.close();
      await new Promise(accept => server.close(accept));
      rmSync(dist, { recursive: true, force: true });
    }
  }, 90_000);
});
