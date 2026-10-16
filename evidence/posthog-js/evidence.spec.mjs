import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { CAPABILITY_FIELDS, ITEMS } from './items.mjs';
import { events, openFixture } from './fixture.mjs';
import { optionDeclarations } from './api-types.mjs';
import { observedAnswer } from './answers.mjs';

const cache = 'node_modules/.cache/browser-evidence/observations';
const wait = page => page.waitForTimeout(350);
const flagsRequests = fixture => fixture.requests.filter(row => /\/flags\/?$/.test(new URL(row.url).pathname));
const normalized = value => JSON.parse(JSON.stringify(value, (key, entry) => {
  if (['$time', 'timestamp', 'sent_at'].includes(key)) return '[runtime-time]';
  if (['uuid', 'distinct_id', '$device_id', '$anon_distinct_id', '$insert_id', '$session_id', '$window_id'].includes(key) && entry) return '[generated-id]';
  if (typeof entry === 'string') return entry.replace(/127\.0\.0\.1:\d+/g, '127.0.0.1:PORT')
    .replace(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/g, '[generated-id]');
  return entry;
}));
function result(id, browser, answer, observations, limits = []) {
  expect(Object.keys(observations).length).toBeGreaterThan(0);
  writeFileSync(`${cache}/${id}.json`, JSON.stringify(normalized({
    id, question: ITEMS[id], answer: observedAnswer(id, observations), method: answer, observations, limits,
    test: `evidence.spec.mjs :: ${id}`, browser: `Chromium ${browser.version()}`,
  }), null, 2));
}
const previous = id => JSON.parse(readFileSync(`${cache}/${id}.json`, 'utf8')).observations;
async function withFixture(browser, options, run) {
  const fixture = await openFixture(browser, options);
  try { return await run(fixture); }
  finally { await fixture.close(); }
}
async function initialize(fixture, options = {}, grant = true) {
  const info = await fixture.page.evaluate(options => window.evidence.create(options), options);
  await wait(fixture.page);
  if (grant) { await fixture.page.evaluate(() => window.evidence.port.optIn()); await wait(fixture.page); }
  return info;
}
async function flush(fixture) {
  // Diagnostic access to the real pinned SDK queue, not an adapter setting.
  await fixture.page.evaluate(() => window.evidence.queue().unload());
  await wait(fixture.page);
}
async function startRecorder(fixture) {
  await initialize(fixture, { replay: true });
  // The actual adapter's probe remains false. This explicit diagnostic starts
  // its real SDK instance so an unproven probe never becomes an attestation.
  await fixture.page.evaluate(() => window.evidence.instance.startSessionRecording());
  await fixture.page.waitForFunction(() => window.evidence.instance.sessionRecordingStarted(), null, { timeout: 8_000 });
  await fixture.page.waitForFunction(() => window.evidence.state.records.some(record => record.type === 2), null, { timeout: 8_000 });
  await fixture.page.click('#public');
  await wait(fixture.page);
}
async function recorderData(fixture) {
  return fixture.page.evaluate(() => {
    const { records, hooks, recorderOptions } = window.evidence.state;
    const nodes = [], textLocations = [], scripts = [], stack = [];
    for (const record of records) {
      if (record.type === 2) stack.push({ node: record.data.node, parent: '', path: 'full.data.node' });
      if (record.type === 3 && record.data.source === 0) {
        for (const add of record.data.adds ?? []) stack.push({ node: add.node, parent: '', path: 'mutation.data.adds[].node' });
        for (const change of record.data.texts ?? []) textLocations.push({ path: 'mutation.data.texts[].value', text: change.value, masked: /^[\s*]*$/.test(change.value ?? '') });
        for (const change of record.data.attributes ?? []) if (typeof change.attributes?.value === 'string') textLocations.push({ path: 'mutation.data.attributes[].attributes.value', text: change.attributes.value, masked: /^[\s*]*$/.test(change.attributes.value) });
      }
      if (record.type === 3 && record.data.source === 5) textLocations.push({ path: 'input.data.text', text: record.data.text, masked: /^[\s*]*$/.test(record.data.text ?? '') });
    }
    while (stack.length) {
      const { node, parent, path } = stack.pop();
      if (!node || typeof node !== 'object') continue;
      nodes.push({ type: node.type, tag: node.tagName ?? null, attributes: node.attributes ?? null, children: node.childNodes?.length ?? 0 });
      if (typeof node.textContent === 'string') {
        const row = { path: `${path}.textContent`, parent, text: node.textContent, isStyle: node.isStyle === true,
          masked: /^[\s*]*$/.test(node.textContent) };
        textLocations.push(row);
        if (parent === 'script') scripts.push(node.textContent);
      }
      if (typeof node.attributes?.value === 'string') textLocations.push({ path: `${path}.attributes.value`, text: node.attributes.value, masked: /^[\s*]*$/.test(node.attributes.value) });
      for (const child of node.childNodes ?? []) stack.push({ node: child, parent: node.tagName ?? parent, path: `${path}.childNodes[]` });
    }
    return { records, hooks, recorderOptions, nodes, textLocations, scripts };
  });
}

