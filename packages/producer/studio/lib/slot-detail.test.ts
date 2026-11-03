import { describe, expect, it } from 'vitest';
import type { SlotDetail } from '../../src/server/slot-detail';
import { slotDetailInputs } from './slot-detail';

const links = { leaf: (agent: string, id: string) => `/${agent}/${id}`, back: { href: '/tab', label: 'Tab' } };
const detail: SlotDetail = {
  agent: 'designer', id: 'sections.example', kind: 'element', trail: ['Sections', 'Examples'],
  contract: {}, inputs: [], uses: [], usedBy: [], links: [], pin: null, history: [], checks: [],
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
    expect(input.specimen).toMatchObject({ kind: 'record', rows: [{ text: '{}' }] });
    expect(input.options).toMatchObject({ rows: [{ preview: { kind: 'strings' } }] });
  });
});
