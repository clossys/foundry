import { lstat, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, parse, resolve, sep, win32 } from 'node:path';
import { cellPath, isoDate } from '@clossys/strategist/cell-format';
import { serializeWriterCell, writerCellId, type WriterCell, type JsonRecord } from './parse.js';

export type RecordPointer = [cellId: string, locale: string, recordId: string];
export interface CompileFile {
  path: string; kind: 'envelope' | 'skeleton' | 'array'; header: JsonRecord;
  order: RecordPointer[]; bindingOrder: ([string, number] | JsonRecord)[];
  keys?: string[]; skeleton?: unknown; hasBindings?: boolean;
}
export interface CompileManifest {
  schemaVersion: 1; generated: string; files: CompileFile[];
  passthrough: {path: string; value: unknown}[];
}
export const canonical = (value: unknown): string => JSON.stringify(value, null, 2) + '\n';
export const isObject = (v: unknown): v is JsonRecord => v !== null && typeof v === 'object' && !Array.isArray(v);
export const isRecord = (v: unknown): v is JsonRecord => isObject(v) && typeof v.id === 'string' && typeof v.context === 'string' && typeof v.leaf === 'string';
export const pointerKey = (p: RecordPointer): string => JSON.stringify(p);
/** Manifest paths are portable relative paths, including nested source directories. */
export function safeRelativePath(path: string): string {
  if (typeof path !== 'string' || path.includes('\\') || path.includes('\0') || isAbsolute(path) || win32.isAbsolute(path) || /^[a-z]:/i.test(path) || path.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('Invalid compile output path');
  return path;
}
/** Refuse existing links before reading or creating any descendant. */
export async function assertNoSymlinkPath(path: string): Promise<void> {
  const absolute = resolve(path);
  let ancestor = parse(absolute).root;
  for (const part of absolute.slice(ancestor.length).split(sep).filter(Boolean)) {
    ancestor = join(ancestor, part);
    try { if ((await lstat(ancestor)).isSymbolicLink()) throw new Error('Writer source and output symlinks are not supported'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
  }
}
async function jsonInputs(root: string, prefix = ''): Promise<string[]> {
  const paths: string[] = [];
  for (const entry of (await readdir(join(root, prefix), {withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))) {
    const path = safeRelativePath(prefix ? `${prefix}/${entry.name}` : entry.name);
    if (entry.isSymbolicLink()) throw new Error('Writer source and output symlinks are not supported');
    if (entry.isDirectory()) paths.push(...await jsonInputs(root, path));
    else if (entry.isFile() && entry.name.endsWith('.json')) paths.push(path);
  }
  return paths;
}
/** Primary source records; legacy sign-in arrays remain content, not census entries. */
export function sourceRecordCount(value: unknown): number {
  if (Array.isArray(value)) return value.filter(isRecord).length;
  if (!isObject(value)) return 0;
  if (Array.isArray(value.records)) return value.records.filter(isRecord).length;
  if (isObject(value.locales)) return Object.values(value.locales).reduce<number>((count, locale) => count + (isObject(locale) && Array.isArray(locale.records) ? locale.records.filter(isRecord).length : 0), 0);
  return 0;
}

/** Import a directory of envelopes, one envelope, or a native writer.json library. */
export async function migrateWriterCells(from: string, to: string, options: {date?: string} = {}): Promise<{cellCount:number;recordCount:number;files:string[]}> {
  const date = options.date ?? new Date().toISOString().slice(0,10);
  if (!isoDate(date)) throw new Error('Invalid migration date');
  await assertNoSymlinkPath(from);
  await assertNoSymlinkPath(to);
  await assertNoSymlinkPath(join(to,'tree.json'));
  try { await stat(join(to,'tree.json')); throw new Error('Migration target already contains tree.json'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const cells = new Map<string, WriterCell>();
  const stored = new Map<string, {record:JsonRecord;bindings:JsonRecord[]}>();
  const surfaces = new Map<string,string>();
  let recordCount = 0;
  const add = (record: JsonRecord, locale: string, surface: string): RecordPointer => {
    const id = writerCellId(record.context as string); const pointer: RecordPointer = [id,locale,record.id as string];
    const key = pointerKey(pointer); const existing = stored.get(key);
    if (existing && JSON.stringify(existing.record) !== JSON.stringify(record)) throw new Error(`Conflicting shared record ${record.id} in ${locale}`);
    if (!existing) {
      let cell = cells.get(id);
      if (!cell) { cell = {id,version:1,status:'active',updated:date,confirmed:`migration:${date}`,links:[],locales:[],records:[],surface}; cells.set(id,cell); surfaces.set(id,surface); }
      if (!cell.locales.includes(locale)) cell.locales.push(locale);
      const item = {locale,record,bindings:[] as JsonRecord[]}; cell.records.push(item); stored.set(key,item);
    }
    return pointer;
  };
  const manifest: CompileManifest = {schemaVersion:1,generated:'Writer cells compile manifest; generated by cells migrate/compile --write.',files:[],passthrough:[]};
  const sourceStat = await stat(from);
  const inputs: {path:string;value:unknown;locale?:string;array?:boolean}[] = [];
  let libraryManifest: unknown;
  if (sourceStat.isDirectory()) {
    const names = await jsonInputs(from);
    if (names.includes('writer.json')) {
      libraryManifest = JSON.parse(await readFile(join(from,'writer.json'),'utf8'));
      if (!isObject(libraryManifest) || !Array.isArray(libraryManifest.locales)) throw new Error('Invalid writer.json manifest');
      for (const raw of libraryManifest.locales) {
        if (!isObject(raw) || typeof raw.tag !== 'string') throw new Error('Invalid library locale');
        const locale = raw.tag;
        if (safeRelativePath(locale).includes('/')) throw new Error('Invalid library locale');
        for (const layer of await readdir(join(from,locale))) {
          const dir = join(from,locale,layer);
          if (!(await stat(dir)).isDirectory()) throw new Error('Expected locale layer directory');
          for (const name of (await readdir(dir)).sort()) {
            if (!name.endsWith('.json')) throw new Error('Narrative Markdown library migration is not supported');
            inputs.push({path:`${locale}/${layer}/${name}`,value:JSON.parse(await readFile(join(dir,name),'utf8')),locale,array:true});
          }
        }
      }
    } else for (const name of names) inputs.push({path:name,value:JSON.parse(await readFile(join(from,name),'utf8'))});
  } else inputs.push({path:basename(from),value:JSON.parse(await readFile(from,'utf8'))});
  for (const input of inputs) {
    safeRelativePath(input.path);
    const value = input.value; const name = basename(input.path); const surface = name.startsWith('admin') ? 'admin' : name.startsWith('section') ? 'sections' : name.startsWith('sign-in') ? 'sign-in' : 'site';
    recordCount += sourceRecordCount(value);
    const order: RecordPointer[] = [];
    if (input.array) {
      if (!Array.isArray(value) || value.some(r=>!isRecord(r))) throw new Error('Expected Writer record array');
      for (const r of value) order.push(add(r,input.locale!,surface));
      manifest.files.push({path:input.path,kind:'array',header:{},order,bindingOrder:[]}); continue;
    }
    if (isObject(value) && Array.isArray(value.records)) {
      const locale = typeof value.locale === 'string' ? value.locale : 'en';
      const {records,bindings,...header} = value;
      if ((records as unknown[]).some(r=>!isRecord(r))) throw new Error(`Invalid records in ${input.path}`);
      for (const r of records as JsonRecord[]) order.push(add(r,locale,surface));
      const bindingOrder: CompileFile['bindingOrder'] = [];
      if (bindings !== undefined && !Array.isArray(bindings)) throw new Error('Envelope bindings must be an array');
      for (const binding of bindings as JsonRecord[] ?? []) {
        if (!isObject(binding) || typeof binding.recordId !== 'string') throw new Error('Invalid binding');
        const pointer = order.find(p=>p[2]===binding.recordId); const item = pointer && stored.get(pointerKey(pointer));
        if (!item) { bindingOrder.push(binding); continue; }
        const {recordId,...fields} = binding;
        let index = item.bindings.findIndex(b=>JSON.stringify(b)===JSON.stringify(fields));
        if (index < 0) { index=item.bindings.length; item.bindings.push(fields); }
        bindingOrder.push([recordId as string,index]);
      }
      manifest.files.push({path:input.path,kind:'envelope',header,keys:Object.keys(value),order,bindingOrder,hasBindings:bindings!==undefined});
    } else if (isObject(value) && isObject(value.locales)) {
      const walk = (v: unknown, locale: string): unknown => {
        if (isRecord(v)) { const p=add(v,locale,surface); order.push(p); return {$writerCell:p}; }
        if (Array.isArray(v)) return v.map(x=>walk(x,locale));
        if (isObject(v)) return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,walk(x,locale)]));
        return v;
      };
      const skeleton = {...value,locales:Object.fromEntries(Object.entries(value.locales).map(([locale,v])=>[locale,walk(v,locale)]))};
      manifest.files.push({path:input.path,kind:'skeleton',header:{},order,bindingOrder:[],skeleton});
    } else manifest.passthrough.push({path:input.path,value});
  }
  if (!cells.size) throw new Error('No Writer records found');
  // Validate the whole destination before the first mkdir/write, including links
  // on later cells or dangling control files, so rejection leaves no partial import.
  for (const path of [...cells.keys()].map(id=>cellPath(id,1)).concat(['tree.json','compile.json'])) {
    await assertNoSymlinkPath(join(to,path));
  }
  const groups = new Map<string,Map<string,string[]>>();
  for (const [id,cell] of cells) {
    const surface=surfaces.get(id)!; let family=groups.get(surface); if(!family){family=new Map();groups.set(surface,family);}
    const seg=id.split('.')[0]!; const ids=family.get(seg)??[];ids.push(id);family.set(seg,ids);
    const path=join(to,cellPath(id,1)); await mkdir(dirname(path),{recursive:true});await writeFile(path,serializeWriterCell(cell));
  }
  const tree = {schemaVersion:1,tree:[...groups].map(([surface,families])=>({id:`surface-${surface}`,name:surface,children:[...families].map(([seg,ids])=>({id:`group-${surface}-${seg}`,name:seg,cells:ids}))})),active:Object.fromEntries([...cells.keys()].map(id=>[id,1])),retired:[],meta:libraryManifest?{libraryManifest}:{}};
  await writeFile(join(to,'tree.json'),canonical(tree)); await writeFile(join(to,'compile.json'),canonical(manifest));
  return {cellCount:cells.size,recordCount,files:inputs.map(i=>i.path)};
}
