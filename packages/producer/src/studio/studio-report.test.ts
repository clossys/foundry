import { describe, expect, it } from 'vitest';
import { studioReports } from '../../studio/lib/studio-report';

const H = `sha256:${'a'.repeat(64)}`;
const pinned = { hash: H, leaves: [{ leaf: 'frames.studio-shell', source: 'consumer', fill: 'studio-shell@v20', hash: H }], gateReports: [] };
const selectionReports = (selection: unknown) => studioReports({ selection }).filter(report => report.area === 'selection').map(report => report.id);

describe('Studio selection reports', () => {
  it('reports no selection problem for the slot model pinned selection', () => {
    expect(selectionReports(pinned)).toEqual([]);
  });

  it('reports no selection problem for a compiled legacy runtime', () => {
    expect(selectionReports({ runtimeUrl: '/api/selection/runtime.js?hash=x', leaves: [] })).toEqual([]);
  });

  it('still reports an empty, unpinned or unhashed selection as not qualified', () => {
    expect(selectionReports({ ...pinned, leaves: [] })).toEqual(['selection']);
    expect(selectionReports({ ...pinned, leaves: [{ ...pinned.leaves[0], hash: undefined }] })).toEqual(['selection']);
    expect(selectionReports({ ...pinned, leaves: [{ ...pinned.leaves[0], fill: 'studio-shell' }] })).toEqual(['selection']);
    expect(selectionReports({ ...pinned, leaves: [{ ...pinned.leaves[0], source: 'foundry' }] })).toEqual(['selection']);
    expect(selectionReports(undefined)).toEqual(['selection']);
  });
});
