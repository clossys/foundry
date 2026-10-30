import { runCli } from '../cli/main.js';
import type { AgentKind } from '../agents.js';

const CHECK_VERBS = { director: 'direct', designer: 'design', writer: 'write', publisher: 'publish' } as const;
/** Fixed read-only invocations only. Current CLI stubs are unavailable, never green findings. */
export async function studioChecks(root: string, agent?: AgentKind) {
  const agents = agent ? [agent] : Object.keys(CHECK_VERBS) as AgentKind[];
  const results = await Promise.all(agents.map(async agent => {
    const verb = CHECK_VERBS[agent];
    const result = await runCli([verb, '--check', '--json', '--root', root], root);
    return { agent, verb, state: result.exitCode === 2 ? 'unavailable' as const : 'error' as const, exitCode: result.exitCode,
      message: result.exitCode === 2 ? result.message : 'The check command has no structured findings adapter in this build.' };
  }));
  return { state: 'ready' as const, results };
}
