'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AgentCells } from '../lib/cells-client';
import { projectStudioAgentIA, studioIAAnchor, studioIABreadcrumb } from '../lib/studio-agent-ia';

export function useStudioIASelection(index: AgentCells | undefined, initialCell?: string) {
  const ia = useMemo(() => index ? projectStudioAgentIA(index) : undefined, [index]);
  const [selectedId, setSelectedId] = useState<string | undefined>(initialCell);
  const [activeNodeId, setActiveNodeId] = useState<string | undefined>();
  const known = useMemo(() => new Set(ia ? [ia.id, ...ia.groups.flatMap(group => [group.id, ...group.collections.flatMap(collection => [collection.id, ...collection.cells.map(cell => cell.id)])])] : []), [ia]);
  const setHash = useCallback((id: string) => { const url = new URL(window.location.href); url.searchParams.delete('cell'); url.searchParams.delete('agent'); url.hash = studioIAAnchor(id); window.history.replaceState(null, '', url); }, []);
  const selectNode = useCallback((id: string) => {
    if (!known.has(id)) return;
    setActiveNodeId(id);
    if (index?.cells.some(cell => cell.id === id)) setSelectedId(id);
    setHash(id);
    document.getElementById(studioIAAnchor(id))?.scrollIntoView({ block: 'start' });
  }, [index, known, setHash]);
  useEffect(() => {
    setSelectedId(initialCell && index?.cells.some(cell => cell.id === initialCell) ? initialCell : undefined);
    const fromHash = () => { try { const anchor = decodeURIComponent(window.location.hash.slice(1)); const id = [...known].find(id => studioIAAnchor(id) === anchor); if (id) selectNode(id); } catch { /* Unknown hashes cannot select a cell. */ } };
    setActiveNodeId(ia?.id);
    fromHash();
    window.addEventListener('hashchange', fromHash);
    return () => window.removeEventListener('hashchange', fromHash);
  }, [ia, initialCell, index, known, selectNode]);
  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const anchors = [...document.querySelectorAll<HTMLElement>('[data-studio-ia-node]')].filter(node => known.has(node.dataset.studioIaNode ?? ''));
      const main = anchors[0]?.closest('main');
      const start = Math.max(0, main?.getBoundingClientRect().top ?? 0);
      const measured = anchors.map(node => ({ node, bounds: (node.tagName === 'A' ? node.closest('li') ?? node : node).getBoundingClientRect() }));
      const visible = measured.filter(({ bounds }) => bounds.bottom > start && bounds.top < window.innerHeight);
      const current = visible.filter(({ bounds }) => bounds.top <= start).at(-1) ?? visible[0];
      const id = current?.node.dataset.studioIaNode;
      if (id) { setActiveNodeId(id); setHash(id); }
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
    document.addEventListener('scroll', schedule, true);
    return () => { document.removeEventListener('scroll', schedule, true); cancelAnimationFrame(frame); };
  }, [known, setHash]);
  return { ia, selectedId, activeNodeId, selectNode, breadcrumb: ia ? studioIABreadcrumb(ia, activeNodeId) : undefined };
}
