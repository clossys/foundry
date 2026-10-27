"use client";
import { useCallback } from "react";
import type { LayerId } from "../../catalog-core/index.js";
import type { UsageGraph } from "../../catalog-core/usage-graph.js";
import { useOptionalStudioSession } from "../StudioProvider.js";
import { useWholeStudio } from "../WholeStudioProvider.js";
import { useUsageData, type UsageData } from "./committed-graph.js";
import { UsagePanel, type UsagePanelLabels } from "./UsagePanel.js";
import type { UsageHistory } from "./useUsageNavigation.js";

const STUDIO_LAYERS: readonly LayerId[] = ["tokens", "assets", "components", "sections", "frames"];
const VALUE_LAYERS: ReadonlySet<LayerId> = new Set(["tokens", "assets"]);
const layerOf = (id: string): LayerId | undefined => STUDIO_LAYERS.find(layer => id.startsWith(layer + "."));

/** One back stack per Studio session, so it survives the value and contract inspectors swapping on a tab change. */
const histories = new WeakMap<object, UsageHistory>();
function historyFor(session: object | undefined): UsageHistory | undefined {
  if (!session) return undefined;
  let history = histories.get(session);
  if (!history) histories.set(session, history = { stack: [] });
  return history;
}

/** The Studio's usage graph: the caller's, else the host snapshot's, else the committed Foundry graph. */
export function useStudioUsageData(graph?: UsageGraph, enabled = true): UsageData | undefined {
  const whole = useWholeStudio();
  return useUsageData(graph ?? whole?.snapshot?.usageGraph, enabled);
}

/**
 * The Usage area mounted in a Studio inspector. Navigation is the Studio's own: a row switches the layer tab
 * and selects that element; an element with no Studio tab (a page) renders as text.
 */
export function StudioUsage({ id, labels, graph }: { id: string; labels: UsagePanelLabels; graph?: UsageGraph }) {
  const whole = useWholeStudio(), session = useOptionalStudioSession();
  const data = useStudioUsageData(graph);
  const layers = whole ? STUDIO_LAYERS : session?.layers ?? [];
  const canNavigate = useCallback((target: string) => { const layer = layerOf(target); return Boolean(layer && layers.includes(layer)); }, [layers]);
  const setLayer = session?.setLayer, setLeaf = whole?.setLeaf, setSlotId = session?.setSlotId, setFocusedCell = session?.setFocusedCell, actions = session?.canvasActions;
  const navigate = useCallback((target: string) => {
    const layer = layerOf(target);
    if (!layer || !setLayer) return;
    void setLayer(layer).then(changed => {
      if (!changed) return;
      if (setLeaf && !VALUE_LAYERS.has(layer)) { setLeaf(target); return; }
      setSlotId?.(target); setFocusedCell?.({ row: target });
      actions?.current?.reveal(target, true);
    });
  }, [setLayer, setLeaf, setSlotId, setFocusedCell, actions]);
  return <UsagePanel id={id} labels={labels} onNavigate={navigate} canNavigate={canNavigate} history={historyFor(actions)}
    {...(data ? { graph: data.graph } : {})} {...(data?.exceptions ? { exceptions: data.exceptions } : {})} />;
}
