import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { InstallPins } from '@clossys/publisher/install';
import { buildSite, renderFailedFinding, savedSite, specimenSiteCsp, type PassOptions, type PassResult, type SiteInputs } from './installed-specimens.js';

const temps: string[] = [];
afterAll(() => { for (const dir of temps) rmSync(dir, { recursive: true, force: true }); });
const temp = () => { const dir = realpathSync(mkdtempSync(join(tmpdir(), 'producer-specimen-layers-'))); temps.push(dir); return dir; };

const manifest = (dir: string, body: unknown) => { const file = join(dir, 'site-k.json'); writeFileSync(file, JSON.stringify(body)); return file; };

describe('saved specimen manifests', () => {
  it('never reuses a pass that did not build: no dist and a render-failed finding is not a finished site', async () => {
    const dir = temp();
    const failed = manifest(dir, { builds: [], pages: {}, findings: [{ code: 'render-failed', detail: 'specimen build k exited 1' }] });
    expect(await savedSite(failed)).toBeUndefined();
    // The substrate's npm install failing is the pass failing too.
    expect(await savedSite(manifest(dir, { builds: [], pages: {}, findings: [{ code: 'install-failed', detail: 'npm install exited 1' }] }))).toBeUndefined();
  });

  it('reuses a pass with nothing to build and one whose every dist is on disk', async () => {
    const dir = temp();
    // Every slot refused at install (slot findings): deterministic, so the empty pass is kept.
    const refused = await savedSite(manifest(dir, { builds: [], pages: {}, findings: [{ code: 'install-failed', slot: 'sections.a', detail: 'shadcn add exited 1' }] }));
    expect(refused?.builds).toEqual([]);
    const dist = join(dir, 'dist-k');
    mkdirSync(dist); writeFileSync(join(dist, 'index.html'), '<html></html>');
    const built = await savedSite(manifest(dir, { builds: [{ key: 'k', dist }], pages: { 'components.a/a@v1': { page: 'p', element: 'a', version: 1, build: 'k' } }, findings: [] }));
    expect([...built!.pages.keys()]).toEqual(['components.a/a@v1']);
    rmSync(dist, { recursive: true });
    expect(await savedSite(join(dir, 'site-k.json'))).toBeUndefined();
  });
});

describe('render-failed findings', () => {
  it('keep the head of vite output, where the error is named, and its tail', () => {
    const output = ['error during build:', '[vite]: Rollup failed to resolve import "@/components/ui/missing"', ...Array.from({ length: 60 }, (_, index) => `    at frame ${index}`), '  errors: [Getter/Setter] }'].join('\n');
    const finding = renderFailedFinding('k', 1, output);
    expect(finding.code).toBe('render-failed');
    expect(finding.detail).toContain('Rollup failed to resolve import "@/components/ui/missing"');
    expect(finding.detail).toContain('errors: [Getter/Setter] }');
    expect(finding.detail).toContain('lines omitted');
    expect(finding.detail.split('\n').length).toBeLessThan(30);
  });
});

describe('pinned specimen site', () => {
  const pins: InstallPins = {
    'themes.palette': { element: 'palette', version: 1 }, 'assets.logo': { element: 'logo', version: 1 },
    'components.button': { element: 'button', version: 2 }, 'components.card': { element: 'card', version: 1 },
    'sections.hero': { element: 'hero', version: 3 }, 'frames.app': { element: 'app', version: 1 },
  };
  const inputs = (base: string): SiteInputs => ({
    root: base, library: base, key: '0123456789abcdef', substrate: join(base, 'substrate'), base, pins, unpinned: {}, options: new Map(),
    records: [], recordFindings: [], copy: {}, pinnedCopy: {},
  });
  /** A pass that builds every page of its layer except one whose bundle breaks. */
  const steps = (broken: string, ran: string[][]) => ({
    prepare: async () => undefined,
    async pass(options: PassOptions): Promise<PassResult> {
      ran.push([...options.slots]);
      if (options.slots.some(slot => slot.startsWith(`${broken}.`))) return { pages: new Map(), findings: [renderFailedFinding(options.build.key, 1, 'error during build:\nbroken page module')], built: false };
      mkdirSync(options.build.dist, { recursive: true }); writeFileSync(join(options.build.dist, 'index.html'), '<html></html>');
      const pages = new Map(options.slots.map(slot => [`${slot}/${pins[slot]!.element}@v${pins[slot]!.version}`, { page: slot, element: pins[slot]!.element, version: pins[slot]!.version, build: options.build.key }]));
      return { pages, findings: [], built: true };
    },
  });

  it('builds each layer on its own: one broken page module blanks only its layer and its finding is surfaced', async () => {
    const base = temp(), ran: string[][] = [];
    const site = await buildSite(inputs(base), steps('components', ran));
    // One pass per layer, each with only its own slots; themes last (their pages read what the others install).
    expect(ran.map(slots => slots.map(slot => slot.split('.')[0]))).toEqual([['assets'], ['components', 'components'], ['frames'], ['sections'], ['themes']]);
    expect([...site.pages.keys()].sort()).toEqual(['assets.logo/logo@v1', 'frames.app/app@v1', 'sections.hero/hero@v3', 'themes.palette/palette@v1']);
    expect(site.builds).toHaveLength(4);
    expect(site.findings).toEqual([expect.objectContaining({ code: 'render-failed', detail: expect.stringContaining('broken page module') })]);
    // Every layer build is served under the site policy scoped to its own key.
    for (const build of site.builds) expect(specimenSiteCsp('http://127.0.0.1:4300', build.key)).toContain(`script-src http://127.0.0.1:4300/__specimen-site/${build.key}/`);
    for (const page of site.pages.values()) expect(site.builds.map(build => build.key)).toContain(page.build);
  });

  it('rebuilds only the failed layer on the next start; built layers come from their saved manifests', async () => {
    const base = temp(), first: string[][] = [], second: string[][] = [];
    await buildSite(inputs(base), steps('components', first));
    const site = await buildSite(inputs(base), steps('none', second));
    expect(second).toEqual([['components.button', 'components.card']]);
    expect(site.pages.size).toBe(6);
    expect(site.findings).toEqual([]);
  });
});
