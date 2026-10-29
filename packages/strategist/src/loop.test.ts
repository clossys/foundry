import { afterEach, describe, expect, it, vi } from 'vitest';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { evaluateReview, parseWatch, evaluateModelReview, reviewCitationScan, reviewRequestDetail, planReview, review, type ReviewInput } from './loop.js';

import { runReviewCli } from './cli/review.js';
import { main } from './cli.js';
import { listRequests } from './write/index.js';
import { loadCatalog } from './catalog.js';
import { formatRef } from './format/ref.js';
import type { StrategyModel } from './format/types.js';
import type { CitationIndex } from './citations/index.js';

const cell = 'focus.segment.core';
const input = (watch: string, observed = '2026-10-20', value: string | number = 11): ReviewInput => ({
  today: '2026-10-29',
  cells: [{ id: cell, version: 1, status: 'active', updated: '2026-10-01', watch: [{text: watch, line: 20}] }],
  active: {[cell]: 1},
  findings: [{id: 'signups', observed, value}],
  stale: [], existingKeys: [],
});
const watch = (schedule: string, comparator = '>', threshold = '10') => `If signups ${comparator} ${threshold} ${schedule}, then review the segment.`;

describe('review planning', () => {
  it.each(['by 2026-10-29', 'each month', 'in any month'])('fires %s only against observations available today', schedule => {
    expect(evaluateReview(input(watch(schedule))).requests.some(r => r.kind === 'tripwire')).toBe(true);
    expect(evaluateReview(input(watch(schedule), '2026-10-30')).requests.some(r => r.kind === 'tripwire')).toBe(false);
  });
  it('waits until the deadline and ignores observations after it', () => {
    const model = input(watch('by 2026-10-30'));
    expect(evaluateReview(model).requests).toEqual([]);
    expect(evaluateReview({...model, today:'2026-10-31', findings:[{id:'signups', observed:'2026-10-31', value:11}]}).requests.map(r=>r.kind)).toEqual(['reading']);
  });
  it.each([
    ['>', 10, false], ['>', 11, true], ['<', 10, false], ['<', 9, true],
    ['>=', 10, true], ['<=', 10, true], ['=', 10, true], ['=', 11, false],
    ['rises above', 10, false], ['falls below', 10, false], ['reaches', 10, true],
    ['stays below', 10, false], ['stays above', 10, false],
    ['is still', 'paused', true], ['appears', 'paused', true], ['appears', 'running', false],
  ])('compares %s with %s exactly', (comparator, value, expected) => {
    const threshold = typeof value === 'string' ? '"paused"' : '10';
    const report = evaluateReview(input(watch('by 2026-10-29', comparator, threshold), '2026-10-20', value));
    expect(report.requests.some(r => r.kind === 'tripwire')).toBe(expected);
  });
  it('does not coerce unsupported values or infer an observation from prose', () => {
    expect(evaluateReview(input(watch('each month'), '2026-10-20', 'about 11')).requests).toEqual([]);
  });
  it('opens due reading reviews only for missing evidence after the date or completed period', () => {
    for (const schedule of ['by 2026-10-29', 'each month', 'in any month']) {
      const model = {...input(watch(schedule)), findings: []};
      expect(evaluateReview({...model,today:'2026-10-31'}).requests.map(r=>r.kind)).toEqual(['reading']);
      expect(evaluateReview({...model,today:'2026-10-20'}).requests).toEqual([]);
    }
  });
  it('deduplicates per cell, rule and period, including unchanged rules after reciting', () => {
    const model = input(watch('each month'));
    const first = evaluateReview(model).requests[0]!;
    expect(evaluateReview({...model, existingKeys:[first.key]}).requests).toEqual([]);
    expect(evaluateReview({...model, cells:[{...model.cells[0]!,version:2}],active:{[cell]:2}, existingKeys:[first.key]}).requests).toEqual([]);
    expect(evaluateReview({...model,today:'2026-11-20',findings:[{id:'signups',observed:'2026-11-10',value:11}],existingKeys:[first.key]}).requests).toHaveLength(1);
  });
  it('opens drift requests and never mutates cells or pointers', () => {
    const model = {...input(watch('each month')), stale:[{cell,version:1,detail:'Cites a retired need'}]};
    const bytes = JSON.stringify(model);
    expect(evaluateReview(model).requests.map(r=>r.kind)).toEqual(['tripwire','drift']);
    expect(JSON.stringify(model)).toBe(bytes);
  });
  it('ignores drafts and mismatched active pointers', () => {
    const model = input(watch('each month'));
    expect(evaluateReview({...model,active:{[cell]:2}}).requests).toEqual([]);
    expect(evaluateReview({...model,cells:[{...model.cells[0]!,status:'draft'}]}).requests).toEqual([]);
  });
  it('matches only exact normalized ids or aliases and ignores old evidence', () => {
    const model = input(watch('each month'));
    expect(evaluateReview({...model,findings:[{id:'other-signups',observed:'2026-10-20',value:11}]}).requests).toEqual([]);
    expect(evaluateReview({...model,findings:[{id:'survey',aliases:['Signups'],observed:'2026-10-20',value:11}]}).requests).toHaveLength(1);
    expect(evaluateReview({...model,findings:[{id:'signups',observed:'2026-09-20',value:11}]}).requests).toEqual([]);
  });
  it('reports invalid watches, dates and unsupported periods without silently skipping', () => {
    expect(evaluateReview(input(watch('each fortnight'))).issues).toHaveLength(1);
    expect(()=>evaluateReview({...input(watch('each month')),today:'2026-02-30'})).toThrow(/date/);
    expect(parseWatch(watch('by 2026-02-30'))).toBeUndefined();
  });
});