test('E1', async ({ browser }) => {
  const publicTypes = optionDeclarations();
  expect(publicTypes.diagnostics).toEqual([]);
  expect(publicTypes.unknownOptionControl).toBe(false);
  const combinations = [];
  for (const options of [{}, { autocapture: true }, { replay: true }, { autocapture: true, replay: true }]) {
    await withFixture(browser, {}, async fixture => {
      const initialization = await initialize(fixture, options, false);
      const before = await fixture.page.evaluate(() => ({ config: window.evidence.configuration(),
        optedOut: window.evidence.instance.has_opted_out_capturing() }));
      await fixture.page.evaluate(() => window.evidence.capture());
      await fixture.page.click('#public');
      await wait(fixture.page);
      const preGrantHooks = await fixture.page.evaluate(() => window.evidence.state.hooks.length);
      await fixture.page.evaluate(() => window.evidence.port.optIn());
      await fixture.page.click('#public');
      await fixture.page.click('#private');
      await fixture.page.click('#banner');
      await fixture.page.click('#unlisted');
      await fixture.page.fill('#input', 'INPUT_EVENT_SENTINEL');
      await fixture.page.evaluate(() => document.querySelector('#form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
      await fixture.page.click('#public', { clickCount: 3 });
      await fixture.page.evaluate(() => {
        document.querySelector('#public').dispatchEvent(new ClipboardEvent('copy', { bubbles: true }));
        window.dispatchEvent(new ErrorEvent('error', { message: 'EXCEPTION_EVENT_SENTINEL' }));
        performance.mark('evidence-start'); performance.mark('evidence-end');
        performance.measure('evidence-performance', 'evidence-start', 'evidence-end');
      });
      await wait(fixture.page);
      await flush(fixture);
      await fixture.page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
      const observed = await fixture.page.evaluate(() => ({ config: window.evidence.configuration(),
        hookNames: window.evidence.state.hooks.map(row => row.input.event),
        autocapture: window.evidence.state.hooks.filter(row => row.input.event === '$autocapture')
          .map(row => ({ input: row.input.properties, output: row.output?.properties ?? null })),
        recordingStarted: window.evidence.instance.sessionRecordingStarted(),
        namedHookIdentity: window.evidence.state.initializations[0].hookIdentity,
      }));
      expect(initialization.hookIdentity).toBe(true);
      combinations.push({ options, before, preGrantHooks, ...observed, wireEvents: events(fixture.requests).map(row => row.event),
        sdkRequestPaths: fixture.sdkRequests().map(row => new URL(row.url).pathname) });
    });
  }
  const withAutocapture = combinations.filter(row => row.options.autocapture);
  const established = {
    'config.autocapture': withAutocapture.every(row => row.autocapture.some(event => event.output)) &&
      combinations.filter(row => !row.options.autocapture).every(row => row.autocapture.length === 0),
    'config.before_send': combinations.every(row => row.namedHookIdentity),
    'config.opt_out_capturing_by_default': combinations.every(row => row.before.optedOut),
    'autocapture.dom_event_allowlist': withAutocapture.every(row => row.autocapture.every(event => ['click', 'submit'].includes(event.input.$event_type))),
    'autocapture.css_selector_allowlist': withAutocapture.every(row => row.autocapture.some(event => event.input.$elements_chain?.includes('public.action')) &&
      row.autocapture.every(event => !/private.action|banner.action/.test(event.input.$elements_chain ?? ''))),
  };
  const optionEvidence = Object.fromEntries(Object.entries(publicTypes.declarations).flatMap(([group, fields]) =>
    Object.entries(fields).map(([name, declared]) => {
      const key = `${group}.${name}`;
      return [key, { declared, behaviorProven: established[key] === true,
        reason: established[key] === true ? 'Established by the controlled init, grant and DOM-event measurements in E1.' :
          declared ? 'Declaration and init retention are measured here; this option’s individual causal behavior remains unproven. Related feature behavior is measured in E3–E16.' :
            'Absent from the pinned public option declaration; retaining an unknown config key does not establish behavior.' }];
    })));
  result('E1', browser, 'The real SDK retains the adapter’s forced configuration in each of the four combinations. Public declarations separately identify recognized option names; controlled clicks, submit, input, pre-grant capture and replay-start state measure behavior. Retention alone is not proof of every option.', { combinations, publicTypes, optionEvidence },
    ['Absence in a bounded fixture does not establish suppression for every SDK extension or arbitrary host stimulus. Per-feature measurements below further bound these options.']);
});

test('E2', async ({ browser }) => {
  await withFixture(browser, {}, async fixture => {
    const observed = await fixture.page.evaluate(() => {
      const h = window.evidence;
      const safe = { api_host: location.origin, autocapture: false, capture_pageview: false, capture_pageleave: false,
        disable_session_recording: true, disable_surveys: true, disable_web_experiments: true,
        advanced_disable_feature_flags: true, advanced_disable_feature_flags_on_first_load: true,
        persistence: 'memory', opt_out_capturing_by_default: true };
      const defaultHook = () => null;
      const defaultInstance = h.sdk.init(h.project, { ...safe, before_send: defaultHook });
      const info = h.create(); const named = h.instance;
      const originalNamedHook = named.config.before_send;
      const replacementHook = () => null;
      const reused = h.sdk.init(h.project, { ...safe, before_send: replacementHook }, info.name);
      let adapterRejectsReusedInstance = false;
      const collision = h.adapter.createPostHogProvider({
        init(key, config) { return h.sdk.init(key, config, info.name); },
      }, { key: h.project, apiHost: location.origin });
      try { collision.init({ eventNames: ['$pageview'], sanitizeUrl: h.sanitizeUrl }); }
      catch (error) { adapterRejectsReusedInstance = /did not configure/.test(error.message); }
      return { defaultReturnsSingleton: defaultInstance === h.sdk, namedDiffersFromDefault: named !== defaultInstance,
        namedHookIdentity: info.hookIdentity, reusedReturnsSame: reused === named,
        reusedRetainsOriginalHook: reused.config.before_send === originalNamedHook,
        reusedAcceptsReplacementHook: reused.config.before_send === replacementHook,
        defaultHookUnchanged: defaultInstance.config.before_send === defaultHook, adapterRejectsReusedInstance };
    });
    expect(observed.namedDiffersFromDefault).toBe(true);
    expect(observed.namedHookIdentity).toBe(true);
    expect(observed.adapterRejectsReusedInstance).toBe(true);
    result('E2', browser, 'Default initialization, the adapter’s named initialization and reuse of that same name were compared by object and function identity. The observations below state whether reuse ignores the replacement hook.', observed);
  });
});

test('E3', async ({ browser }) => {
  await withFixture(browser, {}, async fixture => {
    await initialize(fixture);
    await fixture.page.evaluate(() => window.evidence.capture());
    await flush(fixture);
    const hook = await fixture.page.evaluate(() => window.evidence.state.hooks.find(row => row.input.event === '$pageview'));
    expect(hook).toBeTruthy();
    const sent = events(fixture.requests).find(row => row.event === '$pageview');
    expect(sent).toBeTruthy();
    const fields = ['$current_url', '$pathname', '$host', '$referrer', '$referring_domain'];
    const pick = object => Object.fromEntries(fields.map(key => [key, object[key] ?? null]));
    const observations = { input: pick(hook.input.properties), hookOutput: pick(hook.output.properties), sent: pick(sent.properties),
      allFiveReceived: fields.every(field => field in hook.input.properties),
      sentMatchesHook: fields.every(field => sent.properties[field] === hook.output.properties[field]) };
    expect(observations.sentMatchesHook).toBe(true);
    result('E3', browser, 'The SDK’s hook input and the decoded request body were compared for all five URL fields. The adapter’s rewritten URL/referrer values reach the local ingestion stub.', observations);
  });
});

test('E4', async ({ browser }) => {
  await withFixture(browser, {}, async fixture => {
    await initialize(fixture);
    await flush(fixture);
    const hooks = await fixture.page.evaluate(() => window.evidence.state.hooks.map(row => ({ event: row.input.event, dropped: row.output === null })));
    result('E4', browser, 'Granting invokes the real opt_in_capturing method. The hook observations identify any opt-in marker and whether the actual adapter drops it; decoded requests establish whether a marker was sent.',
      { hooks, optInMarkerSeen: hooks.some(row => row.event === '$opt_in'), wireEvents: events(fixture.requests).map(row => row.event) });
  });
});

test('E5', async ({ browser }) => {
  await withFixture(browser, {}, async fixture => {
    const phases = [];
    const snapshot = async phase => phases.push({ phase, ...await fixture.page.evaluate(() => window.evidence.storage()) });
    await snapshot('module imported');
    await initialize(fixture, { autocapture: true, replay: true }, false); await snapshot('init');
    await fixture.page.evaluate(() => window.evidence.port.optIn()); await wait(fixture.page); await snapshot('opt-in');
    await fixture.page.evaluate(() => window.evidence.instance.startSessionRecording()); await wait(fixture.page); await snapshot('replay');
    await fixture.page.evaluate(() => { const i = window.evidence.instance; i.set_config({ advanced_disable_feature_flags: false, advanced_disable_feature_flags_on_first_load: false }); i.reloadFeatureFlags(); });
    await wait(fixture.page); await snapshot('flags');
    await fixture.page.evaluate(() => window.evidence.instance.opt_out_capturing()); await snapshot('SDK opt-out before reset');
    await fixture.page.evaluate(() => window.evidence.instance.reset()); await snapshot('SDK reset');
    await fixture.page.evaluate(() => window.evidence.port.optIn()); await snapshot('adapter re-grant');
    await fixture.page.evaluate(() => window.evidence.port.optOut()); await wait(fixture.page); await snapshot('opt-out and adapter reset');
    await fixture.page.evaluate(() => window.evidence.instance.reset()); await snapshot('explicit reset');
    const observedKeys = [...new Set(phases.flatMap(phase => phase.operations.map(op => `${op.store}:${op.key ?? '(all)'}`)))].sort();
    const consent = phases.map(phase => ({ phase: phase.phase, keys: Object.entries(phase.localStorage).filter(([key]) => key.includes('opt') || key.includes('consent')) }));
    result('E5', browser, 'All four browser stores were enumerated at each lifecycle stage; storage writes/removals include transient support-test keys. The real memory-persistence configuration does not by itself establish memory-only consent storage: the consent-key values are listed separately.', { phases, observedKeys, consent },
      ['Only this fresh loopback origin and the tested init/grant/replay/flags/withdrawal/reset paths are covered.']);
  });
});

test('E6', async ({ browser }) => {
  await withFixture(browser, {}, async fixture => {
    await initialize(fixture);
    await fixture.page.evaluate(() => window.evidence.capture('/queued'));
    const queuedBefore = await fixture.page.evaluate(() => window.evidence.queueLength());
    expect(queuedBefore).toBeGreaterThan(0);
    await fixture.page.evaluate(() => window.evidence.port.optOut());
    const queuedAfter = await fixture.page.evaluate(() => window.evidence.queueLength());
    await flush(fixture);
    const deliveredAfterWithdrawal = events(fixture.requests).some(row => row.event === '$pageview');
    result('E6', browser, 'An adapter-accepted pageview was confirmed in the real SDK queue before withdrawal. The queue length after opt-out and an explicit diagnostic flush establish whether that queued event can still be delivered.',
      { queuedBefore, queuedAfter, deliveredAfterWithdrawal, dropsQueuedEvent: queuedAfter === 0 && !deliveredAfterWithdrawal },
      ['The explicit private queue flush tests retained work; it is not an adapter API or an assurance that already-sent requests can be retracted.']);
  });
});

test('E7', async ({ browser }) => {
  await withFixture(browser, {}, async fixture => {
    await startRecorder(fixture);
    const before = await fixture.page.evaluate(() => ({ started: window.evidence.instance.sessionRecordingStarted(),
      configDisable: window.evidence.instance.config.disable_session_recording, rawRecords: window.evidence.state.records.length,
      snapshotsAtHook: window.evidence.state.hooks.filter(row => row.input.event === '$snapshot').length }));
    await fixture.page.evaluate(() => { document.querySelector('#text').textContent = 'BEFORE_STOP_SENTINEL'; });
    await wait(fixture.page);
    await fixture.page.evaluate(() => window.evidence.instance.stopSessionRecording());
    const stopped = await fixture.page.evaluate(() => ({ started: window.evidence.instance.sessionRecordingStarted(),
      configDisable: window.evidence.instance.config.disable_session_recording, rawRecords: window.evidence.state.records.length,
      snapshotsAtHook: window.evidence.state.hooks.filter(row => row.input.event === '$snapshot').length,
      bufferLength: window.evidence.instance.sessionRecording?._lazyLoadedSessionRecording?._buffer?.data?.length ?? null }));
    await fixture.page.evaluate(() => { document.querySelector('#text').textContent = 'AFTER_STOP_SENTINEL'; });
    await fixture.page.waitForTimeout(2300);
    const after = await fixture.page.evaluate(() => ({ rawRecords: window.evidence.state.records.length,
      snapshotsAtHook: window.evidence.state.hooks.filter(row => row.input.event === '$snapshot').length }));
    expect(before.started).toBe(true); expect(stopped.started).toBe(false);
    result('E7', browser, 'The actual instance starts recording after the adapter initialized with recording disabled, and stop changes its real started state. Record/hook counts and buffer length measure stop behavior without claiming that a cleared buffer was discarded rather than flushed.',
      { initialDisableSessionRecording: true, before, stopped, after,
        bufferedSnapshotReachedHookDuringStop: stopped.snapshotsAtHook > before.snapshotsAtHook,
        postStopRecordsAdded: after.rawRecords - stopped.rawRecords },
      ['The adapter probe stays false; direct SDK start/stop are explicitly diagnostic. Snapshot hook output remains governed by the real adapter.']);
  });
});

test('E8', async ({ browser }) => {
  await withFixture(browser, {}, async fixture => {
    await initialize(fixture, { autocapture: true, replay: true });
    await fixture.page.click('#public');
    await fixture.page.evaluate(() => window.evidence.instance.startSessionRecording());
    await fixture.page.waitForFunction(() => window.evidence.instance.sessionRecordingStarted(), null, { timeout: 8000 });
    await fixture.page.click('#public');
    await fixture.page.waitForTimeout(2300);
    await flush(fixture);
    const observed = await fixture.page.evaluate(() => ({
      autocapture: window.evidence.state.hooks.filter(row => row.input.event === '$autocapture').map(row => ({ input: row.input.properties, output: row.output?.properties ?? null })),
      snapshots: window.evidence.state.hooks.filter(row => row.input.event === '$snapshot').map(row => ({ propertyNames: Object.keys(row.input.properties),
        dataIsArray: Array.isArray(row.input.properties.$snapshot_data), droppedByAdapter: row.output === null })),
    }));
    result('E8', browser, 'Real click and recorder emissions were observed at the SDK’s before-send boundary. The local ingestion payload separately shows whether the adapter-rebuilt element chain was accepted for sending; snapshots remain fail-closed under the unproven probe.',
      { ...observed, sentAutocaptureChains: events(fixture.requests).filter(row => row.event === '$autocapture').map(row => row.properties.$elements_chain) });
  });
});

test('E9', async ({ browser }) => {
  await withFixture(browser, {}, async fixture => {
    await startRecorder(fixture);
    await fixture.page.evaluate(async () => {
      const root = document.querySelector('#shadow').attachShadow({ mode: 'open' });
      root.innerHTML = '<p>SHADOW_TEXT_SENTINEL</p><input value="SHADOW_VALUE_SENTINEL">';
      console.log('CONSOLE_RECORD_SENTINEL');
      document.querySelector('#canvas').getContext('2d').fillRect(0, 0, 10, 10);
      await fetch('/network-probe', { method: 'POST', headers: { 'x-evidence': 'NETWORK_HEADER_SENTINEL' }, body: 'NETWORK_BODY_SENTINEL' });
    });
    const navigations = [];
    for (const [method, path] of [['pushState', '/navigation-one?fixture=query#fragment'], ['replaceState', '/navigation-two'], ['pushState', '/navigation-three#fragment'],
      ['pushState', '/navigation-four?fixture=query'], ['hashchange', '/navigation-four?fixture=query#hash-only'], ['back', '/navigation-four?fixture=query']]) {
      const offset = await fixture.page.evaluate(() => window.evidence.state.records.length);
      await fixture.page.evaluate(({ method, path }) => {
        if (method === 'hashchange') location.hash = new URL(path, location.origin).hash;
        else if (method === 'back') history.back();
        else history[method]({}, '', path);
        document.querySelector('#text').textContent = 'NAVIGATION_TEXT_SENTINEL';
      }, { method, path });
      await wait(fixture.page);
      const records = await fixture.page.evaluate(offset => window.evidence.state.records.slice(offset), offset);
      navigations.push({ method, path, recordTypes: records.map(record => ({ type: record.type, source: record.data?.source ?? null })),
        addressRecords: records.filter(record => (record.type === 4 || record.type === 5) && /https?:/.test(JSON.stringify(record.data))).map(record => ({ type: record.type, data: record.data })),
        exactAddressRecorded: records.some(record => (record.type === 4 || record.type === 5) && JSON.stringify(record.data).includes(path)) });
    }
    const data = await recorderData(fixture);
    const serialized = JSON.stringify(data.records);
    result('E9', browser, 'The recorder’s actual options and emitted records were observed during text/shadow changes, a fetch with sentinel headers/body, console output, canvas drawing and pushState, replaceState, hashchange and back navigations. Each navigation is judged from its own subsequent records.',
      { recorderOptions: data.recorderOptions, metaRecords: data.records.filter(record => record.type === 4).map(record => record.data), navigations,
        navigationAddressForEveryTestedChange: navigations.every(row => row.exactAddressRecorded),
        blockedPrivateTextAbsent: !serialized.includes('PRIVATE_TEXT_SENTINEL') && !serialized.includes('BANNER_SENTINEL'),
        publicElementRecorded: data.nodes.some(node => node.attributes?.['data-analytics-id'] === 'public.action'),
        privateDescendantsAbsent: !data.nodes.some(node => ['private.action', 'banner.action'].includes(node.attributes?.['data-analytics-id'])),
        blockPlaceholderCount: data.nodes.filter(node => node.attributes && 'rr_width' in node.attributes && 'rr_height' in node.attributes).length,
        blockPlaceholderShapes: data.nodes.filter(node => node.attributes && 'rr_width' in node.attributes && 'rr_height' in node.attributes),
        networkSentinelsAbsent: !/NETWORK_(?:HEADER|BODY|RESPONSE)_SENTINEL/.test(serialized),
        consoleSentinelAbsent: !serialized.includes('CONSOLE_RECORD_SENTINEL'),
        pluginRecords: data.records.filter(record => record.type === 6),
        canvasRecords: data.records.filter(record => record.type === 3 && record.data?.source === 9),
        recordCount: data.records.length },
      ['Absence is measured for these controlled stimuli; it does not attest arbitrary markup, extensions or future SDK versions.']);
  });
});

test('E10', async ({ browser }) => {
  await withFixture(browser, {}, async fixture => {
    await startRecorder(fixture);
    await fixture.page.fill('#input', 'CHANGED_INPUT_SENTINEL');
    await fixture.page.fill('#textarea', 'CHANGED_TEXTAREA_SENTINEL');
    await fixture.page.evaluate(() => {
      document.querySelector('#text').firstChild.textContent = 'CHANGED_TEXT_SENTINEL';
      const node = document.createElement('p'); node.textContent = 'ADDED_TEXT_SENTINEL'; document.body.append(node);
      document.querySelector('#input').setAttribute('value', 'ATTRIBUTE_VALUE_SENTINEL');
      const shadow = document.querySelector('#shadow').attachShadow({ mode: 'open' }); shadow.innerHTML = '<p>SHADOW_TEXT_SENTINEL</p><input value="SHADOW_VALUE_SENTINEL">';
    });
    await wait(fixture.page);
    await fixture.page.waitForTimeout(2200);
    const data = await recorderData(fixture);
    const kinds = [...new Set(data.records.map(record => `${record.type}:${record.data?.source ?? '-'}`))].sort();
    const nonStyle = data.textLocations.filter(row => !row.isStyle);
    const inputs = data.textLocations.filter(row => /input\.data\.text|attributes\.value/.test(row.path));
    result('E10', browser, 'Real full snapshots and incremental records establish the record type/source pairs and text-bearing paths. Each measured text value is tested against MASKED_TEXT_PATTERN; script placeholders receive no exemption. Uncompressed object data is checked at both recorder and snapshot-hook boundaries.',
      { kinds, textLocations: data.textLocations, inputLocationsMeasured: inputs.length,
        everyMeasuredInputMasked: inputs.length > 0 && inputs.every(row => row.masked),
        everyMeasuredNonStyleTextMasked: nonStyle.length > 0 && nonStyle.every(row => row.masked),
        rawRecordsUncompressed: data.records.length > 0 && data.records.every(record => record.data && typeof record.data === 'object' && !('cv' in record) && !('v' in record)),
        snapshotsAtHook: data.hooks.filter(row => row.input.event === '$snapshot').map(row => ({
          dataIsArray: Array.isArray(row.input.properties.$snapshot_data),
          recordsAreObjects: Array.isArray(row.input.properties.$snapshot_data) && row.input.properties.$snapshot_data.every(record => record && typeof record === 'object' && typeof record.data === 'object'),
          shapes: Array.isArray(row.input.properties.$snapshot_data) ? row.input.properties.$snapshot_data.map(record => ({
            recordType: typeof record, keys: record && typeof record === 'object' ? Object.keys(record) : [],
            type: record?.type ?? null, dataType: typeof record?.data, cv: record?.cv ?? null, v: record?.v ?? null,
            dataStringPrefixHex: typeof record?.data === 'string' ? Array.from(record.data.slice(0, 8)).map(char => char.charCodeAt(0).toString(16).padStart(2, '0')).join('') : null,
            dataFieldTypes: record?.data && typeof record.data === 'object' ? Object.fromEntries(Object.entries(record.data).map(([key, value]) => [key, Array.isArray(value) ? 'array' : typeof value])) : null,
          })) : [],
        })), recordCount: data.records.length },
      ['Only record kinds generated by the listed stimuli are established; absent kinds are not inferred from SDK types.']);
  });
});

test('E11', async ({ browser }) => {
  await withFixture(browser, {}, async fixture => {
    await startRecorder(fixture);
    const data = await recorderData(fixture);
    expect(data.scripts.length).toBeGreaterThan(0);
    result('E11', browser, 'The serialized script children were read from a real full snapshot of a fixture containing an inline script. Their exact strings and MASKED_TEXT_PATTERN results are recorded, rather than guessed from source or a simulated DOM.',
      { exactRecordedScriptTexts: [...new Set(data.scripts)], matchesMaskedTextPattern: data.scripts.every(text => /^[\s*]*$/.test(text)),
        originalInlineScriptTextPresent: data.scripts.some(text => text.includes('INLINE_SCRIPT_SENTINEL')) });
  });
});

test('E12', async ({ browser }) => {
  await withFixture(browser, {}, async fixture => {
    await fixture.page.clock.install();
    await initialize(fixture, { autocapture: true });
    const ids = () => fixture.page.evaluate(() => ({ session: window.evidence.instance.get_session_id(), distinct: window.evidence.instance.get_distinct_id() }));
    const initial = await ids();
    await fixture.page.evaluate(() => window.evidence.instance.reset());
    const reset = await ids();
    await fixture.page.evaluate(() => window.evidence.instance.opt_in_capturing());
    const timeoutSeconds = await fixture.page.evaluate(() => window.evidence.instance.config.session_idle_timeout_seconds);
    await fixture.page.clock.fastForward((timeoutSeconds + 120) * 1000);
    await fixture.page.evaluate(() => window.evidence.capture('/after-idle'));
    const idle = await ids();
    result('E12', browser, 'The real SDK’s reset and idle rotation were measured by ID equality, without persisting the random IDs. Chromium’s clock advanced beyond the configured inactivity interval, followed by a real adapter capture; this is a controlled timer experiment, not a wall-clock soak.',
      { resetChangesSession: reset.session !== initial.session, resetChangesDistinctId: reset.distinct !== initial.distinct,
        configuredIdleTimeoutSeconds: timeoutSeconds, simulatedIdleSeconds: timeoutSeconds + 120,
        sessionChangesAfterIdle: idle.session !== reset.session, distinctIdChangesAfterIdle: idle.distinct !== reset.distinct },
      ['Maximum session lifetime, cross-tab activity and suspend/resume behavior are not established by the inactivity experiment.']);
  });
});

test('E13', async ({ browser }) => {
  const variants = [];
  for (const preloaded of [true, false]) {
    await withFixture(browser, { preloaded }, async fixture => {
      await startRecorder(fixture);
      variants.push({ recorderPreImported: preloaded,
        requestedScriptUrls: fixture.sdkRequests().filter(row => row.resourceType === 'script').map(row => row.url),
        recorderRequestUrls: fixture.sdkRequests().filter(row => /(?:recorder|rrweb).*\.js/.test(new URL(row.url).pathname)).map(row => row.url),
        recordingStarted: await fixture.page.evaluate(() => window.evidence.instance.sessionRecordingStarted()) });
    });
  }
  result('E13', browser, 'Both real entry bundles were exercised: one imports the pinned posthog-recorder module before initialization; the other lets the SDK request it. Attempted script URLs were fulfilled using only the corresponding local SDK files.', { variants });
});

test('E14', async ({ browser }) => {
  await withFixture(browser, {}, async fixture => {
    await fixture.page.evaluate(() => {
      const h = window.evidence; h.loadCount = 0;
      h.transport = h.createAnalyticsTransport({ allowedConversions: ['evidence_conversion'], loadProvider: async () => {
        h.loadCount += 1; return h.create({ initialize: false });
      } });
      h.transport.pageview({ href: location.href });
      h.transport.setPermission(false); h.transport.pageview({ href: location.href });
    });
    await wait(fixture.page);
    const beforeGrantRequests = fixture.sdkRequests().map(row => ({ url: row.url, method: row.method }));
    const beforeGrantLoads = await fixture.page.evaluate(() => window.evidence.loadCount);
    await fixture.page.evaluate(() => { const h = window.evidence; h.transport.setPermission(true); h.transport.pageview({ href: location.href }); });
    await fixture.page.waitForFunction(() => window.evidence.loadCount === 1 && window.evidence.instance);
    await wait(fixture.page);
    expect(beforeGrantLoads).toBe(0); expect(beforeGrantRequests).toEqual([]);
    result('E14', browser, 'The actual built analytics transport was given pageviews while undecided and refused, before its first grant. Its lazy provider loader and SDK request counts were both zero. The first grant then initialized the real adapter exactly once.',
      { beforeGrantLoads, beforeGrantRequests, afterGrantLoads: await fixture.page.evaluate(() => window.evidence.loadCount),
        afterGrantRequestPaths: fixture.sdkRequests().map(row => new URL(row.url).pathname) },
      ['This proves the lazy transport path. Direct host calls to SDK init are outside that path; E1 records any requests such direct initialization makes while opted out.']);
  });
});

test('E15', async ({ browser }) => {
  let baseline;
  await withFixture(browser, {}, async fixture => {
    await initialize(fixture);
    const members = await fixture.page.evaluate(() => {
      const i = window.evidence.instance;
      return { set_config: typeof i.set_config, reloadFeatureFlags: typeof i.reloadFeatureFlags,
        onFeatureFlags: typeof i.onFeatureFlags, featureFlags: typeof i.featureFlags,
        'featureFlags.reset': typeof i.featureFlags?.reset };
    });
    const requestsAtInit = flagsRequests(fixture).length;
    await fixture.page.evaluate(() => {
      const h = window.evidence; h.flagCallbacks = [];
      h.instance.onFeatureFlags((keys, variants) => h.flagCallbacks.push({ phase: 'disabled', keys, variants }));
      h.instance.getFeatureFlag('evidence_flag', { send_event: false });
    });
    await wait(fixture.page);
    const requestsAfterCallbackRegistration = flagsRequests(fixture).length;
    await fixture.page.evaluate(() => window.evidence.instance.reloadFeatureFlags());
    await wait(fixture.page);
    const disabledRequests = flagsRequests(fixture).map(row => ({ payload: row.payload, responseFulfilled: row.responseFulfilled ?? false }));
    fixture.setFlagVariant('warm-response');
    await fixture.page.evaluate(() => {
      const i = window.evidence.instance;
      i.set_config({ advanced_disable_feature_flags: false, advanced_disable_feature_flags_on_first_load: false });
      i.reloadFeatureFlags();
    });
    await expect.poll(() => fixture.page.evaluate(() => window.evidence.instance.getFeatureFlag('evidence_flag', { send_event: false }) ?? null)).toBe('warm-response');
    const cache = await fixture.page.evaluate(() => {
      const i = window.evidence.instance;
      const beforeReset = i.getFeatureFlag('evidence_flag', { send_event: false }) ?? null;
      i.featureFlags.reset();
      const afterFeatureFlagsReset = i.getFeatureFlag('evidence_flag', { send_event: false }) ?? null;
      i.set_config({ advanced_disable_feature_flags: true, advanced_disable_feature_flags_on_first_load: true });
      i.reset();
      const afterSdkReset = i.getFeatureFlag('evidence_flag', { send_event: false }) ?? null;
      return { beforeReset, afterFeatureFlagsReset, afterSdkReset };
    });
    const payloads = flagsRequests(fixture).map(row => row.payload);
    const valueKeys = payload => {
      if (!payload || typeof payload !== 'object') return [];
      return Object.keys(payload).filter(key => /person|group|url|referr/i.test(key)).map(key => ({ key, value: payload[key] }));
    };
    baseline = { members, requestsAtInit, requestsAfterCallbackRegistration, disabledRequests,
      evaluationPayloads: payloads, targetingOrAddressFields: payloads.flatMap(valueKeys), cache };
  });
  const isolation = [];
  for (const resetFlags of [false, true]) {
    await withFixture(browser, {}, async fixture => {
      await initialize(fixture);
      fixture.holdFlags(true); fixture.setFlagVariant('old-response');
      await fixture.page.evaluate(() => {
        const h = window.evidence; h.flagCallbacks = [];
        h.instance.onFeatureFlags((keys, variants) => h.flagCallbacks.push({ phase: 'old-subscription', keys, variants }));
        h.instance.set_config({ advanced_disable_feature_flags: false, advanced_disable_feature_flags_on_first_load: false });
        h.instance.reloadFeatureFlags();
      });
      await expect.poll(() => flagsRequests(fixture).length).toBeGreaterThan(0);
      const oldRequest = flagsRequests(fixture)[0];
      fixture.setFlagVariant('fresh-response');
      await fixture.page.evaluate(resetFlags => {
        const h = window.evidence;
        h.port.optOut();
        if (resetFlags) h.instance.featureFlags.reset();
        h.port.optIn();
        h.instance.onFeatureFlags((keys, variants) => h.flagCallbacks.push({ phase: 'current-subscription', keys, variants }));
      }, resetFlags);
      fixture.holdFlags(false); fixture.releaseFlags();
      // Observe the old response before initiating a fresh request, so SDK
      // request coalescing cannot conceal stale delivery in the control.
      await expect.poll(() => oldRequest.responseFulfilled ?? false).toBe(true);
      await expect.poll(() => Boolean(oldRequest.transportFinished || oldRequest.transportFailure)).toBe(true);
      await wait(fixture.page);
      const beforeFresh = await fixture.page.evaluate(() => ({ callbacks: window.evidence.flagCallbacks,
        cached: window.evidence.instance.getFeatureFlag('evidence_flag', { send_event: false }) ?? null }));
      await fixture.page.evaluate(() => window.evidence.instance.reloadFeatureFlags());
      await expect.poll(() => fixture.page.evaluate(() => window.evidence.instance.getFeatureFlag('evidence_flag', { send_event: false }) ?? null)).toBe('fresh-response');
      const callbacks = await fixture.page.evaluate(() => window.evidence.flagCallbacks);
      const staleDeliveredToCurrentSubscription = callbacks.some(row => row.phase === 'current-subscription' && row.variants?.evidence_flag === 'old-response');
      const freshDeliveredToCurrentSubscription = callbacks.some(row => row.phase === 'current-subscription' && row.variants?.evidence_flag === 'fresh-response');
      isolation.push({ resetFlags, oldResponseFulfilled: oldRequest.responseFulfilled,
        oldRequestTransportFinished: oldRequest.transportFinished ?? false,
        oldRequestTransportFailure: oldRequest.transportFailure ?? null, beforeFresh, callbacks,
        staleDeliveredToCurrentSubscription, freshDeliveredToCurrentSubscription,
        requestCorrelationEstablished: resetFlags && oldRequest.responseFulfilled && freshDeliveredToCurrentSubscription && !staleDeliveredToCurrentSubscription,
        requests: flagsRequests(fixture).map(row => ({ responseVariant: row.responseVariant ?? null, responseFulfilled: row.responseFulfilled ?? false })) });
    });
  }
  result('E15', browser, 'The real SDK members, disabled and enabled request shapes, populated-cache reset, and delayed replies were measured. Two response experiments compare withdrawal/re-grant with and without featureFlags.reset; each also requires a fresh reply through the current subscription so absence of stale delivery is not a dead callback.',
    { ...baseline, isolation,
      requestIsolationEstablished: isolation.some(row => row.resetFlags && row.requestCorrelationEstablished),
      isolationMechanism: 'The real featureFlags.reset invalidates pending work. The old HTTP response is still locally fulfilled; this tests SDK response correlation, not retraction of an already-sent request.' },
    ['A passing response-isolation probe does not satisfy the separate C-73 targeting-free request or cache-clearing requirements. This is SDK evidence, not a change to the flags adapter.']);
});

test('E16', async ({ browser }) => {
  const variants = [];
  for (const options of [{ autocapture: true }, { replay: true }, { autocapture: true, replay: true }]) {
    await withFixture(browser, { dnt: true }, async fixture => {
      await initialize(fixture, options);
      await fixture.page.evaluate(() => { window.evidence.capture(); window.evidence.instance.startSessionRecording(); });
      await fixture.page.click('#public');
      await fixture.page.waitForTimeout(2300);
      await flush(fixture);
      variants.push({ options, requests: fixture.sdkRequests().map(row => ({ url: row.url, method: row.method, resourceType: row.resourceType })),
        events: events(fixture.requests).map(row => row.event),
        optedOut: await fixture.page.evaluate(() => window.evidence.instance.has_opted_out_capturing()),
        recordingStarted: await fixture.page.evaluate(() => window.evidence.instance.sessionRecordingStarted()) });
    });
  }
  result('E16', browser, 'Chromium exposed Do Not Track before the SDK loaded. The actual adapter was exercised under each enabled capture-class combination; all SDK request attempts, decoded events and recording state are listed, including configuration requests rather than counting only event ingestion.', { variants });
});

test('E17', async ({ browser }) => {
  const e8 = previous('E8'), e9 = previous('E9'), e10 = previous('E10'), e11 = previous('E11');
  const snapshotsMeasured = e8.snapshots.length > 0;
  const recordsMeasured = e9.recordCount > 0 && e10.recordCount > 0;
  const values = {
    masksAllText: recordsMeasured && e10.everyMeasuredNonStyleTextMasked && e11.matchesMaskedTextPattern,
    masksAllInputs: recordsMeasured && e10.everyMeasuredInputMasked,
    honoursBlockSelector: recordsMeasured && e9.blockedPrivateTextAbsent && e9.publicElementRecorded && e9.privateDescendantsAbsent && e9.blockPlaceholderCount >= 4,
    recordsNoNetworkPayloads: recordsMeasured && e9.networkSentinelsAbsent && e9.pluginRecords.length === 0,
    recordsNoConsole: recordsMeasured && e9.consoleSentinelAbsent && e9.pluginRecords.length === 0,
    recordsNoCanvas: recordsMeasured && e9.canvasRecords.length === 0,
    recordsNavigationAddress: recordsMeasured && e9.navigationAddressForEveryTestedChange,
    snapshotsPassBeforeSend: snapshotsMeasured,
  };
  const reasons = {
    masksAllText: e10.everyMeasuredNonStyleTextMasked && e11.matchesMaskedTextPattern ? 'E10/E11 found every measured non-style text value in masked form.' : `E10/E11 found unmasked non-style text; recorded script strings include ${JSON.stringify(e11.exactRecordedScriptTexts)}.`,
    masksAllInputs: `E10 measured ${e10.inputLocationsMeasured} input/value locations; all matched MASKED_TEXT_PATTERN: ${e10.everyMeasuredInputMasked}.`,
    honoursBlockSelector: `E9 observed ${e9.blockPlaceholderCount} blocked-node placeholders for the four private selectors; the public control is present: ${e9.publicElementRecorded}; private descendants are absent: ${e9.privateDescendantsAbsent}.`,
    recordsNoNetworkPayloads: `E9's fetch header/body/response sentinels were absent: ${e9.networkSentinelsAbsent}; observed plugin records: ${e9.pluginRecords.length}.`,
    recordsNoConsole: `E9's console sentinel was absent: ${e9.consoleSentinelAbsent}; observed plugin records: ${e9.pluginRecords.length}.`,
    recordsNoCanvas: `E9 drew on a real canvas and observed ${e9.canvasRecords.length} canvas-mutation records.`,
    recordsNavigationAddress: `E9 recorded the exact address, including any query/fragment, after ${e9.navigations.filter(row => row.exactAddressRecorded).length} of ${e9.navigations.length} navigations; stripped addresses cannot establish C-68's query/fragment check.`,
    snapshotsPassBeforeSend: `E8 observed ${e8.snapshots.length} real snapshot events at the SDK before-send boundary; the actual adapter still gated their output.`,
  };
  const references = { masksAllText: ['E10', 'E11'], masksAllInputs: ['E10'], honoursBlockSelector: ['E9'],
    recordsNoNetworkPayloads: ['E9'], recordsNoConsole: ['E9'], recordsNoCanvas: ['E9'], recordsNavigationAddress: ['E9'], snapshotsPassBeforeSend: ['E8'] };
  const capabilities = Object.fromEntries(CAPABILITY_FIELDS.map(field => [field, { value: values[field], reason: reasons[field], items: references[field] }]));
  result('E17', browser, 'Each replay capability is derived from specific real-browser observations; false includes incompatible or unproven behavior. This bounded fixture is evidence for this SDK version, not permission to enable replay on an arbitrary surface.', { capabilities },
    ['The adapter requires all eight fields to be true. Any false field keeps replay off; the harness never supplies an optimistic probe to start recording.']);
});

test('resetCancelsPendingRequests', async ({ browser }) => {
  const evidence = previous('E15');
  const control = evidence.isolation.find(row => !row.resetFlags);
  const reset = evidence.isolation.find(row => row.resetFlags);
  const answer = control.staleDeliveredToCurrentSubscription && reset.oldResponseFulfilled &&
    reset.oldRequestTransportFinished && reset.freshDeliveredToCurrentSubscription &&
    !reset.staleDeliveredToCurrentSubscription && reset.beforeFresh.cached === null;
  const observedSequence = [
    { step: 'A starts under the first grant; its local response is held', observed: reset.requests[0].responseVariant === 'old-response' },
    { step: 'Withdraw analytics, call featureFlags.reset, re-grant and register subscription B', resetCalled: reset.resetFlags },
    { step: 'Release A after B exists', httpResponseCompleted: reset.oldRequestTransportFinished,
      transportFailure: reset.oldRequestTransportFailure, deliveredOldVariantToB: reset.staleDeliveredToCurrentSubscription,
      cacheBeforeFreshRequest: reset.beforeFresh.cached },
    { step: 'Request a fresh value through B', deliveredFreshVariantToB: reset.freshDeliveredToCurrentSubscription },
    { step: 'Repeat without featureFlags.reset', deliveredOldVariantToB: control.staleDeliveredToCurrentSubscription },
  ];
  result('resetCancelsPendingRequests', browser,
    'Planner amendment: measure cancellation of a pending SDK evaluation at the callback/cache boundary, with a no-reset control and a subsequent live subscription.',
    { answer, observedSequence,
      meaning: 'SDK-level cancellation: the earlier evaluation response cannot populate the cache or arrive through the later subscription.',
      transportCancellationObserved: !reset.oldRequestTransportFinished && reset.oldRequestTransportFailure !== null,
      reason: answer ? 'With reset, the old HTTP response completed but its variant reached neither B nor the cache; a fresh reply reached B. Without reset, the old variant reached B.' :
        'The complete negative-control/current-subscription sequence did not establish pending-evaluation cancellation.' },
    ['This establishes logical SDK response invalidation for the pinned build. It does not claim that an already transmitted HTTP request is aborted or retracted.']);
});
