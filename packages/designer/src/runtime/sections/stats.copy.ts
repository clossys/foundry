import { resolveShellCopy, type ShellCopyRef, type ShellCopyResolver } from "../../components/Banner.copy.js";
import type { StatsCopy } from "./stats.js";

const ref = (id: string): ShellCopyRef => Object.freeze({ id });

/** Stable Writer references for the sections.stats host port; the host owns locale, approval and formatting. */
export const STATS_COPY_REFS = Object.freeze({
  trendLabels: Object.freeze({ up: ref("st.v10qsmk2ct"), down: ref("st.ywh594tsp1"), neutral: ref("st.r2jc8zrsq6") }),
  states: Object.freeze({ loading: ref("st.429fbaqy3e"), empty: ref("st.56fr0nsdzn"), error: ref("st.yk0xxww16p") }),
});

/**
 * Builds the statsCopy host port from the host's Writer resolver and the
 * section's own content label. A missing resolver or unresolved id throws the
 * named shell copy error; nothing supplies a label in its place.
 */
export function statsCopyFrom(resolver: ShellCopyResolver | undefined, label: string): StatsCopy {
  const text = (reference: ShellCopyRef) => resolveShellCopy(resolver, reference);
  const { trendLabels, states } = STATS_COPY_REFS;
  return {
    label,
    trendLabels: { up: text(trendLabels.up), down: text(trendLabels.down), neutral: text(trendLabels.neutral) },
    states: { loading: { label: text(states.loading) }, empty: { label: text(states.empty) }, error: { label: text(states.error) } },
  };
}