describe('validated model contracts', () => {
  function model(): StrategyModel {
    const base = input(watch('each month'));
    return {root:'.', catalog:loadCatalog(), tree:{schemaVersion:1,catalog:'strategy',archetype:'default',core:[],active:{...base.active}},
      cells:base.cells.map(value => ({...value,status:'active',cites:[{kind:'cell',ref:{cell:'identity.verbal.voice',version:1}}],feeds:[],functions:[],direction:[],because:[],
        watch:value.watch.map(bullet => ({...bullet,refs:[]})),path:`cells/${cell}/v1.md`})),
      findings:base.findings.map(value => ({...value,source:'user',by:'researcher',bullets:[],path:'findings/signups.md'})),
      sessions:[],requests:[],files:{},issues:[]};
  }
  function index(): CitationIndex {
    return {schemaVersion:1,generatedAt:'2026-10-29T00:00:00.000Z',fingerprint:'snapshot',entries:[],stale:[
      {ref:{cell:'identity.verbal.voice',version:1},by:{kind:'json',path:`cells/${cell}/v1.md`,id:'/0'}}],dangling:[],drift:[]};
  }
  it('supplies actual Cell.cites markers to the citation scan and maps obsolete refs to their active citing cell', () => {
    const source = model();
    const before = JSON.stringify(source);
    expect(reviewCitationScan(source).files).toEqual([{path:`cells/${cell}/v1.md`,content:'strategy:identity.verbal.voice@1'}]);
    expect(evaluateModelReview(source,index(),{today:'2026-10-29'}).requests.find(r => r.kind === 'drift')?.cells).toEqual([cell]);
    expect(JSON.stringify(source)).toBe(before);
  });
  it.each(['open','drafted','resolved','declined'] as const)('retains durable deduplication from %s request details', status => {
    const source = model();
    const first = evaluateModelReview(source,index(),{today:'2026-10-29'}).requests;
    source.requests = first.map((request,n) => ({id:`REQ-000${n}`,raisedBy:'review',kind:request.kind,cells:request.cells,
      detail:reviewRequestDetail(request),status,opened:'2026-10-29',resolvedBy:null}));
    expect(evaluateModelReview(source,index(),{today:'2026-10-29'}).requests).toEqual([]);
  });
  it('fails closed on an invalid store before evaluating findings', () => {
    expect(() => evaluateModelReview({...model(),tree:undefined},index(),{today:'2026-10-29'})).toThrow(/invalid/);
  });
});

describe('evidence units and scalar values', () => {
  it('requires an exact unit and never converts units or coerces booleans', () => {
    const source = input(watch('each month','>','10%'));
    expect(evaluateReview(source).requests).toEqual([]);
    expect(evaluateReview({...source,findings:[{id:'signups',observed:'2026-10-20',value:11,unit:'%'}]}).requests).toHaveLength(1);
    expect(evaluateReview({...source,findings:[{id:'signups',observed:'2026-10-20',value:11,unit:'percent'}]}).requests).toEqual([]);
    expect(evaluateReview({...source,findings:[{id:'signups',observed:'2026-10-20',value:true,unit:'%'}]}).requests).toEqual([]);
    expect(evaluateReview({...input(watch('each month')),findings:[{id:'signups',observed:'2026-10-20',value:11,unit:'%'}]}).requests).toEqual([]);
  });
  it('compares boolean findings only with literal boolean equality', () => {
    const source={...input(watch('each month','=','true')),findings:[{id:'signups',observed:'2026-10-20',value:true}]};
    expect(evaluateReview(source).requests).toHaveLength(1);
    expect(evaluateReview({...source,findings:[{id:'signups',observed:'2026-10-20',value:'true'}]}).requests).toEqual([]);
    expect(parseWatch(watch('each month','>','true'))).toBeUndefined();
  });
  it('uses the latest observation for each and any matching observation for in any', () => {
    const findings = [{id:'earlier',aliases:['signups'],observed:'2026-10-10',value:11},{id:'later',aliases:['signups'],observed:'2026-10-20',value:9}];
    expect(evaluateReview({...input(watch('each month')),findings}).requests).toEqual([]);
    expect(evaluateReview({...input(watch('in any month')),findings}).requests).toHaveLength(1);
  });
});


