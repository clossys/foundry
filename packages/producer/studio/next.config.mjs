import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PHASE_DEVELOPMENT_SERVER } from 'next/constants.js';
import { checkPayload } from '../scripts/studio-payload.mjs';
import { generateStudioMap } from '../scripts/generate-studio-map.mjs';

/** Only the payload check's two provenance mismatch outcomes are preview reports. */
export function reportPreviewPayloadMismatch(error) {
  if (!(error instanceof Error) || error.code || !/^Studio assembly: [a-z0-9.-]+: (?:studio folder files \[.*\] differ from the pinned payload \[.*\]|[^\n]+ differs from [a-z0-9-]+ v[0-9]+ in the library)$/.test(error.message)) throw error;
  console.warn(`[Studio preview payload report] ${error.message}`);
}

/** @type {import('next').NextConfig} */
const config = {
  output: 'standalone',
  agentRules: false,
  outputFileTracingRoot: fileURLToPath(new URL('../../../', import.meta.url)),
  transpilePackages: ['@clossys/designer', '@clossys/designer-ui'],
};

export default async function nextConfig(phase) {
  if (phase !== PHASE_DEVELOPMENT_SERVER) {
    await generateStudioMap();
    return config;
  }
  // Keep record, pin, reference, manifest and compiler checks; preview reports
  // every actual file/byte mismatch without claiming release qualification.
  const projection = await generateStudioMap({ payloads: false });
  const library = fileURLToPath(new URL('../../../clossys/library/', import.meta.url));
  for (const item of projection.items) {
    const versionDir = join(library, item.slot, item.element, `v${item.version}`);
    const record = JSON.parse(await readFile(join(versionDir, 'element.json'), 'utf8'));
    const studioDir = fileURLToPath(new URL(`./${item.slot.startsWith('frames.') ? 'frames' : 'sections'}/${item.element}/`, import.meta.url));
    try { await checkPayload({ ...item, versionDir, studioDir, payload: record.payload }); }
    catch (error) { reportPreviewPayloadMismatch(error); }
  }
  return config;
}
