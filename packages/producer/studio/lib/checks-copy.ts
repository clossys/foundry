import type { CheckRow, ChecksCopy } from '../sections/studio-checks';
import { studioCopy } from './studio-copy';

/** Preserve the section's summary wording with plain string interpolation for counts. */
export function checksCopy(rows: readonly CheckRow[]): ChecksCopy {
  const failing = rows.filter(row => !row.ok).length;
  return {
    title: studioCopy('studio.checks-title'),
    summary: failing
      ? studioCopy('studio.checks-findings', { count: String(rows.length), failing: String(failing) })
      : studioCopy('studio.checks-all-pass', { count: String(rows.length) }),
    check: studioCopy('studio.checks-check'),
    result: studioCopy('studio.checks-result'),
    detail: studioCopy('studio.checks-detail'),
    pass: studioCopy('studio.checks-pass'),
    finding: studioCopy('studio.checks-finding'),
  };
}
