import { mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolve } from '@clossys/designer/catalog';
import { prepareStudioSelection } from './selection-defaults.js';
import { emitStudioSurfaces, resolveStudioRender, studioEvidence, type StudioGateReport } from './studio-render-policy.js';
import { agentModule, readCells, readStudioCells } from './cells.js';
import { readStudioDesignerLibrary } from './theme.js';

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

async function cellFixture() {
  await mkdir('tmp/p0b-resume/policy', { recursive: true });
  const root = await mkdtemp('tmp/p0b-resume/policy/confirmation-');
  const base = join(root, 'clossys/agents/designer');
  await mkdir(join(base, 'cells/components.button'), { recursive: true });
  const fill = { $extensions: { 'com.clossys.fill': { slot: 'components.button' } }, components: {} };
  const source = `---\nid: components.button\nversion: 1\nstatus: active\nupdated: 2026-10-30\nlinks: []\noriginKinds: [authored]\nsources: []\n---\n\n## Rationale\n\n## Fill\n\n\`\`\`json\n${JSON.stringify(fill)}\n\`\`\`\n`;
  await writeFile(join(base, 'cells/components.button/v1.md'), source);
  await writeFile(join(base, 'tree.json'), JSON.stringify({ schemaVersion: 1, active: { 'components.button': 1 }, retired: [], meta: { source: { id: 'example', kind: 'consumer', author: 'consumer', license: 'MIT' }, metadata: { format: 'composite-v1', values: {}, components: {}, files: [] } } }));
  return { root, base, source };
}

it('previews unconfirmed source without changing status, confirmation, cells or strict reads', async () => {
  const fixture = await cellFixture(), reports: StudioGateReport[] = [];
  await expect(readCells(fixture.root, 'designer', true)).rejects.toThrow(/confirmation/i);
  const cells = await readStudioCells(fixture.root, 'designer', finding => reports.push(finding), true);
  expect(cells[0]).toMatchObject({ id: 'components.button', status: 'active', source: fixture.source });
  expect(cells[0]!.document.fields.confirmed).toBeUndefined();
  expect(reports).toContainEqual(expect.objectContaining({ gate: 'render-cell-confirmations', blocking: false }));
  const library = await readStudioDesignerLibrary(fixture.root, finding => reports.push(finding));
  expect(library?.activeIds).toEqual(['components.button']);
  expect(await readFile(join(fixture.base, 'cells/components.button/v1.md'), 'utf8')).toBe(fixture.source);
  await expect(readCells(fixture.root, 'designer', true)).rejects.toThrow(/confirmation/i);
  const linked = await cellFixture();
  await symlink(join(process.cwd(), linked.base, 'cells/components.button/v1.md'), join(linked.base, 'cells/components.button/v2.md'));
  await expect(readStudioCells(linked.root, 'designer', finding => reports.push(finding))).rejects.toThrow(/version file|Symbolic/);
});
