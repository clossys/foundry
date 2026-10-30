'use client';

import { createElement, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { componentSpecimenPreview, NativeSpecimenStateClone, PreviewOutcomeContext, type PreviewFailureReason, type SpecimenComponentStateRequest, type SpecimenNativeViewportRequest } from '@clossys/designer/studio';

/** Studio chrome for live selected fixtures; the specimen section supplies its declared render part. */
export function NativeSpecimenViewport({ Content, leaf, width, expanded, need, children }: SpecimenNativeViewportRequest): ReactNode {
  const container = useRef<HTMLDivElement>(null), probe = useRef<HTMLDivElement>(null), iframe = useRef<HTMLIFrameElement>(null);
  const [body, setBody] = useState<HTMLElement>();
  const [metrics, setMetrics] = useState({ width: 0, scale: 0, height: 0 });

  useEffect(() => {
    const region = container.current, measure = probe.current;
    if (!region || !measure) return;
    const update = () => {
      const measuredWidth = Number.parseFloat(measure.ownerDocument.defaultView!.getComputedStyle(measure).inlineSize);
      const containerWidth = region.clientWidth;
      if (!Number.isFinite(measuredWidth) || measuredWidth <= 0 || containerWidth <= 0) return;
      const scale = containerWidth / measuredWidth;
      setMetrics(previous => previous.width === measuredWidth && previous.scale === scale ? previous : { ...previous, width: measuredWidth, scale });
    };
    update();
    const Observer = region.ownerDocument.defaultView?.ResizeObserver;
    const observer = Observer ? new Observer(update) : undefined;
    observer?.observe(region); observer?.observe(measure);
    region.ownerDocument.defaultView?.addEventListener('resize', update);
    return () => { observer?.disconnect(); region.ownerDocument.defaultView?.removeEventListener('resize', update); };
  }, [width, expanded]);

  useEffect(() => { setBody(undefined); setMetrics(previous => ({ ...previous, height: 0 })); }, [leaf]);

  useEffect(() => {
    if (!body) return;
    const document = body.ownerDocument, view = document.defaultView;
    if (!view) return;
    let alive = true, pending: number | undefined;
    const measureHeight = () => {
      pending = undefined;
      if (!alive) return;
      const root = document.documentElement, frame = view.frameElement as HTMLIFrameElement | null;
      const previousHeight = frame?.height;
      // Remove the previous viewport floor while measuring so live content can shrink as well as grow.
      if (frame) frame.height = '0';
      const height = Math.max(body.scrollHeight, body.offsetHeight, root.scrollHeight, root.offsetHeight);
      if (frame && previousHeight !== undefined) frame.height = previousHeight;
      if (Number.isFinite(height) && height > 0) setMetrics(previous => previous.height === height ? previous : { ...previous, height });
    };
    const schedule = () => { if (pending === undefined) pending = view.requestAnimationFrame(measureHeight); };
    const observedBoxes = new WeakMap<Element, { width: number; height: number }>();
    const observer = typeof view.ResizeObserver === 'function' ? new view.ResizeObserver(entries => {
      let changed = false;
      for (const entry of entries) {
        const previous = observedBoxes.get(entry.target), { width, height } = entry.contentRect;
        if (!previous || previous.width !== width || previous.height !== height) {
          observedBoxes.set(entry.target, { width, height }); changed = true;
        }
      }
      // Ignore unchanged final boxes after the synchronous viewport-floor reset.
      if (changed) schedule();
    }) : undefined;
    observer?.observe(body);
    const mutations = new view.MutationObserver(schedule);
    mutations.observe(body, { subtree: true, childList: true, attributes: true, characterData: true });
    document.addEventListener('load', schedule, true);
    document.fonts?.addEventListener('loadingdone', schedule);
    void document.fonts?.ready.then(() => { if (alive) schedule(); });
    schedule();
    return () => {
      alive = false;
      if (pending !== undefined) view.cancelAnimationFrame(pending);
      observer?.disconnect(); mutations.disconnect();
      document.removeEventListener('load', schedule, true);
      document.fonts?.removeEventListener('loadingdone', schedule);
    };
  }, [body]);

  useEffect(() => {
    if (!body) return;
    const document = body.ownerDocument, owner = container.current?.ownerDocument;
    if (!owner) return;
    const synchronize = () => {
      document.head.replaceChildren(...Array.from(owner.querySelectorAll('style,link[rel="stylesheet"]'), node => node.cloneNode(true)));
      for (const attribute of Array.from(document.documentElement.attributes)) if (!owner.documentElement.hasAttribute(attribute.name)) document.documentElement.removeAttribute(attribute.name);
      for (const attribute of Array.from(owner.documentElement.attributes)) document.documentElement.setAttribute(attribute.name, attribute.value);
      body.className = owner.body.className; body.style.margin = '0';
    };
    synchronize();
    const Observer = owner.defaultView!.MutationObserver;
    const attributes = new Observer(synchronize), styles = new Observer(synchronize);
    attributes.observe(owner.documentElement, { attributes: true }); attributes.observe(owner.body, { attributes: true, attributeFilter: ['class'] });
    styles.observe(owner.head, { subtree: true, childList: true, attributes: true, characterData: true });
    return () => { attributes.disconnect(); styles.disconnect(); };
  }, [body]);

  const load = (frame: HTMLIFrameElement) => {
    if (frame !== iframe.current || !frame.isConnected) return;
    const document = frame.contentDocument; if (!document) return;
    document.head.replaceChildren(...Array.from(frame.ownerDocument.querySelectorAll('style,link[rel="stylesheet"]'), node => node.cloneNode(true)));
    for (const attribute of Array.from(frame.ownerDocument.documentElement.attributes)) document.documentElement.setAttribute(attribute.name, attribute.value);
    document.body.className = frame.ownerDocument.body.className; document.body.style.margin = '0';
    setBody(document.body);
  };
  return <Content as="div" ref={container} data-specimen-viewport={metrics.width || undefined} className={leaf.startsWith('frames.') ? 'max-w-full overflow-auto' : 'max-w-full overflow-hidden'}>
    <Content as="div" ref={probe} aria-hidden="true" inert style={{ inlineSize: width, position: 'absolute', visibility: 'hidden', blockSize: 0, overflow: 'hidden' }} />
    {!body || !metrics.height ? <Content as="div" data-ds-specimen-need="true">{need({ leaf, reason: 'The selected viewport has not mounted its live fixture.' })}</Content> : null}
    {metrics.width > 0 ? <Content as="div" style={{ inlineSize: metrics.width, zoom: metrics.scale }}>
      <iframe key={leaf} ref={iframe} title={`${leaf} ${metrics.width}px specimen`} width={metrics.width} height={metrics.height} sandbox="allow-same-origin" tabIndex={-1} srcDoc="<!doctype html><html><head></head><body></body></html>" onLoad={event => load(event.currentTarget)} style={{ border: 0, display: 'block', pointerEvents: 'none' }} />
      {body ? createPortal(<Content as="div" inert data-ds-leaf="components.semantic-content" data-designer-specimen-frame={leaf}>{children(metrics.width)}</Content>, body) : null}
    </Content> : null}
  </Content>;
}

/** The declared callback keeps the moved host's React hook lifecycle inside its component boundary. */
export function renderNativeSpecimenViewport(input: SpecimenNativeViewportRequest): ReactNode {
  return createElement(NativeSpecimenViewport, input);
}

/** Actual selected component preview and native state capture live inside this Studio hook boundary. */
export function NativeSpecimenComponentState({ Content, context, leaf, members, state, props, interactive, unavailable }: SpecimenComponentStateRequest): ReactNode {
  const [failed, report] = useState<PreviewFailureReason>();
  if (context.componentPreviewNeeds?.[leaf]) return unavailable(context.componentPreviewNeeds[leaf]!);
  const preview = componentSpecimenPreview({ ...context.componentOptions, modules: context.modules });
  const selected = preview.bind(leaf, context.profile);
  if ('refusal' in selected) return unavailable(selected.refusal.detail);
  if (interactive !== (state === 'default')) return unavailable('The selected component preview has inconsistent interaction data.');
  const selectedMembers = [...members, ...(state === 'default' ? [] : [state])].map(id => selected.binding.members.find(member => member.member === id));
  if (selectedMembers.some(member => !member || !member.interaction && !Object.keys(member.props).length)) return unavailable('The selected component preview has no executable registered member binding.');
  const intrinsic = selectedMembers.find(member => member?.interaction);
  const node = componentSpecimenPreview({ ...context.componentOptions, restOnly: true, modules: context.modules, probes: { [leaf]: { props } } }).preview(leaf, context.profile);
  let content: ReactNode;
  if (intrinsic) {
    const interaction = intrinsic.member.startsWith('state.') ? intrinsic.member.slice('state.'.length) : intrinsic.member;
    if (interaction !== 'hover' && interaction !== 'focus-visible' && interaction !== 'pressed') return unavailable(`No native interaction capture for ${intrinsic.member}.`);
    content = <NativeSpecimenStateClone Content={Content} state={interaction} unavailable={unavailable}>{node}</NativeSpecimenStateClone>;
  } else content = <Content as="div" data-specimen-state={state} inert={interactive ? undefined : true}>{node}</Content>;
  return <PreviewOutcomeContext.Provider value={report}>{failed ? <Content as="div" data-ds-specimen-need="true">{unavailable(failed)}</Content> : null}{content}</PreviewOutcomeContext.Provider>;
}

/** Declared callback identity for both live defaults and descriptor-mapped state previews. */
export function renderNativeSpecimenComponentState(input: SpecimenComponentStateRequest): ReactNode {
  return createElement(NativeSpecimenComponentState, { ...input, key: `${input.context.profile.selectionHash}:${input.leaf}:${input.members.join('/')}:${input.state}` });
}
