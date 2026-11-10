// check:studio and every rendered check use one origin: $STUDIO_ORIGIN, else the single preview port 4503.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { STUDIO_DEFAULT_ORIGIN, studioOrigin, studioPort } from '../studio/checks/studio-origin.mjs';
import { STUDIO_PORT } from './check-studio.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repository = resolve(here, '../../..');

test('the default Studio origin is the single preview port 4503', () => {
  assert.equal(STUDIO_DEFAULT_ORIGIN, 'http://127.0.0.1:4503');
  assert.equal(studioOrigin({}), 'http://127.0.0.1:4503');
  assert.equal(studioOrigin({ STUDIO_ORIGIN: '' }), 'http://127.0.0.1:4503');
  assert.equal(studioPort({}), 4503);
  assert.equal(STUDIO_PORT, 4503, 'check:studio self-starts its Studio on the single preview port');
});

test('$STUDIO_ORIGIN wins and is reduced to its origin', () => {
  assert.equal(studioOrigin({ STUDIO_ORIGIN: 'http://localhost:4999/content?x=1' }), 'http://localhost:4999');
  assert.equal(studioPort({ STUDIO_ORIGIN: 'http://localhost:4999' }), 4999);
});

test('no Studio check, runner or root script carries a retired port of its own', () => {
  const roots = ['packages/producer/scripts', 'packages/producer/studio/checks', 'scripts'];
  const offenders = [];
  const walk = directory => {
    for (const name of readdirSync(directory)) {
      const path = join(directory, name);
      if (statSync(path).isDirectory()) { if (name !== 'node_modules' && name !== 'fixtures') walk(path); continue; }
      if (!/\.(?:mjs|cjs|js|json)$/.test(name) || name === 'check-studio-origin.test.mjs') continue;
      readFileSync(path, 'utf8').split('\n').forEach((line, index) => {
        if (/\b(?:4617|4380|4619)\b/.test(line) && !/[0-9a-f]{16}/.test(line)) offenders.push(`${path.slice(repository.length + 1)}:${index + 1}`);
      });
    }
  };
  for (const root of roots) walk(join(repository, root));
  assert.deepEqual(offenders, []);
});
