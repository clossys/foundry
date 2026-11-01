import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { createSpecimenBuilder, specimenEntry } from '@clossys/publisher/specimen';
import { libraryRecordSource, listLibraryElements } from './library-source.js';
import { listSlots } from '../records/slots.js';
import { STUDIO_DEPENDENCY_FILES, studioDependencies } from './studio-dependencies.js';
import type { SpecimenDependencies, SpecimenRecord } from '@clossys/publisher/specimen';

const workspace = fileURLToPath(new URL('../../../../', import.meta.url));
const nativeRoot = fileURLToPath(new URL('../../studio/', import.meta.url));
const consumer = join(workspace, 'clossys');
const temps: string[] = [];
afterEach(() => { for (const root of temps.splice(0)) rmSync(root, { recursive: true, force: true }); });
const temp = () => { const root = realpathSync(mkdtempSync(join(tmpdir(), 'studio-dependencies-'))); temps.push(root); return root; };
const nativeRecord = async () => (await libraryRecordSource({ roots: [consumer] }).read('frames.studio-shell/studio-shell', 6))!;
function manifest(record: SpecimenRecord, edit: (value: any) => void): SpecimenRecord {
  const copy = structuredClone(record), file = copy.payload.files.find(file => file.path === 'registry-item.json')!;
  const item = JSON.parse(file.content); edit(item);
  return { ...copy, payload: { ...copy.payload, files: copy.payload.files.map(row => row === file ? { ...row, content: JSON.stringify(item) } : row) } };
}

