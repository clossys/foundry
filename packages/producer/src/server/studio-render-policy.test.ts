import { describe, expect, it } from 'vitest';
import { resolve } from '@clossys/designer/catalog';
import { prepareStudioSelection } from './selection-defaults.js';
import { emitStudioSurfaces, resolveStudioRender, studioEvidence, type StudioGateReport } from './studio-render-policy.js';
import { agentModule } from './cells.js';

const unavailableEvidence = {
  async specimenSurfaceEnvironment(): Promise<never> { throw new Error('Native specimen source evidence unavailable: fixture certificate absent'); },
  async qualifySpecimenSurfaces(): Promise<never> { throw new Error('Native specimen source evidence unavailable: fixture certificate absent'); },
};

describe('Studio render reports preserve strict catalog capability', () => {
  it('renders actual edited surface source with failed diagnostics while strict resolution and emission stay red', async () => {
    const reports: StudioGateReport[] = [], report = (finding: StudioGateReport) => reports.push(finding);
    await expect(prepareStudioSelection(undefined, unavailableEvidence)).rejects.toThrow('fixture certificate absent');
    const prepared = await prepareStudioSelection(undefined, unavailableEvidence, report);
    expect(reports.some(finding => finding.gate === 'specimen-certificates' && finding.message.includes('fixture certificate absent'))).toBe(true);
    const input = { ...prepared.input, library: structuredClone(prepared.input.library) };
    const source = input.library.surfaces!.files.find(file => /\.tsx$/.test(file.path))!;
    expect(source).toBeDefined();
    const edit = '\n// Studio render fixture: changed actual source bytes.\n';
    source.content += edit;
    expect(() => resolve(input)).toThrow(/surfaces: S[1-8]/);
    const profile = await resolveStudioRender(input, report);
    expect(profile.surfaces!.check.ok).toBe(false);
    expect(reports.every(finding => finding.blocking === false)).toBe(true);
    const surfaceApi = await agentModule('designer', 'catalog-core/surface-emit.js');
    expect(() => surfaceApi.emitSurfaces(profile.surfaces, ['surface-index'])).toThrow('S8');
    const emitted = await emitStudioSurfaces(profile.surfaces!, report);
    expect(emitted.find(file => file.path === source.path)?.contents).toContain(edit);
    expect(profile.surfaces!.check.ok).toBe(false);
    expect(emitted.some(file => file.path === 'surface-index.ts')).toBe(true);
    const missing = { ...profile.surfaces!, files: profile.surfaces!.files.filter(file => file.path !== source.path) };
    await expect(emitStudioSurfaces(missing, report)).rejects.toThrow('source is missing');
  }, 60_000);

  it('does not turn a missing module or actual compiler failure into evidence suspension', async () => {
    const reports: StudioGateReport[] = [];
    await expect(studioEvidence('S8', async () => { throw new Error('Cannot find package actual-renderer'); }, () => 'fabricated', finding => reports.push(finding))).rejects.toThrow('Cannot find package');
    expect(reports).toEqual([]);
  });
});
