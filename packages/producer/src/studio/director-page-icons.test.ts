import { describe, expect, it } from 'vitest';
import { loadCatalog } from '@clossys/designer/catalog';
import projection from '../../studio/generated/studio-map.json';

describe('Director page action asset bindings', () => {
  it('uses registered native asset IDs with genuine Lucide candidates', () => {
    const catalog = loadCatalog();
    const actions = projection.pageActions.director;
    expect(actions).toHaveLength(5);
    for (const action of actions) {
      expect(catalog.slots.some(slot => slot.id === action.icon), action.id).toBe(true);
      const candidates = catalog.fills.filter(fill => {
        const meta = fill.$extensions['com.clossys.fill'];
        return meta.slot === action.icon && meta.source === 'lucide';
      });
      expect(candidates, action.id).toHaveLength(1);
      expect(candidates[0]!.$extensions['com.clossys.fill'], action.id).toMatchObject({
        id: `lucide/${action.icon}`, source: 'lucide',
        pin: { package: 'lucide-react', file: expect.stringMatching(/^src\/icons\/[A-Za-z]+\.ts$/), sha256: expect.stringMatching(/^[a-f0-9]{64}$/) },
      });
    }
  });
});
