import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PHASE_DEVELOPMENT_SERVER } from 'next/constants.js';
import { checkPayload } from '../scripts/studio-payload.mjs';
import { generateStudioMap } from '../scripts/generate-studio-map.mjs';
import { previewOptionsFromEnvironment } from '../scripts/studio-draft-items.mjs';

/** Only the payload check's two provenance mismatch outcomes are preview reports. */
export function reportPreviewPayloadMismatch(error) {
  if (!(error instanceof Error) || error.code || !/^Studio assembly: [a-z0-9.-]+: (?:studio folder files \[.*\] differ from the pinned payload \[.*\]|[^\n]+ differs from [a-z0-9-]+ v[0-9]+ (?:in the library|as pinned|as bound))$/.test(error.message)) throw error;
  console.warn(`[Studio preview payload report] ${error.message}`);
}

/** @type {import('next').NextConfig} */
const config = {
  output: 'standalone',
  agentRules: false,
  outputFileTracingRoot: fileURLToPath(new URL('../../../', import.meta.url)),
  transpilePackages: ['@clossys/designer', '@clossys/designer-ui'],
};

/** The tracked page projection: Studio's frames, sections, copy and routes are package files. */
const trackedProjection = async () => JSON.parse(await readFile(new URL('./generated/studio-map.json', import.meta.url), 'utf8'));

/**
 * The consumer a build regenerates Studio from: `CLOSSYS_ROOT` (a root holding clossys/), else none.
 * Studio is package-owned (SOURCE-MIGRATE): without a named consumer it builds from the tracked
 * projection and reads no consumer pins.
 */
const consumerRoot = () => (process.env.CLOSSYS_ROOT ? resolve(process.env.CLOSSYS_ROOT) : undefined);

/** Run the compile verb in place against the named consumer and read back the page projection it wrote. */
async function compiledProjection(root) {
  const { runCompileCli } = await import('../dist/cli/compile.js');
  const result = await runCompileCli(['--root', root], root);
  if (result.exitCode !== 0) throw new Error(result.message);
  return trackedProjection();
}

/** The redirects the publication's content map projects (agent groups to their first tab, legacy leaf paths to tab leaves). */
const withRedirects = projection => ({ ...config, redirects: async () => projection.redirects.map(row => ({ ...row })) });

export default async function nextConfig(phase) {
  const preview = await previewOptionsFromEnvironment();
  const root = consumerRoot();
  if (!root) {
    if (preview.target) throw new Error('A Studio draft preview needs CLOSSYS_ROOT: the consumer whose draft bindings it renders');
    return withRedirects(await trackedProjection());
  }
  const clossysRoot = join(root, 'clossys');
  // A release build renders through `clossys compile` (decision files only, deterministic);
  // an explicit draft preview keeps its own unapproved generation path.
  if (phase !== PHASE_DEVELOPMENT_SERVER) return withRedirects(preview.target ? await generateStudioMap({ clossysRoot, ...preview }) : await compiledProjection(root));
  // Keep record, pin, reference, manifest and compiler checks; preview reports
  // every actual file/byte mismatch without claiming release qualification.
  const projection = await generateStudioMap({ clossysRoot, payloads: false, ...preview });
  // Each item names a Designer slot-model candidate, `<element>-v<version>.json`, that carries its files inline.
  const { readCandidate } = await import('../dist/records/slots.js');
  for (const item of projection.items) {
    const candidate = JSON.parse(readCandidate(clossysRoot, 'designer', item.slot, `${item.element}-v${item.version}.json`).bytes);
    const files = new Map(candidate.files.map(file => [file.path, Buffer.from(file.content, 'utf8')]));
    const studioDir = fileURLToPath(new URL(`./${item.slot.startsWith('frames.') ? 'frames' : 'sections'}/${item.element}/`, import.meta.url));
    try { await checkPayload({ ...item, files, studioDir, payload: [...files.keys()], ...(item.previewEvidence ? { bound: true } : {}) }); }
    catch (error) { reportPreviewPayloadMismatch(error); }
  }
  return withRedirects(projection);
}
