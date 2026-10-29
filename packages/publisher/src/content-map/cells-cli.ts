#!/usr/bin/env node
import { realpathSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileContentMaps } from './cells.js';

const USAGE = `Usage: publisher-cells <compile|check> --root <cell-root> [--agent-root <dir|agent=dir>]... [--check|--write]
Plain agent directories use their directory name as the agent identity.
Exit codes: 0 = success, 1 = findings or drift, 2 = usage.
`;
export interface CellsCliIO { out(text: string): void; error(text: string): void }
const defaultIO: CellsCliIO = { out: text => console.log(text), error: text => console.error(text) };

function parse(argv: readonly string[]): { root: string; check: boolean; agentRoots: Record<string, string> } {
  const [verb, ...args] = argv;
  if (verb !== 'compile' && verb !== 'check') throw new Error('A known command is required');
  let root: string | undefined;
  const flags = new Set<string>(), agentRoots: Record<string, string> = Object.create(null);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === '--check' || arg === '--write') {
      if (flags.has(arg)) throw new Error(`Duplicate ${arg}`);
      flags.add(arg); continue;
    }
    if (arg !== '--root' && arg !== '--agent-root') throw new Error(`Unknown option ${arg}`);
    const value = args[++i];
    if (!value || value.startsWith('-')) throw new Error(`${arg} requires a value`);
    if (arg === '--root') {
      if (root !== undefined) throw new Error('Duplicate --root');
      root = resolve(value);
    } else {
      const equals = value.indexOf('='), path = equals < 0 ? value : value.slice(equals + 1);
      const agent = equals < 0 ? basename(resolve(path)) : value.slice(0, equals);
      if (!path || !/^[a-z][a-z0-9-]*$/.test(agent)) throw new Error('--agent-root requires a named agent directory or agent=dir');
      if (Object.hasOwn(agentRoots, agent)) throw new Error(`Duplicate agent root ${agent}`);
      agentRoots[agent] = resolve(path);
    }
  }
  if (!root) throw new Error('--root is required');
  const check = verb === 'check' || flags.has('--check');
  if (check && flags.has('--write')) throw new Error('--check and --write are mutually exclusive');
  return { root, check, agentRoots };
}

/** Testable shell entry; linked agent roots are read-only inputs. */
export async function main(argv: string[], io: CellsCliIO = defaultIO): Promise<number> {
  if (argv.length === 1 && ['--help', '-h'].includes(argv[0]!)) { io.out(USAGE); return 0; }
  let args: ReturnType<typeof parse>;
  try { args = parse(argv); }
  catch (error) { io.error(`publisher-cells: ${error instanceof Error ? error.message : String(error)}\n${USAGE}`); return 2; }
  try {
    const result = await compileContentMaps(args.root, { check: args.check, agentRoots: args.agentRoots });
    for (const finding of result.findings) io.error(`${finding.severity}: ${finding.message}`);
    io.out(`Publisher cells: ${result.maps.length} content maps, ${result.findings.length} findings.`);
    return result.findings.length ? 1 : 0;
  } catch (error) { io.error(`publisher-cells: ${error instanceof Error ? error.message : String(error)}`); return 1; }
}

const argvPath = process.argv[1];
if (argvPath) {
  let isMain = false;
  try { isMain = realpathSync(resolve(argvPath)) === realpathSync(fileURLToPath(import.meta.url)); } catch { /* Imports never invoke the bin. */ }
  if (isMain) process.exitCode = await main(process.argv.slice(2));
}