describe('production review read graph', () => {
  const roots: string[] = [];
  afterEach(() => { for (const root of roots.splice(0)) rmSync(root,{recursive:true,force:true}); });
  const temporary = () => { const root=mkdtempSync(join(tmpdir(),'strategy-review-')); roots.push(root); return root; };
  function fixture() {
    const root=temporary();
    cpSync(fileURLToPath(new URL('../test-fixtures/strategy-v2/example/',import.meta.url)),root,{recursive:true});
    const ownerPath=join(root,`cells/${cell}/v2.md`);
    const original=readFileSync(ownerPath,'utf8');
    writeFileSync(ownerPath,original.replace(/## Watch[\s\S]*/,`## Watch\n- ${watch('each month')}\n`));
    const target='context.customer.need';
    mkdirSync(join(root,'cells',target),{recursive:true});
    for (const version of [1,2]) writeFileSync(join(root,'cells',target,`v${version}.md`),original
      .replace(`id: ${cell}`,`id: ${target}`).replace('version: 2',`version: ${version}`)
      .replace('status: active',`status: ${version===1?'retired':'active'}`)
      .replace(/cites: \[[^\n]*\]/,'cites: []').replace(/## Watch[\s\S]*/,''));
    // Parsing needs all sections; this target carries no review rules.
    for (const version of [1,2]) {
      const path=join(root,'cells',target,`v${version}.md`);
      writeFileSync(path,readFileSync(path,'utf8')+'## Watch\n');
    }
    const treePath=join(root,'tree.json'); const tree=JSON.parse(readFileSync(treePath,'utf8'));
    tree.active[target]=2; writeFileSync(treePath,JSON.stringify(tree));
    const findingPath=join(root,'findings/studio-interviews-2026-10.md');
    writeFileSync(findingPath,readFileSync(findingPath,'utf8').replace('observed: 2026-10-20','observed: 2026-10-29')
      .replace('unit: of 14 owners\n','').replace('aliases: [eleven of fourteen owners]','aliases: [signups]'));
    return root;
  }
  function snapshot(root: string): Record<string,string> {
    const result: Record<string,string>={};
    function walk(path: string) {
      for (const entry of readdirSync(join(root,path),{withFileTypes:true})) {
        const child=path ? `${path}/${entry.name}` : entry.name;
        if(entry.isDirectory()) walk(child); else result[child]=readFileSync(join(root,child),'utf8');
      }
    }
    walk(''); return result;
  }
  it('uses actual store and citation index, opens the citing-cell drift, and preserves every filesystem byte', () => {
    const root=fixture(); const before=snapshot(root);
    const report=planReview(root,{today:'2026-10-29'});
    expect(report.issues).toEqual([]);
    expect(report.requests.map(request=>request.kind)).toEqual(['tripwire','drift']);
    expect(report.requests.find(request=>request.kind==='drift')?.cells).toEqual([cell]);
    expect(snapshot(root)).toEqual(before);
    expect(planReview(root,{today:'2026-10-28'}).requests.some(request=>request.kind==='tripwire')).toBe(false);
  });
  it('rejects a symlinked root without reading or writing the outside tree', () => {
    const outside=fixture(); const alias=join(temporary(),'alias'); symlinkSync(outside,alias);
    const before=snapshot(outside);
    expect(()=>planReview(alias,{today:'2026-10-29'})).toThrow(/invalid/);
    expect(snapshot(outside)).toEqual(before);
  });
  it('persists actual request IDs and confines every changed byte to requests/', () => {
    const root=fixture(); const before=snapshot(root);
    const result=review(root,{today:'2026-10-29'});
    expect(result.created.map(request=>request.id)).toEqual(['REQ-0001','REQ-0002']);
    expect(result.created.map(request=>request.kind)).toEqual(['tripwire','drift']);
    expect(result.created.every(request=>request.raisedBy==='strategy-loop' && request.status==='open' && request.opened==='2026-10-29')).toBe(true);
    const after=snapshot(root);
    const changed=[...new Set([...Object.keys(before),...Object.keys(after)])].filter(path=>before[path]!==after[path]);
    expect(changed).toEqual(['requests/REQ-0001.json','requests/REQ-0002.json']);
    expect(review(root,{today:'2026-10-29'}).created).toEqual([]);
    expect(snapshot(root)).toEqual(after);
    expect(listRequests(root)).toHaveLength(2);
  });
  it.each(['open','drafted','resolved','declined'] as const)('deduplicates persisted %s markers after an unchanged rule is re-cited', status => {
    const root=fixture(); review(root,{today:'2026-10-29'});
    for (const name of ['REQ-0001','REQ-0002']) {
      const path=join(root,'requests',`${name}.json`), request=JSON.parse(readFileSync(path,'utf8'));
      request.status=status; if (status==='resolved') request.resolvedBy=formatRef({kind:'cell',ref:{cell,version:2}}); writeFileSync(path,JSON.stringify(request));
    }
    const source=join(root,`cells/${cell}/v2.md`), next=join(root,`cells/${cell}/v3.md`);
    writeFileSync(next,readFileSync(source,'utf8').replace('version: 2','version: 3'));
    writeFileSync(source,readFileSync(source,'utf8').replace('status: active','status: retired'));
    const treePath=join(root,'tree.json'), tree=JSON.parse(readFileSync(treePath,'utf8'));
    tree.active[cell]=3; writeFileSync(treePath,JSON.stringify(tree));
    const before=snapshot(root);
    expect(review(root,{today:'2026-10-29'}).created).toEqual([]);
    expect(snapshot(root)).toEqual(before);
  });
  it('fails visibly at the actual request ID limit without changing any source bytes', () => {
    const root=fixture(); mkdirSync(join(root,'requests'),{recursive:true});
    writeFileSync(join(root,'requests/REQ-9999.json'),JSON.stringify({id:'REQ-9999',raisedBy:'researcher',kind:'reading',cells:[cell],detail:'Existing review',status:'open',opened:'2026-10-01',resolvedBy:null}));
    const before=snapshot(root);
    expect(()=>review(root,{today:'2026-10-29'})).toThrow(/limit/);
    expect(snapshot(root)).toEqual(before);
    const errors=vi.spyOn(console,'error').mockImplementation(()=>{});
    try { expect(runReviewCli(['--root',root,'--today','2026-10-29'])).toBe(2); }
    finally { errors.mockRestore(); }
    expect(snapshot(root)).toEqual(before);
  });
  it('reports malformed watches without persisting partial review output', () => {
    const root=fixture(), path=join(root,`cells/${cell}/v2.md`);
    writeFileSync(path,readFileSync(path,'utf8')+'- If signups > 10 each fortnight, then review.\n');
    const before=snapshot(root), result=review(root,{today:'2026-10-29'});
    expect(result.issues).toHaveLength(1);
    expect(result.created).toEqual([]);
    expect(snapshot(root)).toEqual(before);
  });
  it('refuses request symlink escapes and preserves outside bytes', () => {
    const root=fixture(), outside=temporary();
    writeFileSync(join(outside,'sentinel'),'unchanged');
    rmSync(join(root,'requests'),{recursive:true,force:true}); symlinkSync(outside,join(root,'requests'));
    const before=snapshot(outside);
    expect(()=>review(root,{today:'2026-10-29'})).toThrow();
    expect(snapshot(outside)).toEqual(before);
  });
  it('exposes CLI findings, clean reruns, invalid arguments and persistence failures as 1/0/2', () => {
    const root=fixture(); const output=vi.spyOn(console,'log').mockImplementation(()=>{});
    const errors=vi.spyOn(console,'error').mockImplementation(()=>{});
    try {
      expect(main(['review','--root',root,'--today','2026-10-29','--json'])).toBe(1);
      expect(runReviewCli(['--root',root,'--today','2026-10-29'])).toBe(0);
      expect(runReviewCli(['--root',root,'--today','2026-02-30'])).toBe(2);
      expect(runReviewCli(['--force'])).toBe(2);
      expect(runReviewCli(['--root',root,'--root',root])).toBe(2);
      expect(runReviewCli(['--root',join(root,'missing')])).toBe(2);
      const failedRoot=fixture(); rmSync(join(failedRoot,'requests'),{recursive:true,force:true});
      symlinkSync(temporary(),join(failedRoot,'requests'));
      expect(runReviewCli(['--root',failedRoot,'--today','2026-10-29'])).toBe(2);
    } finally { output.mockRestore(); errors.mockRestore(); }
  });

});
