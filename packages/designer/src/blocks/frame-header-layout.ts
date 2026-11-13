/** Measure intrinsic content, rather than selecting a viewport breakpoint. Equal side columns keep nav on stage center. */
export function frameHeaderOverflow(available: number, title: number, nav: number, actions: number, compactActions: number, gap: number) {
  const side = Math.max(0, (available - nav - gap * 2) / 2);
  const compact = actions > side || title > side;
  return { compactActions: compact, compactNav: nav > available || Math.max(title, compact ? compactActions : actions) > side };
}
