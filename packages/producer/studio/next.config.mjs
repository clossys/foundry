import { fileURLToPath } from 'node:url';
import { generateStudioMap } from '../scripts/generate-studio-map.mjs';

await generateStudioMap();

/** @type {import('next').NextConfig} */
const config = {
  output: 'standalone',
  agentRules: false,
  outputFileTracingRoot: fileURLToPath(new URL('../../../', import.meta.url)),
  transpilePackages: ['@clossys/designer'],
};

export default config;
