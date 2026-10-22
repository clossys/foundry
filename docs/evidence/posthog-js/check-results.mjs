import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

const root = new URL('./', import.meta.url);
const read = name => readFileSync(new URL(name, root));
const originalBytes = read('1.438.12.json');
const original = JSON.parse(originalBytes);
const result = JSON.parse(read('flags-followup-1.438.12.json'));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const sha = /^[a-f0-9]{64}$/;
const files = ['README.md', 'answers.mjs', 'api-types.mjs', 'browser.mjs',
  'check-results.mjs', 'evidence.spec.mjs', 'fixture.mjs', 'items.mjs',
  'package-lock.json', 'package.json', 'playwright.config.mjs', 'preloaded.mjs',
  'results/1.438.12.json', 'run-tests.mjs'].sort();
const bodyKeys = value => {
  const keys = [];
  const visit = (node, prefix = '') => {
    if (!node || typeof node !== 'object') return;
    for (const [key, child] of Object.entries(node)) {
      const path = prefix ? `${prefix}.${key}` : key;
      keys.push(path); visit(child, path);
    }
  };
  visit(value); return keys;
};
const oldVariantIn = value => JSON.stringify(value).includes('warm-response');

function validate(data) {
  assert.equal(data.schemaVersion, 1);
  assert.equal(data.sdkVersion, '1.438.12');
  assert.match(data.browser, /^Chromium \d+\.\d+\.\d+\.\d+$/);
  assert.equal(data.realBrowser, true);
  assert.ok(Number.isFinite(Date.parse(data.measured_at)));
  assert.equal(data.reference.path, '1.438.12.json');
  assert.equal(data.reference.sha256, digest(originalBytes));
  assert.equal(data.harness.identity, 'commit-less session harness');
  assert.deepEqual(data.harness.suite, { command: 'npm test < /dev/null', exitCode: 0, measuringTests: 21 });
  assert.deepEqual(data.harness.files.map(row => row.name).sort(), files);
  for (const file of data.harness.files) assert.match(file.sha256, sha);
  assert.deepEqual(data.network, { externalRequestsForwarded: 0, allPageRequestsIntercepted: true });

  const reruns = data.reproduction;
  assert.deepEqual(reruns.map(row => row.id), original.items.map(row => row.id));
  for (const row of reruns) {
    const reference = original.items.find(item => item.id === row.id);
    assert.deepEqual(row.originalAnswer, reference.answer);
    assert.equal(row.test, `evidence.spec.mjs :: ${row.id}`);
    assert.deepEqual(row.actualAnswer, row.actualItem.answer);
    assert.equal(row.actualItem.id, row.id);
    assert.equal(row.exactAnswerReproduced, isDeepStrictEqual(row.actualAnswer, reference.answer));
    assert.equal(row.status, row.exactAnswerReproduced ? 'match' : 'mismatch');
    assert.ok(row.actualItem.observations && Object.keys(row.actualItem.observations).length);
    if (!row.exactAnswerReproduced) assert.ok(data.findings.some(finding => finding.item === row.id));
  }
  assert.deepEqual(data.items.map(item => item.id), ['E18', 'E19', 'E20']);
  const measuredItems = new Map([...reruns.map(row => row.actualItem), ...data.items].map(row => [row.id, row]));
  assert.equal(measuredItems.size, 21);
  assert.deepEqual(data.sessionResultMetadata.sdkArtifacts, original.sdkArtifacts);
  assert.equal(data.sessionResultMetadata.browser, data.browser);
  assert.equal(data.sessionResultMetadata.realBrowser, true);
  assert.equal(data.sessionResultItemOrder.length, measuredItems.size);
  const reconstructed = Object.fromEntries(data.sessionResultKeys.map(key => [key, key === 'items'
    ? data.sessionResultItemOrder.map(id => { assert.ok(measuredItems.has(id)); return measuredItems.get(id); })
    : data.sessionResultMetadata[key]]));
  assert.equal(digest(`${JSON.stringify(reconstructed, null, 2)}\n`), data.harness.files.find(row => row.name === 'results/1.438.12.json').sha256);
  for (const item of data.items) {
    assert.ok(item.question.length > 30);
    assert.ok(item.answer.length > 30);
    assert.equal(item.test, `evidence.spec.mjs :: ${item.id}`);
    assert.ok(item.method.length > 30);
    assert.ok(Array.isArray(item.limits) && item.limits.length);
  }

  const e18 = data.items[0].observations;
  assert.equal(e18.answer, false);
  assert.equal(e18.inventory.length, 190);
  for (const candidate of e18.inventory) {
    assert.ok(candidate.name && candidate.surface && candidate.matchedTerms.length);
    assert.ok(candidate.origins.length);
    for (const origin of candidate.origins) {
      assert.ok(origin.packageRole && origin.path);
      assert.ok(Number.isInteger(origin.line) && origin.line > 0);
    }
  }
  assert.equal(e18.trials.length, 107);
  const topLevelOptions = e18.inventory.filter(candidate => candidate.surface === 'config' && !candidate.name.includes('.'));
  assert.equal(topLevelOptions.length, 50);
  for (const option of topLevelOptions) {
    for (const via of ['init', 'set_config']) {
      assert.ok(e18.trials.some(trial => trial.via === via && Object.hasOwn(trial.candidate.options, option.name)), `${option.name}: missing ${via} trial`);
    }
  }
  assert.ok(e18.positiveControl.requests.some(row => 'person_properties' in row.body && 'groups' in row.body));
  for (const trial of e18.trials) {
    assert.equal(trial.applied.mode, trial.via);
    assert.equal(trial.applied.member, trial.via === 'init' ? 'init' : 'set_config');
    assert.equal(trial.applied.baseHookIdentity, true);
    assert.ok(trial.applied.baseConfigurationKeys.includes('before_send'));
    for (const request of trial.requests) {
      assert.equal(request.decoded, Boolean(request.body && !request.body.undecoded && typeof request.body.token === 'string' && typeof request.body.distinct_id === 'string'));
      assert.deepEqual(request.keys, Object.keys(request.body ?? {}));
      assert.deepEqual(request.allKeys, bodyKeys(request.body));
    }
    const enabled = trial.requests.filter(row => row.responseFulfilled && row.body?.disable_flags !== true);
    const qualifies = enabled.length > 0 && enabled.every(row => row.decoded && !('person_properties' in row.body)
      && !('groups' in row.body) && !row.allKeys.some(key => /url|path|host|referr/i.test(key)))
      && trial.sdkValue === 'variant';
    assert.equal(trial.qualifies, qualifies);
  }
  assert.equal(e18.trials.some(trial => trial.qualifies), e18.answer);

  const e19 = data.items[1].observations;
  assert.equal(e19.answer, true);
  assert.deepEqual(e19.inventory, e18.inventory);
  assert.equal(e19.trials.length, 17);
  assert.equal(e19.positiveControl.candidate.call, 'featureFlags.reset()');
  assert.equal(e19.positiveControl.after.value, 'warm-response');
  for (const trial of e19.trials) {
    assert.equal(trial.before.value, 'warm-response');
    for (const snapshot of [trial.before, trial.after]) {
      assert.match(snapshot.sessionSha256, sha); assert.match(snapshot.distinctSha256, sha);
    }
    const sameIdentity = trial.before.sessionSha256 === trial.after.sessionSha256
      && trial.before.distinctSha256 === trial.after.distinctSha256;
    assert.equal(trial.sameIdentity, sameIdentity);
    const oldCallback = trial.after.callbacks.some(row => oldVariantIn(row.variants));
    const oldOtherRead = oldVariantIn([trial.after.details, trial.after.allFlags, trial.after.flagsWithDetails, trial.after.flagDetails, trial.after.variants, trial.after.payloads]);
    assert.equal(trial.oldVariantInNewCallback, oldCallback);
    assert.equal(trial.oldVariantInOtherReads, oldOtherRead);
    assert.equal(trial.qualifies, trial.invocation.available && !trial.invocation.error
      && trial.after.value === null && !oldCallback && !oldOtherRead && sameIdentity);
  }
  const successful = e19.trials.filter(trial => trial.qualifies);
  assert.ok(successful.length > 0);
  assert.deepEqual(successful.map(trial => trial.candidate.call), data.successfulCacheDropCalls);
  assert.deepEqual(data.successfulCacheDropCalls, ['updateFlags({}, {}, {merge:false})',
    'featureFlags.updateFlags({}, {}, {merge:false})',
    'featureFlags.receivedFeatureFlags({featureFlags:{}, featureFlagPayloads:{}, flags:{}})']);

  const e20 = data.items[2].observations;
  assert.equal(e20.answer, true);
  assert.equal(e20.coverageComplete, true);
  assert.equal(e20.successfulE18Count, 0);
  assert.equal(e20.successfulE19Count, successful.length);
  assert.deepEqual(e20.trials.map(trial => trial.candidate), successful.map(trial => trial.candidate));
  for (const { local, matchedE5, lazy, pendingControl, pendingWithReset, comparison } of e20.trials) {
    for (const invocation of [local.emptyInvocation, local.invocation, matchedE5.invocation, lazy.invocation, pendingControl.invocation, pendingWithReset.invocation]) {
      assert.equal(invocation.available, true); assert.equal(invocation.error, undefined);
    }
    assert.equal(local.initiallyDisabledRequestCount, 0);
    assert.equal(local.disabledRequestCount, 0);
    assert.equal(local.flagsRequestsWhileDisabled, 0);
    assert.equal(local.sameSession, true); assert.equal(local.sameDistinct, true);
    assert.equal(local.beforeIdentity.sessionSha256, local.afterIdentity.sessionSha256);
    assert.equal(local.beforeIdentity.distinctSha256, local.afterIdentity.distinctSha256);
    assert.equal(local.afterIdentity.value, null);
    assert.equal(local.consentKeyRetained, '1');
    assert.deepEqual(local.beforeStorage.localStorage, local.afterStorage.localStorage);
    assert.equal(local.flagsRequestsDuringLifecycle, 0);
    const consent = phase => local.e5Phases.find(row => row.phase === phase).localStorage['__ph_opt_in_out_evidence-only-project'] ?? null;
    assert.equal(consent('SDK opt-out'), '0');
    assert.equal(consent('SDK reset'), null);
    assert.equal(consent('adapter re-grant'), '1');
    assert.equal(consent('adapter withdrawal'), '0');
    assert.equal(data.storageScopeComparison.originalE5WithdrawalConsentValue, null);
    assert.equal(data.storageScopeComparison.flagsOnlyWithdrawalConsentValue, consent('adapter withdrawal'));
    assert.equal(data.storageScopeComparison.candidateCausationEstablished, false);
    const storeKeys = [...new Set(local.e5Phases.flatMap(phase => phase.operations.map(operation => `${operation.store}:${operation.key ?? '(all)'}`)))].sort();
    assert.deepEqual(local.e5Keys, storeKeys);
    assert.deepEqual(local.newStoreKeys, storeKeys.filter(key => !original.items.find(row => row.id === 'E5').observations.observedKeys.includes(key)));
    assert.deepEqual(local.newStoreKeys, []);
    assert.deepEqual(local.e12, original.items.find(row => row.id === 'E12').observations);
    assert.equal(data.storageScopeComparison.matchedE5ControlObserved, true);
    assert.deepEqual(matchedE5.configuration, { autocapture: true, replay: true });
    assert.equal(matchedE5.candidateRetainedStorageUnchanged, true);
    assert.equal(matchedE5.allReferenceStoragePhasesMatch, true);
    const stores = row => ({ cookies: row.cookies, localStorage: row.localStorage, sessionStorage: row.sessionStorage, indexedDB: row.indexedDB });
    assert.deepEqual(stores(matchedE5.beforeCandidate), stores(matchedE5.afterCandidate));
    const referencePhases = original.items.find(row => row.id === 'E5').observations.phases;
    assert.deepEqual(matchedE5.comparisons.map(row => row.phase), referencePhases.map(row => row.phase));
    for (const phase of matchedE5.comparisons) {
      assert.deepEqual(phase.reference, stores(referencePhases.find(row => row.phase === phase.phase)));
      assert.deepEqual(phase.actual, stores(matchedE5.phases.find(row => row.phase === phase.phase)));
      assert.equal(phase.matches, isDeepStrictEqual(phase.reference, phase.actual));
      assert.equal(phase.matches, true);
    }
    assert.deepEqual(matchedE5.newStoreKeys, []);
    assert.equal(lazy.before.loaderCalls, 0); assert.deepEqual(lazy.before.requests, []);
    assert.equal(lazy.afterGrantLoaderCalls, 1);
    for (const pending of [pendingControl, pendingWithReset]) {
      assert.equal(pending.oldResponseCompleted, true);
      assert.equal(pending.oldTransportFailure, null);
      assert.equal(pending.freshDelivered, true);
      assert.equal(pending.sameSession, true); assert.equal(pending.sameDistinct, true);
      assert.equal(pending.staleDelivered, pending.beforeFresh.callbacks.some(row => row.variants?.evidence_flag === 'old-response'));
      assert.equal(pending.freshDelivered, pending.callbacks.some(row => row.variants?.evidence_flag === 'fresh-response'));
      assert.equal(pending.pendingResponseIsolation, !pending.staleDelivered && pending.beforeFresh.cached === null && pending.freshDelivered);
    }
    assert.equal(pendingControl.resetFlags, false);
    assert.equal(pendingControl.staleDelivered, true);
    assert.equal(pendingControl.beforeFresh.cached, 'old-response');
    assert.equal(pendingControl.pendingResponseIsolation, false);
    assert.equal(pendingWithReset.resetFlags, true);
    assert.equal(pendingWithReset.pendingResponseIsolation, true);
    assert.equal(comparison.resetCancelsPendingRequests, pendingWithReset.pendingResponseIsolation);
    assert.equal(comparison.candidateAloneCancelsPendingRequests, pendingControl.pendingResponseIsolation);
  }
}

validate(result);
if (process.argv.includes('--self-test')) {
  const reject = change => { const copy = structuredClone(result); change(copy); assert.throws(() => validate(copy)); };
  reject(copy => { copy.items[0].observations.answer = true; });
  reject(copy => { copy.items[1].observations.trials[0].before.value = null; });
  reject(copy => { copy.items[2].observations.trials.pop(); });
  reject(copy => { copy.reproduction.pop(); });
  reject(copy => { copy.harness.files[0].sha256 = 'missing'; });
  console.log('Mutation checks reject altered answers, controls, coverage, reproduction and harness identity.');
}
console.log(`SDK ${result.sdkVersion}: E18–E20 validated; ${result.reproduction.filter(row => row.exactAnswerReproduced).length}/${result.reproduction.length} original answers reproduced; ${result.findings.length} findings recorded.`);
