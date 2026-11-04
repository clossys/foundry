import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { consumerFontFile, consumerGlobals, pinnedFonts } from './designer-globals.js';
import { sha256Hex } from '../records/hash.js';
import { candidatesDir, iaPath, jsonBytes, pinFile, slotDir, slotFile, slotPositions, type IaDoc } from '../records/slot-model/index.js';

const roots: string[] = [];
function put(path: string, content: string) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, content); }

/** A consumer whose globals name a hand-picked family and whose Designer slot model pins a different font item. */
function workspace(): string {
  const root = mkdtempSync(join(tmpdir(), 'designer-globals-'));
  roots.push(root);
  const lib = join(root, 'clossys');
  put(join(lib, 'package.json'), '{"name":"consumer","private":true}');
  put(join(lib, 'agents/designer/globals.css'), '@import "tailwindcss";\n@theme inline {\n  --font-heading: var(--font-display);\n}\n:root { --font-display: "Hand Picked"; }\n');
  const slot = 'themes.font-heading';
  const ia: IaDoc = { schema: 'clossys.ia/1', source: 'consumer#fixture', extensions: [], nodes: [{ id: 'themes.typography', label: 'Typography', children: [{ id: 'fonts', label: 'Fonts', slots: [slot] }] }] };
  const position = slotPositions('designer', ia).get(slot)!, dir = slotDir(lib, 'designer', slot);
  put(iaPath(lib, 'designer'), jsonBytes(ia));
  put(slotFile(dir), jsonBytes({ schema: 'clossys.slot/1', id: slot, agent: 'designer', kind: 'element', ia: position, contract: {}, inputs: [], uses: [] }));
  const candidate = jsonBytes({
    name: 'font-heading-pinned', type: 'registry:font', files: [],
    font: { family: "'Pinned Face Variable', sans-serif", variable: '--font-heading', dependency: '@fontsource-variable/pinned-face' },
    meta: { slot, source: { kind: 'registry', ref: ['fontsource:pinned-face'] } },
  });
  put(join(candidatesDir(dir), 'font-heading-pinned-v1.json'), candidate);
  put(pinFile(dir), jsonBytes({ candidate: 'font-heading-pinned-v1.json', sha256: sha256Hex(candidate), decidedBy: 'owner:fixture', basis: 'bulk', at: '2026-10-31T00:00:00Z' }));
  const pkg = join(lib, 'node_modules/@fontsource-variable/pinned-face');
  put(join(pkg, 'package.json'), '{"name":"@fontsource-variable/pinned-face","version":"5.0.0","main":"index.css"}');
  put(join(pkg, 'index.css'), "@font-face { font-family: 'Pinned Face Variable'; src: url(./files/pinned-face.woff2) format('woff2'); }\n");
  put(join(pkg, 'files/pinned-face.woff2'), 'woff2');
  return root;
}

afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe('Studio globals load the pinned font through the theme pipeline', () => {
  it('reads the pinned font item, imports its package and sets its own variable', async () => {
    const root = workspace();
    expect(pinnedFonts(root)).toEqual([expect.objectContaining({ slot: 'themes.font-heading', variable: '--font-heading', dependency: '@fontsource-variable/pinned-face' })]);
    const globals = (await consumerGlobals(root))!;
    expect(globals.missing).toEqual([]);
    expect(globals.css).toContain('url(/api/designer/fonts/@fontsource-variable/pinned-face/files/pinned-face.woff2)');
    expect(globals.css).toMatch(/\.font-heading\s*\{\s*font-family:\s*'Pinned Face Variable', sans-serif;/);
    expect(globals.css).not.toMatch(/\.font-heading\s*\{\s*font-family:\s*var\(--font-display\)/);
    expect((await consumerFontFile(root, '/api/designer/fonts/@fontsource-variable/pinned-face/files/pinned-face.woff2'))?.type).toBe('font/woff2');
  });
});
