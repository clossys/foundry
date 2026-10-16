import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, basename } from 'node:path';
import { gunzipSync, inflateSync } from 'node:zlib';

export const FIXTURE = `<!doctype html><html><head><title>SDK evidence</title>
<style>.probe { color: rgb(10, 20, 30) }</style></head><body>
<p id="text">VISIBLE_TEXT_SENTINEL</p>
<button id="public" class="probe" data-analytics-id="public.action">BUTTON_TEXT_SENTINEL</button>
<button id="unlisted">UNLISTED_SENTINEL</button>
<section data-private><button id="private" data-analytics-id="private.action">PRIVATE_TEXT_SENTINEL</button></section>
<section data-consent-banner><button id="banner" data-analytics-id="banner.action">BANNER_SENTINEL</button></section>
<form id="form" data-analytics-id="form.action"><input id="input" data-analytics-id="input.action" value="FORM_VALUE_SENTINEL">
<textarea id="textarea">TEXTAREA_SENTINEL</textarea><input id="password" type="password" value="PASSWORD_SENTINEL">
<input id="card" autocomplete="cc-number" value="CARD_SENTINEL"></form>
<canvas id="canvas" width="20" height="20"></canvas><div id="shadow"></div>
<iframe id="frame" srcdoc="<p>IFRAME_TEXT_SENTINEL</p><input value='IFRAME_VALUE_SENTINEL'>"></iframe>
<script>window.inlineProbe = "INLINE_SCRIPT_SENTINEL";</script>
<script src="/evidence.js"></script></body></html>`;

const REMOTE_CONFIG = {
  autocapture_opt_out: false,
  hasFeatureFlags: true,
  sessionRecording: { endpoint: '/s/', sampleRate: 1, minimumDurationMilliseconds: 0 },
  surveys: [], productTours: [],
};

function decode(buffer, url) {
  if (!buffer?.length) return null;
  let bytes = buffer;
  try { if (bytes[0] === 0x1f && bytes[1] === 0x8b) bytes = gunzipSync(bytes); } catch {}
  const text = bytes.toString('utf8');
  try { return JSON.parse(text); } catch {}
  const params = new URLSearchParams(text);
  const encoded = params.get('data') ?? new URL(url).searchParams.get('data');
  if (encoded) {
    for (const candidate of [Buffer.from(encoded, 'base64'), Buffer.from(encoded)]) {
      for (const transform of [value => value, gunzipSync, inflateSync]) {
        try { return JSON.parse(transform(candidate).toString('utf8')); } catch {}
      }
    }
  }
  return { undecoded: true, byteLength: buffer.length };
}

export function events(requests) {
  return requests.flatMap(request => {
    const payload = request.payload;
    return Array.isArray(payload) ? payload : Array.isArray(payload?.batch) ? payload.batch : Array.isArray(payload?.data) ? payload.data : payload?.event ? [payload] : [];
  });
}

