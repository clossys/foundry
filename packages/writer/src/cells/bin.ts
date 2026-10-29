#!/usr/bin/env node
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCellsCli, type CellsCliIO } from './cli.js';

const USAGE = `Usage: writer-cells <migrate|compile|check|propose|activate> --root <cell-root>
  migrate --from <records-directory|envelope.json|library-directory>
  compile|check [--out <output>] [--format records|library] [--check|--write]
  propose <cell-id>
  activate <cell-id@version...> --confirm <ref> [--out <output>]
Exit codes: 0 = success, 1 = findings or drift, 2 = usage.
`;
const defaultIO: CellsCliIO = { out: text => console.log(text), error: text => console.error(text) };

function validate(argv: readonly string[]): void {
  const [verb, ...args] = argv;
  const options: Record<string, readonly string[]> = {
    migrate: ['--root', '--from'],
    compile: ['--root', '--out', '--format', '--check', '--write'],
    check: ['--root', '--out', '--format', '--check'],
    propose: ['--root'],
    activate: ['--root', '--out', '--confirm'],
  };
  if (!verb || !Object.hasOwn(options, verb)) throw new Error('A known command is required');
  const values = new Map<string, string>(), flags = new Set<string>(), refs: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (!arg.startsWith('-')) { refs.push(arg); continue; }
    if (!options[verb]!.includes(arg)) throw new Error(`Unknown option ${arg} for ${verb}`);
    if (values.has(arg) || flags.has(arg)) throw new Error(`Duplicate ${arg}`);
    if (arg === '--check' || arg === '--write') { flags.add(arg); continue; }
    const value = args[++i];
    if (!value || value.startsWith('-')) throw new Error(`${arg} requires a value`);
    values.set(arg, value);
  }
  if (!values.has('--root')) throw new Error('--root is required');
  if (flags.has('--check') && flags.has('--write')) throw new Error('--check and --write are mutually exclusive');
  if (values.has('--format') && !['records', 'library'].includes(values.get('--format')!)) throw new Error('Expected --format records|library');
  if (verb === 'migrate' && !values.has('--from')) throw new Error('migrate requires --from');
  if (verb === 'propose' ? refs.length !== 1 : verb === 'activate' ? !refs.length || !values.has('--confirm') : refs.length !== 0) {
    throw new Error(verb === 'propose' ? 'propose requires one cell id' : verb === 'activate' ? 'activate requires refs and --confirm' : 'Unexpected positional argument');
  }
}

/** Installed shell boundary; validate all arguments before authoring starts. */
export async function main(argv: string[], io: CellsCliIO = defaultIO): Promise<number> {
  if (argv.length === 1 && ['--help', '-h'].includes(argv[0]!)) { io.out(USAGE); return 0; }
  try { validate(argv); }
  catch (error) { io.error(`writer-cells: ${error instanceof Error ? error.message : String(error)}\n${USAGE}`); return 2; }
  try { await runCellsCli(argv, io); return 0; }
  catch (error) { io.error(`writer-cells: ${error instanceof Error ? error.message : String(error)}`); return 1; }
}

const argvPath = process.argv[1];
if (argvPath) {
  let isMain = false;
  try { isMain = realpathSync(resolve(argvPath)) === realpathSync(fileURLToPath(import.meta.url)); } catch { /* Imports never invoke the bin. */ }
  if (isMain) process.exitCode = await main(process.argv.slice(2));
}
