#!/usr/bin/env node
// Regenerates the measured hashes of provenance.json: the emitted stock parts file and the consumer
// section that places them. Upstream files, byte ranges and part bindings are not touched; the
// source test (../studio-home-stock.source.test.mjs) still proves them against the upstream bytes.
// Usage: node refresh-provenance.mjs [--check]   (--check exits 1 when a measured hash is stale)
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const here = new URL('./', import.meta.url);
const manifestUrl = new URL('provenance.json', here);
const manifest = JSON.parse(readFileSync(manifestUrl, 'utf8'));
const sha = url => createHash('sha256').update(readFileSync(url)).digest('hex');
const measured = {
  emitted: sha(new URL('../' + manifest.emitted.file, here)),
  consumer: sha(new URL('../../../../' + manifest.consumer.file, here)),
};
const stale = Object.entries(measured).filter(([key, value]) => manifest[key].sha256 !== value).map(([key]) => key);
if (process.argv.includes('--check')) {
  if (stale.length) { console.error(`stale measured hash: ${stale.join(', ')}`); process.exit(1); }
  console.log('provenance hashes current');
} else {
  for (const [key, value] of Object.entries(measured)) manifest[key].sha256 = value;
  writeFileSync(manifestUrl, JSON.stringify(manifest, null, 2) + '\n');
  console.log(stale.length ? `refreshed ${stale.join(', ')}` : 'provenance hashes current');
}
