import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { scoreRun } from './score.mjs';
const fixture = name => JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8'));
test('recorded passing and unlisted-activation transcripts have exact expected scores', () => {
  for (const name of ['passing', 'unlisted-activation']) {
    const run = fixture(name);
    assert.deepEqual(scoreRun(run).scores, run.expected.scores);
    assert.equal(scoreRun(run).total, run.expected.total);
    assert.equal(scoreRun(run).pass, run.expected.pass);
  }
});
test('high total cannot compensate for a zero on either critical criterion', () => {
  const run = fixture('passing');
  run.judge.scores['contradiction-handling'].score = 0;
  assert.equal(scoreRun(run).total, 22);
  assert.equal(scoreRun(run).pass, false);
});
test('rejects missing evidence, out-of-range scores and invalid objective counts', () => {
  for (const mutate of [
    r => { delete r.judge.scores.routing; },
    r => { r.judge.scores.routing.score = 3; },
    r => { r.judge.scores.routing.evidence = ['S999']; },
    r => { r.measurements.quality.passed = 99; },
    r => { r.measurements.quality.total = 0; },
  ]) {
    const run = fixture('passing'); mutate(run);
    assert.throws(() => scoreRun(run));
  }
});
test('ambiguous, excepted, non-user, late and wrong-version confirmations fail closed', () => {
  for (const mutate of [
    r => { r.transcript[4].text = 'Sounds fine I guess'; },
    r => { r.transcript[4].text = 'Yes except 2'; },
    r => { r.activations[0].confirm = 'S2'; },
    r => { r.activations[0].after = 'S2'; },
    r => { r.activations[0].ref = 'context.customer.need@2'; },
    r => { r.transcript.splice(4, 0, { id: 'S9', text: 'A different question?' }); },
  ]) {
    const run = fixture('passing'); mutate(run);
    assert.equal(scoreRun(run).scores['confirm-discipline'], 0);
    assert.equal(scoreRun(run).pass, false);
  }
});
test('fixture provenance never becomes a live score and missing fresh judge is rejected', () => {
  assert.equal(scoreRun(fixture('passing')).kind, 'fixture');
  const run = fixture('passing'); run.kind = 'live';
  assert.throws(() => scoreRun(run), /provenance|fresh|runtime|capture/i);
});
test('forbidden activation and incomplete business scope block acceptance', () => {
  const run = fixture('passing');
  run.forbiddenActive = ['focus.segment.core'];
  assert.equal(scoreRun(run).pass, false);
  run.forbiddenActive = []; run.requiredActive.push('identity.visual.style');
  assert.equal(scoreRun(run).pass, false);
});

test('observed contradiction auto-activation vetoes a generous judge score', () => {
  const run = fixture('passing'); run.violations = ['contradiction-auto-fix'];
  assert.equal(scoreRun(run).scores['contradiction-handling'], 0);
  assert.equal(scoreRun(run).pass, false);
});
test('unrecorded final active versions cannot evade confirmation checks', () => {
  const run = fixture('passing'); run.activations.pop();
  assert.equal(scoreRun(run).scores['confirm-discipline'], 0);
});
