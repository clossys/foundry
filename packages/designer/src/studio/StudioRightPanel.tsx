"use client";
import { Button } from "../components/Button.js";
import { Scorecard } from "./Scorecard.js";
import { useStudioSession } from "./StudioProvider.js";
import { WholeStudioRightPanel, useWholeStudio } from "./WholeStudio.js";
/** Body only. The host frame owns opening, containment, modal plane and push behavior. */
export function StudioRightPanel() {
  const whole = useWholeStudio();
  const state = useStudioSession();
  if (whole) return <WholeStudioRightPanel />;
  if (!state.ready || !state.summary) return null;
  return <><Button variant="ghost" aria-expanded={state.scoreOpen} onPress={() => state.setScoreOpen(open => !open)}>{state.labels.scorecard.title}</Button>
    {state.scoreOpen ? <Scorecard summary={state.summary} labels={state.labels} onClose={state.closeScore} onIssue={id => state.onNavigate({ layer: state.layer, leaf: id })} /> : null}
  </>;
}
