import { build } from 'esbuild';
import { spawnSync, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ITEMS, SDK_VERSION } from './items.mjs';

process.chdir(fileURLToPath(new URL('./', import.meta.url)));
const cache = 'node_modules/.cache/browser-evidence';
rmSync(cache, { recursive: true, force: true });
mkdirSync(`${cache}/observations`, { recursive: true });
if (!existsSync('../../packages/observer/dist/browser-analytics/providers/posthog.js')) {
  throw new Error('Build the checkout first with npm run build; this harness imports its built Observer adapter.');
}
const bundle = await build({ entryPoints: ['browser.mjs', 'preloaded.mjs'], outdir: cache,
  bundle: true, format: 'iife', platform: 'browser', target: 'es2022', logLevel: 'warning', metafile: true });
assert.ok(Object.keys(bundle.metafile.inputs).includes('node_modules/posthog-js/dist/module.mjs'), 'Measure the normal shipped ESM SDK entry.');
const selected = process.argv.slice(2);
const run = spawnSync(process.execPath, ['node_modules/@playwright/test/cli.js', 'test', ...selected], { stdio: 'inherit' });
if (run.status !== 0) process.exit(run.status ?? 1);
if (selected.length) {
  console.log('Selected probes completed; the checked-in full results were not replaced.');
  process.exit(0);
}
const rows = Object.keys(ITEMS).map(id => JSON.parse(readFileSync(`${cache}/observations/${id}.json`, 'utf8')));
const capability = rows.find(row => row.id === 'E17').observations.capabilities;
const result = {
  sdkVersion: SDK_VERSION,
  browser: rows[0].browser,
  browserFixture: {
    userAgent: 'Standard Chromium UA matching the measured browser version',
    automationControlledDisabled: true,
    reason: 'The real SDK filters HeadlessChrome and navigator.webdriver before its capture hook; these browser settings exercise the normal-visitor path.',
  },
  realBrowser: true,
  sdkArtifacts: Object.fromEntries(['dist/module.mjs', 'dist/posthog-recorder.js', 'dist/lazy-recorder.js']
    .map(path => [path, createHash('sha256').update(readFileSync(`node_modules/posthog-js/${path}`)).digest('hex')])),
  adapterBase: execFileSync('git', ['merge-base', 'origin/main', 'HEAD'], { encoding: 'utf8' }).trim(),
  network: { allPageRequestsIntercepted: true, externalRequestsForwarded: 0,
    method: 'Every HTTP request is locally fulfilled; WebSockets are closed; a dead loopback proxy also covers loopback bypasses; the origin server fails a request escaping interception.' },
  items: rows.map(({ browser, ...row }) => row),
  replayCapability: capability,
  resetCancelsPendingRequests: {
    answer: rows.find(row => row.id === 'resetCancelsPendingRequests').answer,
    ...rows.find(row => row.id === 'resetCancelsPendingRequests').observations,
  },
};
mkdirSync('results', { recursive: true });
writeFileSync(`results/${SDK_VERSION}.json`, `${JSON.stringify(result, null, 2)}\n`);
const check = spawnSync(process.execPath, ['check-results.mjs', '--self-test'], { stdio: 'inherit' });
process.exit(check.status ?? 1);
