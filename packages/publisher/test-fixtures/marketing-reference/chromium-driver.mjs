/** Optional local Chromium CDP adapter for the existing capture driver contract. */
const origin = process.env.MARKETING_CAPTURE_CDP ?? 'http://127.0.0.1:9431';
const parsed = new URL(origin);
if (parsed.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(parsed.hostname) || parsed.username || parsed.password || parsed.pathname !== '/') throw new TypeError('Capture CDP must be a local HTTP origin');
export async function environment() {
 const info = await (await fetch(origin + "/json/version")).json();
 return { browser: info.Browser, protocol: info["Protocol-Version"] };
}
export async function shoot({ html, width, height, reducedMotion, dir }) {
 const target = await (await fetch(origin + '/json/new?about:blank', { method: 'PUT' })).json();
 const socket = new WebSocket(target.webSocketDebuggerUrl);
 await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
 let id = 0; const pending = new Map();
 socket.addEventListener('message', event => { const response = JSON.parse(event.data); const item = pending.get(response.id); if (item) { pending.delete(response.id); response.error ? item.reject(new Error(JSON.stringify(response.error))) : item.resolve(response.result); } });
 const call = (method, params = {}) => new Promise((resolve, reject) => { const sequence = ++id; pending.set(sequence, { resolve, reject }); socket.send(JSON.stringify({ id: sequence, method, params })); });
 try {
  await call('Page.enable');
  await call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 500 });
  await call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: reducedMotion ? 'reduce' : 'no-preference' }] });
  const { frameTree } = await call('Page.getFrameTree');
  await call('Page.setDocumentContent', { frameId: frameTree.frame.id, html });
  await call('Runtime.evaluate', { expression: 'document.fonts.ready.then(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))', awaitPromise: true });
  const check = await call('Runtime.evaluate', { expression: `JSON.stringify({width: innerWidth, reduced: matchMedia('(prefers-reduced-motion: reduce)').matches, headings: document.querySelectorAll('h1').length, dir: document.documentElement.dir})`, returnByValue: true });
  const actual = JSON.parse(check.result.value);
  if (actual.width !== width || actual.reduced !== reducedMotion || actual.headings !== 1 || actual.dir !== dir) throw new Error('Browser dimension/probe mismatch ' + JSON.stringify(actual));
  const { cssContentSize } = await call('Page.getLayoutMetrics');
  const { data } = await call('Page.captureScreenshot', { format: 'webp', quality: 90, fromSurface: true, captureBeyondViewport: true, clip: { x: 0, y: 0, width, height: Math.max(height, Math.ceil(cssContentSize.height)), scale: 1 } });
  return new Uint8Array(Buffer.from(data, 'base64'));
 } finally { socket.close(); await fetch(origin + '/json/close/' + target.id); }
}
