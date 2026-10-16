import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { CAPABILITY_FIELDS, ITEMS, SDK_VERSION } from './items.mjs';

const root = new URL('./', import.meta.url);
const read = path => JSON.parse(readFileSync(new URL(path, root), 'utf8'));
const results = read(`results/${SDK_VERSION}.json`);
const manifest = read('package.json');
const lock = read('package-lock.json');
const source = readFileSync(new URL('evidence.spec.mjs', root), 'utf8');
const artifacts = ['dist/module.mjs', 'dist/posthog-recorder.js', 'dist/lazy-recorder.js'];
const actualHashes = Object.fromEntries(artifacts.map(path => [path,
  createHash('sha256').update(readFileSync(new URL(`node_modules/posthog-js/${path}`, root))).digest('hex')]));

function validate(candidate, testSource = source) {
  for (const [name, version] of Object.entries(manifest.devDependencies)) {
    assert.match(version, /^\d+\.\d+\.\d+$/, `${name}: exact pin required`);
    assert.equal(lock.packages[`node_modules/${name}`].version, version);
  }
  assert.equal(manifest.devDependencies['posthog-js'], SDK_VERSION);
  assert.equal(candidate.sdkVersion, SDK_VERSION);
  assert.match(candidate.browser, /^Chromium \d/);
  assert.equal(candidate.realBrowser, true);
  assert.equal(candidate.browserFixture.automationControlledDisabled, true);
  assert.deepEqual(candidate.sdkArtifacts, actualHashes);
  assert.equal(candidate.network.allPageRequestsIntercepted, true);
  assert.equal(candidate.network.externalRequestsForwarded, 0);
  assert.match(candidate.adapterBase, /^[a-f0-9]{40}$/);
  assert.deepEqual(candidate.items.map(item => item.id), Object.keys(ITEMS));
  for (const item of candidate.items) {
    assert.equal(item.question, ITEMS[item.id]);
    if (item.id === 'resetCancelsPendingRequests') assert.equal(typeof item.answer, 'boolean');
    else {
      assert.equal(typeof item.answer, 'string');
      assert.ok(item.answer.trim().length > 20, `${item.id}: missing observed answer`);
      assert.doesNotMatch(item.answer, /^\s*(?:unanswered|unknown|tbd|todo|not tested)\b/i);
    }
    assert.ok(item.observations && Object.keys(item.observations).length, `${item.id}: missing measurements`);
    assert.equal(item.test, `evidence.spec.mjs :: ${item.id}`);
    assert.ok(testSource.includes(`test('${item.id}'`), `${item.id}: missing measuring test`);
    assert.ok(Array.isArray(item.limits), `${item.id}: missing limits`);
  }
  assert.deepEqual(Object.keys(candidate.replayCapability), CAPABILITY_FIELDS);
  const cancellation = candidate.items.find(item => item.id === 'resetCancelsPendingRequests');
  assert.equal(candidate.resetCancelsPendingRequests.answer, cancellation.answer);
  assert.equal(cancellation.answer, cancellation.observations.answer);
  assert.deepEqual(candidate.resetCancelsPendingRequests.observedSequence, cancellation.observations.observedSequence);
  assert.ok(cancellation.observations.observedSequence.length >= 5, 'missing reset cancellation sequence');
  assert.equal(typeof cancellation.observations.transportCancellationObserved, 'boolean');
  assert.ok(cancellation.observations.reason?.length > 20, 'missing reset cancellation reason');
  assert.deepEqual(candidate.replayCapability, candidate.items.find(item => item.id === 'E17').observations.capabilities);
  for (const [field, evidence] of Object.entries(candidate.replayCapability)) {
    assert.equal(typeof evidence.value, 'boolean', field);
    assert.ok(evidence.reason?.trim().length > 10, `${field}: missing reason`);
    assert.ok(evidence.items?.length > 0 && evidence.items.every(id => ITEMS[id]), `${field}: missing evidence items`);
  }
}

validate(results);
if (process.argv.includes('--self-test')) {
  const missingAnswer = structuredClone(results); missingAnswer.items[0].answer = '';
  assert.throws(() => validate(missingAnswer), /missing observed answer/);
  const placeholder = structuredClone(results); placeholder.items[0].answer = 'Unanswered: there is no recorded observation yet.';
  assert.throws(() => validate(placeholder));
  assert.throws(() => validate(results, source.replace("test('E1'", "test.skip('E1'")), /missing measuring test/);
  const incomplete = structuredClone(results); incomplete.items.pop();
  assert.throws(() => validate(incomplete));
  const changedCapability = structuredClone(results); changedCapability.replayCapability.masksAllText.value = !changedCapability.replayCapability.masksAllText.value;
  assert.throws(() => validate(changedCapability));
  const missingCancellation = structuredClone(results); delete missingCancellation.resetCancelsPendingRequests;
  assert.throws(() => validate(missingCancellation));
  const missingSequence = structuredClone(results); missingSequence.items.find(item => item.id === 'resetCancelsPendingRequests').observations.observedSequence = [];
  assert.throws(() => validate(missingSequence));
  console.log('Results guard mutation proof: missing answer, placeholder, test, item, cancellation result/sequence and changed capability refused.');
}
console.log(`SDK ${SDK_VERSION}: all ${Object.keys(ITEMS).length} items answered with measuring tests; replay capabilities bounded by observations.`);
