import posthog from 'posthog-js';
import * as adapter from '../../packages/observer/dist/browser-analytics/providers/posthog.js';
import { createAnalyticsTransport } from '../../packages/observer/dist/browser-analytics/transport.js';

const PROJECT = 'evidence-only-project';
const copy = value => value === undefined ? null : JSON.parse(JSON.stringify(value));
const state = { hooks: [], records: [], recorderOptions: [], initializations: [], sdkCalls: [] };
const unprovenProbe = () => Object.fromEntries([
  'masksAllText', 'masksAllInputs', 'honoursBlockSelector', 'recordsNoNetworkPayloads',
  'recordsNoConsole', 'recordsNoCanvas', 'recordsNavigationAddress', 'snapshotsPassBeforeSend',
].map(field => [field, false]));

function tapRecorder() {
  const extension = window.__PosthogExtensions__?.rrweb;
  if (!extension || extension.record.evidenceObserved) return;
  const original = extension.record;
  function observed(options) {
    state.recorderOptions.push(copy(Object.fromEntries(Object.entries(options)
      .map(([key, value]) => [key, typeof value === 'function' ? '[function]' : value]))));
    return original({ ...options, emit(record, ...rest) {
      state.records.push(copy(record));
      return options.emit(record, ...rest);
    } });
  }
  Object.assign(observed, original, { evidenceObserved: true });
  extension.record = observed;
}

function sanitizeUrl(href) {
  try { const url = new URL(href); url.search = ''; url.hash = ''; return url.href; }
  catch { return null; }
}

function create({ autocapture = false, replay = false, initialize = true } = {}) {
  tapRecorder();
  const source = {
    init(key, config, name) {
      const instance = posthog.init(key, config, name);
      const methods = Object.getOwnPropertyDescriptors(Object.getPrototypeOf(instance));
      const hookMethods = Object.entries(methods).filter(([key, descriptor]) => key !== 'constructor' &&
        typeof descriptor.value === 'function' && descriptor.value.toString().includes('.before_send') &&
        descriptor.value.toString().includes('beforeSend function'));
      if (hookMethods.length !== 1) throw new Error(`Cannot identify the pinned SDK hook runner: ${hookMethods.length} candidates`);
      const [hookMethod, { value: original }] = hookMethods[0];
      state.initializations.push({ name, hookIdentity: instance?.config.before_send === config.before_send,
        returnedDefault: instance === posthog, config: copy(config), diagnosticHookMethod: hookMethod });
      // Observe the shipped minified method without replacing the configured
      // before_send function or changing the adapter's identity check.
      instance[hookMethod] = function (input) {
        const raw = copy(input);
        const output = original.call(this, input);
        state.hooks.push({ input: raw, output: copy(output) });
        return output;
      };
      window.evidence.instance = instance;
      return instance;
    },
  };
  const port = adapter.createPostHogProvider(source, {
    key: PROJECT, apiHost: location.origin,
    ...(autocapture ? { autocapture: { enabled: true } } : {}),
    ...(replay ? { replay: { enabled: true, sampleRate: 1, probe: unprovenProbe } } : {}),
  });
  window.evidence.port = port;
  if (!initialize) return port;
  port.init({ eventNames: ['$pageview', 'evidence_conversion'], sanitizeUrl });
  return state.initializations.at(-1);
}

function capture(path = '/measured?remove=query#remove-fragment') {
  window.evidence.port.capture({ kind: 'pageview', url: `${location.origin}${path}`,
    referrerOrigin: 'https://referrer.invalid', properties: {} });
}

async function storage() {
  return {
    cookies: document.cookie.split(';').map(pair => pair.trim().split('=')[0]).filter(Boolean).sort(),
    localStorage: Object.fromEntries(Object.entries(localStorage).sort()),
    sessionStorage: Object.fromEntries(Object.entries(sessionStorage).sort()),
    indexedDB: (await indexedDB.databases()).map(db => db.name).sort(),
    operations: copy(window.storageOperations),
  };
}

function configuration() {
  const config = window.evidence.instance.config;
  const keys = Object.keys(state.initializations.at(-1).config);
  return Object.fromEntries(keys.map(key => [key, key === 'before_send' ? typeof config[key] : copy(config[key])]));
}

function queue() {
  const candidates = Object.values(window.evidence.instance).filter(value => value && typeof value === 'object' &&
    typeof value.enqueue === 'function' && typeof value.unload === 'function' && typeof value.enable === 'function');
  if (candidates.length !== 1) throw new Error(`Cannot identify the pinned SDK send queue: ${candidates.length} candidates`);
  return candidates[0];
}

function queueLength() {
  const arrays = Object.values(queue()).filter(Array.isArray);
  if (arrays.length !== 1) throw new Error(`Cannot identify the pinned SDK queue array: ${arrays.length} candidates`);
  return arrays[0].length;
}

window.evidence = { sdk: posthog, adapter, project: PROJECT, state, create, capture, storage, createAnalyticsTransport,
  configuration, tapRecorder, sanitizeUrl, queue, queueLength };
tapRecorder();
