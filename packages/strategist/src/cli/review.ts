import { resolveStrategyRoot } from '../strategy-dir-default.js';
import { review } from '../loop.js';

export const REVIEW_USAGE = 'Usage: strategist-check review [--root <dir>] [--today <YYYY-MM-DD>] [--json]';
/** Review can persist requests; it never confirms or activates a cell. */
export function runReviewCli(argv: string[]): number {
  const json = argv.includes('--json');
  try {
    const flags = new Map<string,string>();
    for (let i=0; i<argv.length; i++) {
      const flag=argv[i]!;
      if (flag === '--help') { console.log(REVIEW_USAGE); return 0; }
      if (flag === '--json') continue;
      if (!['--root','--today'].includes(flag) || flags.has(flag)) throw new Error(`Unknown or duplicate option ${flag}`);
      const value=argv[++i];
      if (!value || value.startsWith('--')) throw new Error(`Missing value for ${flag}`);
      flags.set(flag,value);
    }
    const result=review(resolveStrategyRoot(flags.get('--root')),{today:flags.get('--today')});
    console.log(JSON.stringify(result,null,json ? undefined : 2));
    return result.issues.length ? 2 : result.created.length ? 1 : 0;
  } catch (error) {
    const message=error instanceof Error ? error.message : String(error);
    if (json) console.log(JSON.stringify({error:message})); else console.error(`strategist-check: ${message}`);
    return 2;
  }
}
