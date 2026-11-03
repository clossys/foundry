import { JSDOM } from 'jsdom';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { BlockViewerCardIframe, BlockViewerIframe, observeSpecimenSize, specimenContentHeight, specimenSource } from './BlockViewerIframe';

describe('BlockViewer iframe extraction and bounded data fit', () => {
  it('retains the stock iframe, class literal, lazy loading and 930 default without a ratio wrapper', () => {
    const document = new JSDOM(renderToStaticMarkup(<BlockViewerIframe src="/__specimen?element=sample" title="Sample preview" viewport={1280} iframeKey="sample-v1" />)).window.document;
    const frame = document.querySelector('iframe')!;
    expect(document.body.children.length).toBe(1);
    expect(frame.className).toBe('relative z-20 no-scrollbar w-full bg-background');
    expect(frame.getAttribute('loading')).toBe('lazy');
    expect(frame.getAttribute('height')).toBe('930');
    expect(frame.title).toBe('Sample preview');
    expect(frame.hasAttribute('inert')).toBe(true);
  });

  it('accepts only projected local sources', () => {
    expect(specimenSource('/__specimen?element=sample&width=375')).toContain('width=375');
    expect(specimenSource('/preview/publication/frame/page.html')).toContain('/preview/');
    for (const source of ['https://example.org/__specimen', '//example.org/__specimen', 'javascript:alert(1)', '/preview/../../other', '/\\example.org/__specimen', '/other', '/__specimen\n']) {
      expect(() => specimenSource(source)).toThrow();
    }
  });

  it('binds the accepted message viewport to the actual projected source', () => {
    expect(specimenSource('/__specimen?width=375', 375)).toContain('width=375');
    expect(specimenSource('/preview/example/frame/home.html?width=768', 768)).toContain('width=768');
    for (const source of ['/__specimen?width=1280', '/__specimen', '/__specimen?width=375&width=1280']) {
      expect(() => specimenSource(source, 375)).toThrow('viewport');
    }
  });

  it('scales short content, caps long content and rejects malformed or wrong-viewport messages', () => {
    const size = { type: 'clossys:specimen-size', width: 1280, height: 240 };
    expect(specimenContentHeight(size, 1280, 640, 930)).toBe(120);
    expect(specimenContentHeight({ ...size, height: 100000 }, 1280, 640, 930)).toBe(930);
    for (const height of [0, -1, NaN, Infinity, '240', null]) expect(specimenContentHeight({ ...size, height }, 1280, 640, 930)).toBeUndefined();
    expect(specimenContentHeight({ ...size, width: 375 }, 1280, 640, 930)).toBeUndefined();
    expect(specimenContentHeight({ ...size, type: 'other' }, 1280, 640, 930)).toBeUndefined();
    for (const width of [0, -1, NaN, Infinity]) expect(specimenContentHeight(size, 1280, width, 930)).toBeUndefined();
    for (const ceiling of [0, -1, NaN, Infinity]) expect(specimenContentHeight(size, 1280, 640, ceiling)).toBeUndefined();
  });

  it('requires load, exact origin/window/element id/source and disconnects on cleanup', () => {
    const dom = new JSDOM('<iframe id="preview" src="/__specimen?element=sample"></iframe><iframe id="other" src="/__specimen?element=other"></iframe>', { url: 'https://example.com/' });
    const host = dom.window;
    const frame = host.document.querySelector('iframe')!;
    const other = host.document.querySelectorAll('iframe')[1];
    Object.defineProperty(frame, 'clientWidth', { value: 640 });
    const height = vi.fn();
    const cleanup = observeSpecimenSize(frame, 1280, 930, height);
    const send = (origin = host.location.origin, source: Window | null = frame.contentWindow, data = { type: 'clossys:specimen-size', width: 1280, height: 240 }) => host.dispatchEvent(new host.MessageEvent('message', { origin, source, data }));
    send();
    expect(height).not.toHaveBeenCalled();
    frame.dispatchEvent(new host.Event('load'));
    height.mockClear();
    send('https://example.org');
    send(host.location.origin, other.contentWindow);
    frame.id = 'replaced'; send(); frame.id = 'preview';
    expect(height).not.toHaveBeenCalled();
    send();
    expect(height).toHaveBeenLastCalledWith(120);
    height.mockClear();
    const impostor = host.document.createElement('div');
    impostor.id = 'preview';
    frame.before(impostor);
    // Model the document's ID lookup after a duplicate/replacement wins that ID.
    const lookup = vi.spyOn(host.document, 'getElementById').mockReturnValue(impostor);
    send();
    expect(height).not.toHaveBeenCalled();
    lookup.mockRestore(); impostor.remove();
    frame.contentWindow!.history.replaceState(null, '', '/__specimen?element=navigated'); send();
    expect(height).not.toHaveBeenCalled();
    frame.contentWindow!.history.replaceState(null, '', '/__specimen?element=sample');
    // Navigation can change the source attribute while the old Window is still current.
    const getAttribute = frame.getAttribute.bind(frame);
    const source = vi.spyOn(frame, 'getAttribute').mockImplementation(name => name === 'src' ? '/__specimen?element=new' : getAttribute(name));
    send();
    expect(height).not.toHaveBeenCalled();
    source.mockRestore();
    cleanup();
    frame.dispatchEvent(new host.Event('load')); send();
    expect(height).not.toHaveBeenCalled();
    dom.window.close();
  });

  it('rejects a removed element and resets old dimensions on reload', () => {
    const dom = new JSDOM('<iframe id="preview" src="/__specimen?width=375"></iframe>', { url: 'https://example.com/' });
    const frame = dom.window.document.querySelector('iframe')!;
    Object.defineProperty(frame, 'clientWidth', { value: 375 });
    const target = frame.contentWindow;
    const height = vi.fn();
    const cleanup = observeSpecimenSize(frame, 375, 930, height);
    frame.dispatchEvent(new dom.window.Event('load'));
    dom.window.dispatchEvent(new dom.window.MessageEvent('message', { source: target, origin: 'https://example.com', data: { type: 'clossys:specimen-size', width: 375, height: 90 } }));
    expect(height).toHaveBeenLastCalledWith(90);
    frame.dispatchEvent(new dom.window.Event('load'));
    expect(height).toHaveBeenLastCalledWith(930);
    height.mockClear();
    frame.remove();
    dom.window.dispatchEvent(new dom.window.MessageEvent('message', { source: target, origin: 'https://example.com', data: { type: 'clossys:specimen-size', width: 375, height: 90 } }));
    expect(height).not.toHaveBeenCalled();
    cleanup(); dom.window.close();
  });

  it('re-fits on width changes and rejects a queued observer callback after cleanup', () => {
    let resize = () => {};
    const disconnect = vi.fn();
    vi.stubGlobal('ResizeObserver', class { constructor(callback: () => void) { resize = callback; } observe() {} disconnect = disconnect; });
    const dom = new JSDOM('<iframe id="preview" src="/__specimen"></iframe>', { url: 'https://example.com/' });
    try {
      const frame = dom.window.document.querySelector('iframe')!;
      let width = 640;
      Object.defineProperty(frame, 'clientWidth', { get: () => width });
      const height = vi.fn();
      const cleanup = observeSpecimenSize(frame, 1280, 930, height);
      frame.dispatchEvent(new dom.window.Event('load'));
      dom.window.dispatchEvent(new dom.window.MessageEvent('message', { source: frame.contentWindow, origin: 'https://example.com', data: { type: 'clossys:specimen-size', width: 1280, height: 240 } }));
      expect(height).toHaveBeenLastCalledWith(120);
      width = 320; resize();
      expect(height).toHaveBeenLastCalledWith(60);
      cleanup(); height.mockClear(); resize();
      expect(disconnect).toHaveBeenCalledOnce();
      expect(height).not.toHaveBeenCalled();
    } finally { vi.unstubAllGlobals(); dom.window.close(); }
  });

  it('takes a reflowed frame height unscaled from any width, still capped', () => {
    const reflow = { type: 'clossys:specimen-size', layout: 'reflow', width: 312, height: 180 };
    expect(specimenContentHeight(reflow, 1280, 312, 480)).toBe(180);
    expect(specimenContentHeight({ ...reflow, height: 5000 }, 1280, 312, 480)).toBe(480);
    expect(specimenContentHeight({ ...reflow, height: 0 }, 1280, 312, 480)).toBeUndefined();
  });

  it('holds a card frame behind the stock skeleton at the card aspect until it reports a size', () => {
    const html = renderToStaticMarkup(<BlockViewerCardIframe src="/__specimen?element=sample&width=1280" title="Sample" viewport={1280} iframeKey="sample" loadingLabel="Loading sample"
      wrap={frame => <section data-card-body>{frame}</section>} />);
    const document = new JSDOM(html).window.document;
    const box = document.querySelector('[data-specimen-state="loading"]')!;
    expect(box.parentElement!.hasAttribute('data-card-body')).toBe(true);
    expect(box.className).toContain('aspect-video');
    expect(box.querySelector('[data-slot="skeleton"]')!.getAttribute('aria-label')).toBe('Loading sample');
    const frame = box.querySelector('iframe')!;
    expect(frame.getAttribute('loading')).toBe('lazy');
    expect(frame.className).toContain('opacity-0');
    expect(frame.getAttribute('height')).toBe('480');
    expect(frame.hasAttribute('inert')).toBe(true);
  });
});
