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

export default async function nextConfig(phase) {
  const preview = await previewOptionsFromEnvironment();
  if (phase !== PHASE_DEVELOPMENT_SERVER) {
    await generateStudioMap(preview);
    return config;
  }
  // Keep record, pin, reference, manifest and compiler checks; preview reports
  // every actual file/byte mismatch without claiming release qualification.
  const projection = await generateStudioMap({ payloads: false, ...preview });
  // Each item names a Designer slot-model candidate, `<element>-v<version>.json`, that carries its files inline.
  const { readCandidate } = await import('../dist/records/slots.js');
  const clossysRoot = fileURLToPath(new URL('../../../clossys/', import.meta.url));
  for (const item of projection.items) {
    const candidate = JSON.parse(readCandidate(clossysRoot, 'designer', item.slot, `${item.element}-v${item.version}.json`).bytes);
    const files = new Map(candidate.files.map(file => [file.path, Buffer.from(file.content, 'utf8')]));
    const studioDir = fileURLToPath(new URL(`./${item.slot.startsWith('frames.') ? 'frames' : 'sections'}/${item.element}/`, import.meta.url));
    try { await checkPayload({ ...item, files, studioDir, payload: [...files.keys()], ...(item.previewEvidence ? { bound: true } : {}) }); }
    catch (error) { reportPreviewPayloadMismatch(error); }
  }
  return config;
}