describe('package-owned Studio dependency materialization', () => {
  it('materializes the actual 13 native host files without changing canonical v6 payload authority', async () => {
    const source = libraryRecordSource({ roots: [consumer] }), record = (await source.read('frames.studio-shell/studio-shell', 6))!;
    const before = JSON.stringify(record), envelope = (await source.dependencies!(record))!;
    expect(record.version).toBe(6);
    expect(specimenEntry(record)?.path).toBe('index.tsx');
    expect(envelope.files.map(file => file.path)).toEqual(STUDIO_DEPENDENCY_FILES.map(path => `studio/${path}`));
    for (const file of envelope.files) expect(file.content).toBe(readFileSync(join(nativeRoot, file.path.slice('studio/'.length)), 'utf8'));
    expect(envelope.locations).toContainEqual({ path: 'index.tsx', target: 'studio/frames/studio-shell/index.tsx' });
    expect(envelope.files.find(file => file.path === 'studio/generated/studio-map.ts')!.content).toContain("from './studio-map.json'");
    expect(JSON.parse(envelope.files.find(file => file.path === 'studio/generated/studio-map.json')!.content)).toHaveProperty('map');
    expect(JSON.stringify(record)).toBe(before);
    const built = await createSpecimenBuilder({ workspace }).build(record, source);
    expect(built.errors).toEqual([]);
    expect(built.js!.length).toBeGreaterThan(0);
  }, 30_000);

  it('materializes and bundles v6 from the actual packed package using its shipped default root', async () => {
    const source = libraryRecordSource({ roots: [consumer] }), record = (await source.read('frames.studio-shell/studio-shell', 6))!;
    const destination = temp(), producer = fileURLToPath(new URL('../../', import.meta.url));
    const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const [packed] = JSON.parse(execFileSync(npm, ['pack', '--json', '--workspaces=false', '--pack-destination', destination], { cwd: producer, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));
    expect(packed.files.filter((file: { path: string }) => file.path.startsWith('studio/')).map((file: { path: string }) => file.path).sort())
      .toEqual(STUDIO_DEPENDENCY_FILES.map(path => `studio/${path}`).sort());
    execFileSync('tar', ['-xzf', join(destination, packed.filename), '-C', destination]);
    const installed = join(destination, 'package');
    // Native Node loads the shipped compiled helper; no test loader, source fallback or root override.
    const script = 'import { readFileSync } from "node:fs"; const { studioDependencies } = await import(process.argv[1]); console.log(JSON.stringify(await studioDependencies(JSON.parse(readFileSync(0, "utf8")))));';
    const envelope: SpecimenDependencies = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script, pathToFileURL(join(installed, 'dist/specimen/studio-dependencies.js')).href], { cwd: installed, input: JSON.stringify(record), encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }));
    for (const file of envelope.files) {
      expect(file.content).toBe(readFileSync(join(installed, file.path), 'utf8'));
      expect(file.content).toBe(readFileSync(join(nativeRoot, file.path.slice('studio/'.length)), 'utf8'));
    }
    expect(envelope.files).toHaveLength(STUDIO_DEPENDENCY_FILES.length);
    const built = await createSpecimenBuilder({ workspace }).build(record, { ...source, dependencies: async () => envelope });
    expect(built.errors).toEqual([]);
    expect(built.js!.length).toBeGreaterThan(0);
  }, 60_000);

  it('accepts all ten actual pinned path-only Studio section manifests and bundles the pinned checks section', async () => {
    const source = libraryRecordSource({ roots: [consumer] });
    const sections = listLibraryElements([consumer]).filter(id => id.startsWith('sections.studio.'));
    expect(sections).toHaveLength(10);
    for (const id of sections) {
      const record = (await source.read(id))!, before = JSON.stringify(record);
      const pin = listSlots(consumer, 'designer').find(slot => slot.id === id.split('/')[0])!.pin!;
      expect(record.contentHash).toBe(pin.sha256);
      const item = JSON.parse(record.payload.files.find(file => file.path === 'registry-item.json')!.content);
      expect(item.files.every((file: object) => !Object.hasOwn(file, 'content'))).toBe(true);
      const envelope = (await source.dependencies!(record))!;
      expect(envelope.locations).toEqual(item.files.map(({ path, target }: { path: string; target: string }) => ({ path, target })));
      expect(JSON.stringify(record)).toBe(before);
    }
    const checks = (await source.read('sections.studio.checks/studio-checks'))!;
    const built = await createSpecimenBuilder({ workspace }).build(checks, source);
    expect(built.errors).toEqual([]);
    expect(built.js!.length).toBeGreaterThan(0);
  }, 30_000);

  it('rejects conflicting or nonstring inner content on actual path-only section entries', async () => {
    const record = (await libraryRecordSource({ roots: [consumer] }).read('sections.studio.checks/studio-checks'))!;
    for (const content of [null, 7, {}, 'conflicting inner bytes']) {
      await expect(studioDependencies(manifest(record, item => { item.files[0].content = content; }), temp())).rejects.toThrow(/differs from payload/);
    }
    const duplicate = { ...record, payload: { ...record.payload, files: [...record.payload.files, record.payload.files.find(file => file.path === 'index.tsx')!] } };
    await expect(studioDependencies(duplicate, temp())).rejects.toThrow(/differs from payload/);
  });

  it('rejects manifest traversal, duplicate/conflicting placement, wrong identity and byte drift', async () => {
    const record = await nativeRecord();
    const edits = [
      (item: any) => { item.files[0].target = 'studio/../../outside'; },
      (item: any) => { item.files[0].target = 'studio/components/StudioProviders.tsx'; },
      (item: any) => { item.files.push({ ...item.files[0] }); },
      (item: any) => { item.files[0].content += '\n// drift'; },
      (item: any) => { item.name = 'different'; },
      (item: any) => { item.files = item.files.filter((file: any) => file.path !== 'index.tsx'); },
    ];
    for (const edit of edits) await expect(studioDependencies(manifest(record, edit), temp())).rejects.toThrow(/Studio registry/);
  });

  it('never uses consumer roots as host inputs and fails closed for a missing owned dependency', async () => {
    const record = await nativeRecord();
    await expect(studioDependencies(record, temp())).rejects.toThrow(/ENOENT/);
    const ordinary = { ...record, payload: { ...record.payload, files: record.payload.files.filter(file => file.path !== 'registry-item.json') } };
    expect(await studioDependencies(ordinary, temp())).toBeUndefined();
  });

  it('leaves ordinary frame and section manifests without Studio targets to their existing renderer', async () => {
    const record = await nativeRecord();
    for (const id of ['frames.other/other', 'sections.other/other']) {
      const ordinary = manifest({ ...record, id }, item => {
        item.name = 'other';
        item.files.forEach((file: any) => { file.target = `components/other/${file.path}`; });
      });
      expect(await studioDependencies(ordinary, temp())).toBeUndefined();
    }
  });

  it('refuses file, directory and root symlinks even when they point inside the package', async () => {
    const record = await nativeRecord();
    for (const directory of [false, true]) {
      const root = temp();
      if (directory) symlinkSync(join(nativeRoot, 'lib'), join(root, 'lib'), 'dir');
      else { mkdirSync(join(root, 'lib')); symlinkSync(join(nativeRoot, STUDIO_DEPENDENCY_FILES[0]), join(root, STUDIO_DEPENDENCY_FILES[0])); }
      await expect(studioDependencies(record, root)).rejects.toThrow(/symlink/);
    }
    const parent = temp(), root = join(parent, 'studio'); symlinkSync(nativeRoot, root, 'dir');
    await expect(studioDependencies(record, root)).rejects.toThrow(/real package directory/);
  });

  it('returns fresh host bytes on each read so a changed source cannot reuse a stale bundle identity', async () => {
    const record = await nativeRecord(), root = temp();
    for (const path of STUDIO_DEPENDENCY_FILES) { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), readFileSync(join(nativeRoot, path))); }
    const before = (await studioDependencies(record, root))!;
    writeFileSync(join(root, 'lib/studio-icons.tsx'), `${before.files[0]!.content}\n// dependency changed\n`);
    const after = (await studioDependencies(record, root))!;
    expect(after.identity).toBe(before.identity);
    expect(after.files[0]!.content).not.toBe(before.files[0]!.content);
    expect(before.files[0]!.content).toBe(readFileSync(join(nativeRoot, 'lib/studio-icons.tsx'), 'utf8'));
  });
});
