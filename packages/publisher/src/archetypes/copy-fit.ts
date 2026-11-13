/**
 * Copy-fit hook: the interface a renderer implements to report whether bound
 * copy overflows its rendered slot at the three check widths. The conformance
 * check consumes measurements; it never renders. Until a renderer is wired the
 * stub probe returns no measurements and the check reports `not-measured`.
 */
import type { PageRecord } from "./record.js";

export const COPY_FIT_WIDTHS = [375, 768, 1280] as const;
export type CopyFitWidth = (typeof COPY_FIT_WIDTHS)[number];

export interface CopyFitMeasurement {
  readonly page: string;
  /** Section index inside the page record. */
  readonly section: number;
  readonly width: CopyFitWidth;
  /** Content key whose rendered text overflowed, when the renderer can attribute it. */
  readonly key?: string;
  readonly overflow: boolean;
  /** Overflow distance in CSS pixels, when measured. */
  readonly overflowPx?: number;
}

export interface CopyFitProbe {
  /** Render `page` at each width and report every measured slot. */
  measure(page: PageRecord, widths: readonly CopyFitWidth[]): Promise<readonly CopyFitMeasurement[]> | readonly CopyFitMeasurement[];
}

/** Stub probe: measures nothing. Replaced by the preview renderer's probe. */
export const unmeasuredCopyFitProbe: CopyFitProbe = Object.freeze({ measure: () => [] });

/** Run a probe over every record at the three check widths. */
export async function measureCopyFit(records: readonly PageRecord[], probe: CopyFitProbe = unmeasuredCopyFitProbe): Promise<CopyFitMeasurement[]> {
  const out: CopyFitMeasurement[] = [];
  for (const record of records) out.push(...await probe.measure(record, COPY_FIT_WIDTHS));
  return out;
}
