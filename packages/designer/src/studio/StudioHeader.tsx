"use client";
import { WholeStudioHeader, useWholeStudio } from "./WholeStudio.js";
import { StudioTopBar } from "./StudioTopBar.js";
import { useStudioSession } from "./StudioProvider.js";
import { STUDIO_LAYERS, studioLayerHref } from "./layer-navigation.js";
import type { StudioHeaderProps } from "./types.js";
function LegacyStudioHeader({ className, layerHref, onLayerNavigate }: StudioHeaderProps = {}) {
  const state = useStudioSession();
  if (!state.ready) return null;
  return <div className={className} data-studio-header=""><StudioTopBar layer={state.layer} layers={state.layers} onLayer={state.setLayer} labels={state.labels} layerHref={layerHref} onLayerNavigate={onLayerNavigate} /></div>;
}
export function StudioHeader(props: StudioHeaderProps = {}) {
  return useWholeStudio() ? <WholeStudioHeader className={props.className} layerHref={props.layerHref} onLayerNavigate={props.onLayerNavigate} /> : <LegacyStudioHeader className={props.className} layerHref={props.layerHref} onLayerNavigate={props.onLayerNavigate} />;
}

/** Data for a host frame. Link activation must still await the host's Studio flush boundary. */
export function useStudioNavigation({ layerHref = studioLayerHref }: Pick<StudioHeaderProps, "layerHref"> = {}) {
  const state = useStudioSession();
  const whole = useWholeStudio();
  const labels = whole?.labels ?? state.labels;
  const layers = whole ? STUDIO_LAYERS : state.layers;
  return { label: labels.layers.label, items: STUDIO_LAYERS.filter(id => layers.includes(id)).map(id => ({ id, label: labels.layers[id], href: layerHref(id) })), activeId: whole?.layer ?? state.layer };
}