export async function openFixture(browser, { preloaded = true, dnt = false } = {}) {
  // Listening on loopback supplies a real HTTP origin. Every browser request,
  // including this origin's HTML and bundles, is fulfilled by the route stub.
  const requests = [], pageErrors = [], held = [];
  let escapedRequests = 0;
  const server = createServer((_request, response) => {
    escapedRequests += 1; response.writeHead(500); response.end('Request escaped the route stub');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  // The SDK filters HeadlessChrome as a bot. Exercise its normal-browser
  // behavior in real Chromium with the corresponding non-headless UA token.
  const userAgent = `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${browser.version()} Safari/537.36`;
  const context = await browser.newContext({ serviceWorkers: 'block', userAgent });
  const requestRows = new WeakMap();
  context.on('requestfinished', request => {
    const row = requestRows.get(request); if (row) row.transportFinished = true;
  });
  context.on('requestfailed', request => {
    const row = requestRows.get(request); if (row) row.transportFailure = request.failure()?.errorText ?? 'unknown failure';
  });
  let holdFlags = false, flagVariant = 'variant';
  await context.addInitScript(({ dnt }) => {
    if (dnt) Object.defineProperty(navigator, 'doNotTrack', { get: () => '1', configurable: true });
    window.storageOperations = [];
    for (const method of ['setItem', 'removeItem', 'clear']) {
      const original = Storage.prototype[method];
      Storage.prototype[method] = function (...args) {
        window.storageOperations.push({ store: this === localStorage ? 'localStorage' : 'sessionStorage', method, key: args[0] ?? null });
        return original.apply(this, args);
      };
    }
    const cookie = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie');
    Object.defineProperty(document, 'cookie', { configurable: true,
      get: () => cookie.get.call(document), set: value => {
        window.storageOperations.push({ store: 'cookie', method: 'set', key: String(value).split('=')[0] });
        cookie.set.call(document, value);
      },
    });
    for (const method of ['open', 'deleteDatabase']) {
      const original = indexedDB[method].bind(indexedDB);
      indexedDB[method] = (...args) => {
        window.storageOperations.push({ store: 'indexedDB', method, key: args[0] });
        return original(...args);
      };
    }
  }, { dnt });
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    const row = { url: request.url(), method: request.method(), resourceType: request.resourceType(),
      interception: 'playwright-route', payload: decode(request.postDataBuffer(), request.url()) };
    requests.push(row);
    requestRows.set(request, row);
    const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*',
      'access-control-allow-methods': 'GET,POST,OPTIONS', 'cache-control': 'no-store' };
    const fulfill = (body, contentType = 'application/json') => route.fulfill({ status: 200, headers, contentType, body });
    if (request.method() === 'OPTIONS') return fulfill('');
    if (url.pathname === '/' || url.pathname === '/fixture') return fulfill(FIXTURE, 'text/html');
    if (url.pathname === '/evidence.js') return fulfill(readFileSync(resolve('node_modules/.cache/browser-evidence', preloaded ? 'preloaded.js' : 'browser.js')), 'text/javascript');
    if (/\/array\/[^/]+\/config(?:\.js)?$/.test(url.pathname)) {
      if (url.pathname.endsWith('.js')) return fulfill(`window._POSTHOG_REMOTE_CONFIG = window._POSTHOG_REMOTE_CONFIG || {}; window._POSTHOG_REMOTE_CONFIG["evidence-only-project"] = {config:${JSON.stringify(REMOTE_CONFIG)}};`, 'text/javascript');
      return fulfill(JSON.stringify(REMOTE_CONFIG));
    }
    if (/\/(?:lazy-recorder|posthog-recorder|recorder)(?:[.-][\w.-]+)?\.js$/.test(url.pathname)) {
      const file = resolve('node_modules/posthog-js/dist', basename(url.pathname));
      if (!existsSync(file)) throw new Error(`Requested recorder is absent from the pinned SDK: ${basename(url.pathname)}`);
      return fulfill(`${readFileSync(file, 'utf8')}\nwindow.evidence?.tapRecorder();`, 'text/javascript');
    }
    if (/\/flags\/?$/.test(url.pathname)) {
      const responseVariant = flagVariant;
      if (holdFlags) await new Promise(resolve => held.push(resolve));
      const response = await fulfill(JSON.stringify({ featureFlags: { evidence_flag: responseVariant }, featureFlagPayloads: {},
        flags: { evidence_flag: { key: 'evidence_flag', enabled: true, variant: responseVariant, metadata: { id: 1, version: 1 } } },
        requestId: 'local-stub-request', errorsWhileComputingFlags: false }));
      row.responseVariant = responseVariant;
      row.responseFulfilled = true;
      return response;
    }
    if (request.resourceType() === 'script') return fulfill('/* closed-network local stub */', 'text/javascript');
    return fulfill(JSON.stringify({ status: 1, fixture: 'NETWORK_RESPONSE_SENTINEL' }));
  });
  await context.routeWebSocket('**/*', socket => { requests.push({ url: socket.url(), resourceType: 'websocket' }); socket.close(); });
  const page = await context.newPage();
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto(`${origin}/fixture`);
  await page.waitForFunction(() => Boolean(window.evidence));
  return {
    page, context, origin, requests, pageErrors,
    holdFlags(value) { holdFlags = value; },
    setFlagVariant(value) { flagVariant = value; },
    releaseFlags() { for (const release of held.splice(0)) release(); },
    sdkRequests() { return requests.filter(row => !['/fixture', '/evidence.js'].includes(new URL(row.url).pathname)); },
    async close() {
      for (const release of held.splice(0)) release();
      await context.close(); await new Promise(resolve => server.close(resolve));
      if (escapedRequests) throw new Error(`${escapedRequests} requests escaped the route stub`);
    },
  };
}
