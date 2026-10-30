import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { readActive, validateGenericTree } from '@clossys/strategist/cell-format';
import { parseWriterCell, WRITER_CELL_ID, type CellRecord, type JsonRecord } from './parse.js';
import { assertNoSymlinkPath, canonical, isObject, pointerKey, safeRelativePath, sourceRecordCount, type CompileManifest, type RecordPointer } from './migrate.js';
import { WRITER_LAYERS } from '../catalog-core/ids.js';

export interface CompileOptions { check?: boolean; write?: boolean; format?: 'records' | 'library' }
async function outputPath(root: string, path: string): Promise<string> {
  safeRelativePath(path);
  const result = resolve(root,path); const rel = relative(resolve(root),result);
  if (isAbsolute(rel) || rel.startsWith(`..${sep}`)) throw new Error('Output escapes destination');
  await assertNoSymlinkPath(result);
  return result;
}
/** Compile only versions selected by tree.json. Tree grouping never determines output order. */
export async function compileWriterCells(root: string, out?: string, options: CompileOptions = {}): Promise<{files:Record<string,unknown>;cellCount:number;recordCount:number}> {
  if (options.check && options.write) throw new Error('--check and --write are mutually exclusive');
  const manifest = JSON.parse(await readFile(join(root,'compile.json'),'utf8')) as CompileManifest;
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.files) || !Array.isArray(manifest.passthrough)) throw new Error('Invalid compile manifest');
  for (const file of [...manifest.files, ...manifest.passthrough]) safeRelativePath(file.path);
  const tree: unknown = JSON.parse(await readFile(join(root,'tree.json'),'utf8'));
  const ids = await readdir(join(root,'cells'));
  if (ids.some(id=>!WRITER_CELL_ID.test(id))) throw new Error('Expected permanent two-segment Writer cell ids');
  const checked = validateGenericTree(tree,{cellIds:ids,maxDepth:2});
  if (!checked.ok) throw new Error(checked.issues.map(i=>`${i.path}: ${i.message}`).join('\n'));
  const active = await readActive(root);
  const cells = active.map(c=>parseWriterCell(c.source,c.path));
  const entries = new Map<string,CellRecord>();
  for (const cell of cells) for (const item of cell.records) {
    const p: RecordPointer = [cell.id,item.locale,String(item.record.id)]; const key=pointerKey(p);
    if (entries.has(key)) throw new Error(`Duplicate record ${item.record.id} in cell ${cell.id}/${item.locale}`);
    entries.set(key,item);
  }
  const files: Record<string,unknown> = Object.create(null);
  const seen = new Set<string>();
  const originalPointers = new Set(manifest.files.flatMap(file=>file.order.map(pointerKey)));
  const originalBindings = new Set<string>();
  for (const file of manifest.files) for (const binding of file.bindingOrder) if (Array.isArray(binding)) {
    const pointer=file.order.find(p=>p[2]===binding[0]);
    if (pointer) originalBindings.add(JSON.stringify([pointer,binding[1]]));
  }
  for (const file of manifest.files) {
    if (!Array.isArray(file.order) || !Array.isArray(file.bindingOrder)) throw new Error('Invalid compile file order');
    for (const pointer of file.order) {
      if (!Array.isArray(pointer) || pointer.length !== 3 || pointer.some(x=>typeof x!=='string')) throw new Error('Invalid record order pointer');
      seen.add(pointerKey(pointer));
    }
    // New records inherit each file in which their section/locale already appears.
    const additions = file.kind === 'skeleton' ? [] : [...entries].filter(([key,item])=>!originalPointers.has(key) && file.order.some(p=>p[0]===JSON.parse(key)[0] && p[1]===item.locale));
    if (additions.length && !options.write) throw new Error('New records require compile --write to update compile.json');
    for (const [key] of additions) {
      const pointer=JSON.parse(key) as RecordPointer;
      let last=-1;for(let i=0;i<file.order.length;i++)if(file.order[i]![0]===pointer[0] && file.order[i]![1]===pointer[1])last=i;
      file.order.splice(last+1,0,pointer);seen.add(key);
    }
    const records = file.order.flatMap(p=>{const item=entries.get(pointerKey(p));return item?[item.record]:[];});
    const byId = new Map(file.order.map(p=>[p[2],entries.get(pointerKey(p))]));
    for (const [recordId,item] of byId) if (file.kind === 'envelope' && item) {
      const pointer=file.order.find(p=>p[2]===recordId)!;
      for (let index=0;index<item.bindings.length;index++) {
        if (!originalBindings.has(JSON.stringify([pointer,index])) && !file.bindingOrder.some(binding=>Array.isArray(binding)&&binding[0]===recordId&&binding[1]===index)) {
          if (!options.write) throw new Error('New bindings require compile --write to update compile.json');
          file.bindingOrder.push([recordId,index]);file.hasBindings=true;
        }
      }
    }
    const bindings = file.bindingOrder.flatMap(binding=>{
      if (!Array.isArray(binding)) return [binding];
      const item=byId.get(binding[0]); if(!item)return [];
      const fields=item.bindings[binding[1]];if(!fields)throw new Error('Binding order index is missing');
      return [{recordId:binding[0],...fields}];
    });
    if (file.kind === 'array') files[file.path]=records;
    else if(file.kind==='envelope') {
      const value:JsonRecord={...file.header,records,...(file.hasBindings?{bindings}:{})};
      files[file.path]=Object.fromEntries([...(file.keys??Object.keys(value)),...Object.keys(value)].filter((key,i,keys)=>keys.indexOf(key)===i).map(key=>[key,value[key]]));
    } else if(file.kind==='skeleton') {
      const expand=(v:unknown):unknown=>{
        if(isObject(v)&&Object.hasOwn(v,'$writerCell'))return entries.get(pointerKey(v.$writerCell as RecordPointer))?.record;
        if(Array.isArray(v))return v.map(expand).filter(x=>x!==undefined);
        if(isObject(v))return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,expand(x)]));
        return v;
      };
      files[file.path]=expand(file.skeleton);
    } else throw new Error('Unknown compile file kind');
  }
  if ([...entries.keys()].some(key=>!seen.has(key))) throw new Error('A new cell has no output mapping; migrate an initial envelope for that section');
  for(const file of manifest.passthrough)files[file.path]=file.value;
  if(options.format==='library') {
    const recordsByLocale=new Map<string,Map<string,JsonRecord>>();
    for(const item of entries.values()) {
      const locale=recordsByLocale.get(item.locale)??new Map<string,JsonRecord>();
      const id=String(item.record.id);const existing=locale.get(id);
      if(existing&&!isDeepStrictEqual(existing,item.record))throw new Error('Conflicting library record id');
      locale.set(id,item.record);recordsByLocale.set(item.locale,locale);
    }
    for(const path of Object.keys(files))delete files[path];
    const meta=checked.value.meta;
    const manifestValue=meta?.libraryManifest??{consumer:'consumer',messageSyntax:'icu-mf1',defaultLocale:recordsByLocale.has('en')?'en':[...recordsByLocale.keys()][0],locales:[...recordsByLocale.keys()].map(tag=>({tag,dir:/^(ar|fa|he|ur)(-|$)/.test(tag)?'rtl':'ltr',state:'active'})),fallback:{},strategist:{path:'../strategist'},leafFreeze:Object.fromEntries(WRITER_LAYERS.map(layer=>[layer,'']))};
    files['writer.json']=manifestValue;
    for(const [locale,records] of recordsByLocale)for(const layer of WRITER_LAYERS){const layerRecords=[...records.values()].filter(r=>String(r.leaf).startsWith(`${layer}.`));if(layerRecords.length)files[`${locale}/${layer}/cells.json`]=layerRecords;}
  }
  if(options.check&&!out)throw new Error('--check requires an output directory');
  if(out)for(const [path,value]of Object.entries(files)) {
    const target=await outputPath(out,path);
    if(options.check){let actual:unknown;try{actual=JSON.parse(await readFile(target,'utf8'));}catch{throw new Error(`Compiled output is missing or invalid: ${path}`);}if(!isDeepStrictEqual(actual,value))throw new Error(`Compiled output drift: ${path}`);}
    else {await mkdir(dirname(target),{recursive:true});await writeFile(target,canonical(value));}
  }
  if(options.write)await writeFile(join(root,'compile.json'),canonical(manifest));
  return {files,cellCount:cells.length,recordCount:Object.values(files).reduce<number>((count,value)=>count+sourceRecordCount(value),0)};
}
