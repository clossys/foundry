import { runCli } from '../cli/main.js';
import type { AgentKind } from '../agents.js';

const CHECK_VERBS = { director: 'direct', designer: 'design', writer: 'write', publisher: 'publish' } as const;
/** The CLI exit contract: 0 clean, 1 findings, 2 could not run. */
const STATE = { 0: 'pass', 1: 'findings', 2: 'unavailable' } as const;

/** Fixed read-only invocations only: each agent's `--check` (bare `publish` is its dry run). */
export async function studioChecks(root: string, agent?: AgentKind) {
  const agents = agent ? [agent] : Object.keys(CHECK_VERBS) as AgentKind[];
  const results = await Promise.all(agents.map(async agent => {
    const verb = CHECK_VERBS[agent];
    const argv = verb === 'publish' ? [verb, '--json', '--root', root] : [verb, '--check', '--json', '--root', root];
    const result = await runCli(argv, root);
    const state = STATE[result.exitCode as keyof typeof STATE] ?? 'unavailable';
    return { agent, verb, state, exitCode: result.exitCode, message: result.message };
  }));
  return { state: 'ready' as const, results };
}
