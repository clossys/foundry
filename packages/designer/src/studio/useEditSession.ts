import { useSyncExternalStore } from "react";
import { EditSession, type EditSessionState } from "./edit-session.js";
const noopSubscribe = () => () => {};
const noSnapshot = () => undefined;
export function useEditSession<S, O, C extends { baseHash: string }>(session: EditSession<S, O, C> | undefined): EditSessionState<S, O> | undefined {
  return useSyncExternalStore(session?.subscribe ?? noopSubscribe, session?.getSnapshot ?? noSnapshot, session?.getSnapshot ?? noSnapshot);
}
