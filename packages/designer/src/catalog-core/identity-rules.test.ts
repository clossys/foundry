import { describe, expect, it } from 'vitest';
import { completedCatalogLibrary } from './__fixtures__/completed-catalog-library.js';
import { applyLibraryChange, check, generateSelection, libraryHash, loadCatalog, resolve, stableStringify, type CatalogData, type ChangeSet, type LibraryData } from './index.js';
import { derivationInputsHash } from './library.js';
import { flatten, metaOf } from './model.js';

const catalog = loadCatalog();
const complete = completedCatalogLibrary(catalog,{id:'example-raw-identity',kind:'consumer',author:'consumer',license:'MIT'},'2026-10-23');
const inputs = {
  'identity-lockup@1':['assets.lockup.positive','tokens.text-color.on-inverse'],
  'identity-mark@1':['assets.mark.positive','tokens.text-color.on-inverse'],
  'identity-favicon@1':['assets.mark.positive','tokens.text-color.primary','tokens.text-color.on-inverse'],
  'identity-app-icon@1':['assets.mark.positive','tokens.text-color.primary','tokens.text-color.on-inverse'],
};
const changes: ChangeSet['changes'] = Object.entries(inputs).map(([rule,inputs])=>({op:'derive',slot:'assets.'+rule.slice(9,-2),rule,inputs}));
function raw(c:CatalogData,library:LibraryData):LibraryData { return applyLibraryChange(c,library,{baseHash:libraryHash(library),changes}); }
function seeds():LibraryData {
  const result=structuredClone(complete);
  result.fills=result.fills.filter(fill=>{
    if(!fill.assets) return true;
    const root=fill.assets[metaOf(fill).slot.slice(7)] as Record<string,import('./types.js').DtcgToken>;
    for(const [name,token] of Object.entries(root)) if(token.$extensions?.['com.clossys.origin']?.kind==='derived') delete root[name];
    return Object.keys(root).length>0;
  });
  result.selection=generateSelection(result); return result;
}
const errors=(c:CatalogData,library:LibraryData)=>check({catalog:c,library}).findings.filter(finding=>finding.severity==='error');

describe('builtin identity rules through ordinary library changes',()=>{
  it('publishes the exact required library-member inputs for every registered rule',()=>{
    for(const [id,required] of Object.entries(inputs)) expect(catalog.rules?.find(rule=>rule.id===id)?.inputs).toEqual(required);
  });
  it('materializes raw derive operations deterministically with complete provenance and zero errors',()=>{
    const seed=seeds(); const original=stableStringify(seed); const result=raw(catalog,seed);
    expect(stableStringify(seed)).toBe(original);
    expect(stableStringify(raw(catalog,seed))).toBe(stableStringify(result));
    expect(resolve({catalog,library:result})).toEqual(resolve({catalog,library:complete}));
    expect(result.fills).toHaveLength(104); expect(errors(catalog,result)).toEqual([]);
    for(const fill of result.fills) for(const token of Object.values(flatten(fill))) {
      const origin=token.$extensions?.['com.clossys.origin'];
      if(origin?.kind==='derived'&&origin.rule.startsWith('identity-')) {
        expect(origin.inputs).toEqual([...inputs[origin.rule as keyof typeof inputs]].sort());
        expect(origin.inputsHash).toBe(derivationInputsHash(catalog,result,origin.inputs));
      }
    }
  });
  it('rejects missing registration, unknown versions and caller or registry input tampering',()=>{
    const seed=seeds(); const op=changes[0]!;
    const removed={...catalog,rules:catalog.rules?.filter(rule=>!rule.id.startsWith('identity-'))};
    expect(()=>raw(removed,seed)).toThrow(/unknown rule/);
    expect(errors(removed,complete).some(finding=>finding.code==='C10'&&finding.message.includes('unknown rule'))).toBe(true);
    for(const bad of [{...op,rule:'identity-lockup@99'},{...op,inputs:[]},{...op,inputs:[...inputs['identity-lockup@1'],'tokens.text-color.primary']},{...op,slot:'assets.mark'}]) {
      expect(()=>applyLibraryChange(catalog,seed,{baseHash:libraryHash(seed),changes:[bad]})).toThrow(/rule|input/);
    }
    const altered={...catalog,rules:catalog.rules?.map(rule=>rule.id==='identity-lockup@1'?{...rule,inputs:[]}:rule)};
    expect(()=>raw(altered,seed)).toThrow(/input/);
    const damaged=structuredClone(complete); const token=flatten(damaged.fills.find(fill=>metaOf(fill).slot==='assets.favicon')!)['assets.favicon.vector']!;
    const origin=token.$extensions!['com.clossys.origin']!;
    if(origin.kind!=='derived') throw new Error('expected derived favicon');
    origin.inputs=['assets.mark.positive']; origin.inputsHash=derivationInputsHash(catalog,damaged,origin.inputs);
    expect(errors(catalog,damaged).some(finding=>finding.code==='C10'&&finding.message.includes('declared inputs'))).toBe(true);
    token.$value='<svg viewBox="0 0 24 24"><path d="M0 0"/></svg>';
    expect(errors(catalog,damaged).some(finding=>finding.message.includes('identity output differs'))).toBe(true);
  });
  it('keeps saved outputs stale until an explicit ordinary derive refresh',()=>{
    const changed=applyLibraryChange(catalog,complete,{baseHash:libraryHash(complete),changes:[{op:'author',slot:'tokens.text-color',tokens:{primary:{$type:'color',$value:'#111111',$extensions:{'com.clossys.css':{raw:'#111111'},'com.clossys.modes':{dark:'#ffffff'}}}}}]});
    const before=resolve({catalog,library:complete}).members['assets.favicon.vector']!.value.light;
    expect(resolve({catalog,library:changed}).members['assets.favicon.vector']!.value.light).toBe(before);
    expect(errors(catalog,changed).some(finding=>finding.code==='C10'&&finding.message.includes('stale inputsHash'))).toBe(true);
    const refreshed=raw(catalog,changed); expect(errors(catalog,refreshed)).toEqual([]);
    expect(resolve({catalog,library:refreshed}).members['assets.favicon.vector']!.value.light).not.toBe(before);
  });
});
