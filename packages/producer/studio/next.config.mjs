import { fileURLToPath } from 'node:url';

/** @type {import('next').NextConfig} */
const config = {
  output: 'standalone',
  agentRules: false,
  outputFileTracingRoot: fileURLToPath(new URL('../../../', import.meta.url)),
  transpilePackages: ['@clossys/designer'],
};

export default config;
