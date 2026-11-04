import { describe, expect, it } from 'vitest';
import type { SlotDetail } from '../../src/server/slot-detail';
import { slotDetailInputs } from './slot-detail';

const links = { leaf: (agent: string, id: string) => `/${agent}/${id}`, label: () => 'Example', back: { href: '/tab', label: 'Tab' } };
const detail: SlotDetail = {
  agent: 'designer', id: 'sections.example', name: 'Example', kind: 'element', trail: ['Sections', 'Examples'],
  contract: {}, inputs: [], uses: [], usedBy: [], links: [], pin: null, state: { state: 'pinned' }, history: [], checks: [],
  candidates: [{ name: 'example-v2.json', version: 2, sha256: 'a'.repeat(64), pinned: false, content: '{}', source: undefined, issues: [], specimen: 'sections.example/example' }], shown: 'example-v2.json',
};

describe('native detail viewport data for stock iframe consumers', () => {
  it('pairs every real URL width with its viewport and keeps option version/theme data', () => {
    const input = slotDetailInputs(detail, links, 'dark');
    expect(input.specimen).toMatchObject({ specimens: [375, 768, 1280].map(viewport => ({ viewport,
      light: `/__specimen?element=sections.example%2Fexample&theme=light&width=${viewport}&v=2`,
      dark: `/__specimen?element=sections.example%2Fexample&theme=dark&width=${viewport}&v=2`,
    })) });
    expect(input.options).toMatchObject({ rows: [{ version: 2, preview: { kind: 'frame', viewport: 1280, src: '/__specimen?element=sections.example%2Fexample&theme=dark&width=1280&v=2' } }] });
  });

  it('never manufactures iframe data when the native candidate has no matching artifact', () => {
    const missing = { ...detail, candidates: detail.candidates.map(candidate => ({ ...candidate, specimen: undefined })) };
    const input = slotDetailInputs(missing, links, 'light');
    // No renderer is an explicit error, never the candidate file text.
    expect(input.specimen).toMatchObject({ kind: 'record', status: { tone: 'destructive' } });
    expect(input.specimen).not.toHaveProperty('rows');
    expect(input.options).toMatchObject({ rows: [{ preview: { kind: 'strings', rows: [] } }] });
  });

  it('draws Not needed with the reason and No pin as an error', () => {
    // NEED (Writer): the Studio strings pin has no `studio.not-needed` label yet. Until Writer adds it,
    // the Not needed state refuses to render with hand-written copy; flip this when the copy lands.
    const notNeeded = { ...detail, state: { state: 'not-needed' as const, notNeeded: { reason: 'Owner: the site has no toolbar.', since: '2026-11-03' } } };
    expect(() => slotDetailInputs(notNeeded, links, 'light')).toThrow(/studio\.not-needed/);
    const noPin = slotDetailInputs({ ...detail, state: { state: 'rejected', reason: 'no-pin' } }, links, 'light');
    expect(noPin.specimen).toMatchObject({ kind: 'record', status: { label: 'No pin', tone: 'destructive' } });
  });
});
