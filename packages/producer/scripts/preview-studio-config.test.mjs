import test from 'node:test';
import assert from 'node:assert/strict';
import { PHASE_DEVELOPMENT_SERVER, PHASE_PRODUCTION_BUILD } from 'next/constants.js';
import { generateStudioMap } from './generate-studio-map.mjs';
import nextConfig, { reportPreviewPayloadMismatch } from '../studio/next.config.mjs';

test('development reports actual payload findings and non-development preserves the strict outcome', async () => {
  let strictError;
  const reports = [], warn = console.warn;
  try {
    console.warn = message => reports.push(message);
    try { await generateStudioMap(); }
    catch (error) { reportPreviewPayloadMismatch(error); strictError = error; }
    reports.length = 0;
    const config = await nextConfig(PHASE_DEVELOPMENT_SERVER);
    assert.equal(config.output, 'standalone');
  } finally { console.warn = warn; }
  if (strictError) assert.ok(reports.some(message => message.endsWith(strictError.message)));
  else assert.deepEqual(reports, []);
  assert.ok(reports.every(message => message.startsWith('[Studio preview payload report] Studio assembly: ')));
  for (const phase of [PHASE_PRODUCTION_BUILD, undefined]) {
    if (strictError) await assert.rejects(nextConfig(phase), error => error.constructor === strictError.constructor && error.message === strictError.message && error.code === strictError.code);
    else await assert.doesNotReject(nextConfig(phase));
  }
});

test('preview does not absorb I/O, parsing or structural failures', () => {
  for (const error of [Object.assign(new Error('missing payload'), { code: 'ENOENT' }), new SyntaxError('invalid record'), new Error('Studio assembly: frames.studio-shell has no pin in the Studio library selection')]) {
    assert.throws(() => reportPreviewPayloadMismatch(error), actual => actual === error);
  }
});
