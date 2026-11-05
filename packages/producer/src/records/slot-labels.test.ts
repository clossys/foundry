import { appendFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { iaLabel, pinnedNames, slotLabel, slotLabels } from './slot-labels.js';
import { writeFixtureNames } from '../server/__fixtures__/writer-names.js';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function consumer() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'slot-labels-'))); roots.push(root);
  mkdirSync(join(root, 'clossys/agents/director'), { recursive: true });
  writeFileSync(join(root, 'clossys/agents/director/ia.json'), JSON.stringify({ schema: 'clossys.ia/1', source: 'synthetic-test-only#labels', extensions: [],
    nodes: [{ id: 'context', label: 'Context', children: [{ id: 'market', label: 'Market', slots: ['context.market.size'] }] }] }));
  return root;
}

describe('slot labels', () => {
  it('reads every label from the pinned Writer names', () => {
    const root = consumer();
    writeFixtureNames(root);
    const clossys = join(root, 'clossys');
    expect(slotLabel(clossys, 'director', 'context.market.size')).toBe('context.market.size');
    expect(slotLabels(clossys)('director', 'context.market.size')).toBe('context.market.size');
    expect(iaLabel(clossys, 'director', 'market')).toBe('Market');
    expect(pinnedNames(clossys).get('director.ia.context')).toBe('Context');
  });

  it('has no fallback: an id the Writer has not named throws', () => {
    const root = consumer();
    writeFixtureNames(root);
    expect(() => slotLabel(join(root, 'clossys'), 'director', 'context.market.unnamed')).toThrow(/No Writer name for director\.item\.context\.market\.unnamed/);
    expect(() => iaLabel(join(root, 'clossys'), 'director', 'unnamed')).toThrow(/No Writer name for director\.ia\.unnamed/);
  });

  it('reads no names without a pin, or from a candidate that drifted from its pin', () => {
    const root = consumer();
    const clossys = join(root, 'clossys');
    expect(() => iaLabel(clossys, 'director', 'market')).toThrow(/No Writer name/);
    const drifted = consumer();
    writeFixtureNames(drifted);
    appendFileSync(join(drifted, 'clossys/agents/writer/strings.names/candidates/names-v1.md'), '\n');
    expect(pinnedNames(join(drifted, 'clossys')).size).toBe(0);
    expect(() => iaLabel(join(drifted, 'clossys'), 'director', 'market')).toThrow(/No Writer name/);
  });
});
