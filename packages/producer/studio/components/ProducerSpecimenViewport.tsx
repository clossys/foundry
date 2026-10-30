'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { componentSpecimenPreview, type DesignerSpecimenContext, type DesignerSpecimenNeed } from '@clossys/designer/studio';

/** Studio owns the browsing context; the registered section owns its contents. */
export function ProducerSpecimenViewport({ context, leaf, width, expanded, need, children }: {
  context: DesignerSpecimenContext;
  leaf: string;
  width: number;
  expanded?: boolean;
  need: (need: DesignerSpecimenNeed) => ReactNode;
  children: ReactNode;
}): ReactNode {
  const container = useRef<HTMLElement>(null);
  const [body, setBody] = useState<HTMLElement>();
  const [availableWidth, setAvailableWidth] = useState(0);
  const [height, setHeight] = useState(0);
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const measure = () => setAvailableWidth(element.getBoundingClientRect().width);
    measure();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : undefined;
    observer?.observe(element);
    window.addEventListener('resize', measure);
    return () => { observer?.disconnect(); window.removeEventListener('resize', measure); };
  }, [context.modules, context.profile.components.selectionHash]);
  useEffect(() => {
    if (!body) return;
    const measure = () => setHeight(Math.max(body.scrollHeight, body.offsetHeight));
    measure();
    const resize = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : undefined;
    resize?.observe(body); resize?.observe(body.ownerDocument.documentElement);
    const mutation = new MutationObserver(measure);
    mutation.observe(body, { childList: true, subtree: true, attributes: true, characterData: true });
    body.addEventListener('load', measure, true);
    body.ownerDocument.fonts?.addEventListener('loadingdone', measure);
    return () => { resize?.disconnect(); mutation.disconnect(); body.removeEventListener('load', measure, true); body.ownerDocument.fonts?.removeEventListener('loadingdone', measure); };
  }, [body, children]);
  const selected = componentSpecimenPreview({ modules: context.modules }).bind('components.semantic-content', context.profile);
  if ('refusal' in selected) return need({ leaf: 'components.semantic-content', reason: selected.refusal.detail });
  if (!Number.isFinite(width) || width <= 0) return need({ leaf, reason: 'The selected viewport width is unavailable.' });
  const Content = selected.binding.Component;
  const load = (element: HTMLIFrameElement) => {
    const document = element.contentDocument;
    if (!document) return;
    document.head.replaceChildren(...Array.from(element.ownerDocument.querySelectorAll('style,link[rel="stylesheet"]'), node => node.cloneNode(true)));
    for (const attribute of Array.from(element.ownerDocument.documentElement.attributes)) document.documentElement.setAttribute(attribute.name, attribute.value);
    document.body.className = element.ownerDocument.body.className;
    document.body.style.margin = '0';
    setBody(document.body);
  };
  const scale = expanded ? 1 : availableWidth > 0 ? Math.min(1, availableWidth / width) : 1;
  return <Content as="div" ref={container} data-specimen-viewport={width} className={leaf.startsWith('frames.') ? 'max-w-full overflow-auto' : 'max-w-full overflow-hidden'}>
    {!body ? <Content as="div" data-ds-specimen-need="true">{need({ leaf, reason: 'The selected viewport has not mounted its live fixture.' })}</Content> : null}
    <Content as="div" style={{ inlineSize: width, zoom: scale }}>
      <iframe title={`${leaf} ${width}px specimen`} width={width} height={height} sandbox="allow-same-origin" tabIndex={-1} srcDoc="<!doctype html><html><head></head><body></body></html>" onLoad={event => load(event.currentTarget)} style={{ border: 0, display: 'block', pointerEvents: 'none' }} />
      {body ? createPortal(<Content as="div" inert data-ds-leaf="components.semantic-content" data-designer-specimen-frame={leaf}>{children}</Content>, body) : null}
    </Content>
  </Content>;
}
