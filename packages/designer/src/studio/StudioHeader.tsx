"use client";

import { UI_Z_POPOVER } from "../atoms/internal/ui-vars.js";
import { TOKENS } from "../tokens/tokens.js";
import { Scorecard } from "./Scorecard.js";
import { StudioTopBar } from "./StudioTopBar.js";
import { useStudioSession } from "./StudioProvider.js";
import type { StudioHeaderProps } from "./types.js";

/** The complete header unit can live inside a host AppFrame without a second Studio session. */
export function StudioHeader({ className }: StudioHeaderProps = {}) {
  const state = useStudioSession();
  if (!state.ready || !state.summary) return null;
  return <div className={className} data-studio-header="" style={{ position: "relative" }}>
    <StudioTopBar labels={state.labels} pending={state.pendingCount} canSave={state.adapter.canSave} saving={state.saving} summary={state.summary} scoreOpen={state.scoreOpen}
      onScore={target => { state.scoreTrigger.current = target; state.setScoreOpen(current => !current); }} onSave={() => { void state.save(); }} onDiscard={state.discard}>
      {state.scoreOpen ? <div data-studio-panel="scorecard" style={{ position: "absolute", insetBlockStart: "100%", insetInlineStart: 0, inlineSize: "100%", maxBlockSize: `calc(var(--ui-layout-aside-w, ${TOKENS["--ui-layout-aside-w"]!.value}) * 2)`, overflowY: "auto", zIndex: UI_Z_POPOVER }}>
        <Scorecard summary={state.summary} labels={state.labels} onClose={state.closeScore} onIssue={id => state.canvasActions.current?.reveal(id, true)} />
      </div> : null}
    </StudioTopBar>
  </div>;
}
