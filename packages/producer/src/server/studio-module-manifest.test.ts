import { describe, expect, it } from 'vitest';
import { studioModuleRequirements } from './studio-module-manifest';

describe('actual Studio module leaf requirements', () => {
  it('requires only sections authored by the actual manifest and no invented module-frame leaf', async () => {
    expect(await studioModuleRequirements()).toEqual(['sections.content', 'sections.explorer', 'sections.record-detail', 'sections.status-list', 'sections.task-list']);
    expect((await studioModuleRequirements()).some(id => id.startsWith('frames.'))).toBe(false);
  });
});
