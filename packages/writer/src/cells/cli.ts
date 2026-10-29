import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { activate, propose } from '@clossys/strategist/cell-format';
import { compileWriterCells } from './compile.js';
import { migrateWriterCells } from './migrate.js';
import { parseWriterCell } from './parse.js';

/** Resolve the nearest repository boundary; explicit roots are resolved from cwd. */
export function resolveWriterCellRoot(cwd: string = process.cwd(), override?: string): string {
  if(override)return resolve(cwd,override);
  let directory=resolve(cwd);
  for(;;){if(existsSync(join(directory,'.git')))return join(directory,'clossys','agents','writer');const parent=dirname(directory);if(parent===directory)return join(resolve(cwd),'clossys','agents','writer');directory=parent;}
}
export interface CellsCliIO { out(text: string): void; error(text: string): void }
export async function runCellsCli(argv: string[] = process.argv.slice(2), io: CellsCliIO = { out: text => console.log(text), error: text => console.error(text) }): Promise<void> {
  const args = [...argv];
  const verb=args.shift(); const values:Record<string,string>={}; const flags=new Set<string>(); const refs:string[]=[];
  for(let i=0;i<args.length;i++){
    const arg=args[i]!;
    if(['--check','--write'].includes(arg))flags.add(arg);
    else if(['--root','--out','--from','--to','--format','--confirm'].includes(arg)){const value=args[++i];if(!value||value.startsWith('--'))throw new Error(`Missing value for ${arg}`);values[arg]=value;}
    else if(arg.startsWith('--'))throw new Error(`Unknown option ${arg}`);else refs.push(arg);
  }
  const root=resolveWriterCellRoot(process.cwd(),values['--root']);
  if(verb==='migrate'){
    if(!values['--from'])throw new Error('migrate requires --from <records-directory|envelope.json|library-directory>');
    io.out(JSON.stringify(await migrateWriterCells(resolve(values['--from']),values['--to']?resolve(values['--to']):root)));
  } else if(verb==='compile'||verb==='check'){
    const format=values['--format']??'records';if(format!=='records'&&format!=='library')throw new Error('Expected --format records|library');
    const out=values['--out']?resolve(values['--out']):join(root,'.generated',format==='library'?'library':'records');
    const result=await compileWriterCells(root,out,{check:verb==='check'||flags.has('--check'),write:flags.has('--write'),format});
    io.out(`Writer cells: ${result.cellCount} cells, ${result.recordCount} records, ${Object.keys(result.files).length} outputs.`);
  } else if(verb==='propose'){
    if(refs.length!==1)throw new Error('propose requires one cell id');io.out((await propose(root,refs[0]!)).path);
  } else if(verb==='activate'){
    if(!values['--confirm']||!refs.length)throw new Error('activate requires refs and --confirm');
    await activate(root,refs,{confirm:values['--confirm'],beforeActivate:({cells})=>{
      for(const cell of cells)parseWriterCell(cell.source,cell.path);
    }});
    await compileWriterCells(root,values['--out']??join(root,'.generated','records'));
  } else throw new Error('Usage: cells migrate|compile|check|propose|activate [--root <cell-root>] [--out <output>]');
}
// This compiled entry is included in the installed package's dist/ directory.
if(process.argv[1]&&import.meta.url===new URL(`file://${resolve(process.argv[1])}`).href)runCellsCli().catch(error=>{console.error(error instanceof Error?error.message:String(error));process.exitCode=1;});
