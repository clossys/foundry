import { resolveStrategyRoot } from '../strategy-dir-default.js';
import { planReview } from '../loop.js';
import type { DirectorStore } from '../store-io.js';
import { persistReport } from './reports.js';

export const REVIEW_USAGE = 'Usage: clossys director check review [--root <dir>] [--today <YYYY-MM-DD>] [--write] [--json]\n  --write saves the plan to reports/review.json in the Director output folder (<consumer>/evidence/director/ for the flat store); without it review writes nothing.';
/** Review plans requests and prints them. The slot model stores no requests; --write saves the plan as the review report only. */
export function runReviewCli(argv: string[], store: DirectorStore): number {
  const json = argv.includes('--json');
  const write = argv.includes('--write');
  try {
    const flags = new Map<string,string>();
    for (let i=0; i<argv.length; i++) {
      const flag=argv[i]!;
      if (flag === '--help') { console.log(REVIEW_USAGE); return 0; }
      if (flag === '--json' || flag === '--write') continue;
      if (!['--root','--today'].includes(flag) || flags.has(flag)) throw new Error(`Unknown or duplicate option ${flag}`);
      const value=argv[++i];
      if (!value || value.startsWith('--')) throw new Error(`Missing value for ${flag}`);
      flags.set(flag,value);
    }
    const root=resolveStrategyRoot(flags.get('--root'));
    const result=planReview(root,store.reader,{today:flags.get('--today')});
    if (write && !result.issues.length) persistReport(root,store.writer,'review',result);
    console.log(JSON.stringify(result,null,json ? undefined : 2));
    return result.issues.length ? 2 : result.requests.length ? 1 : 0;
  } catch (error) {
    const message=error instanceof Error ? error.message : String(error);
    if (json) console.log(JSON.stringify({error:message})); else console.error(`clossys director check: ${message}`);
    return 2;
  }
}
