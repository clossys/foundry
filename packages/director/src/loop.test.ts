import { reader, store } from "../test/store.js";
import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { evaluateReview, parseWatch, evaluateModelReview, reviewCitationScan, reviewRequestDetail, planReview, type ReviewInput } from './loop.js';

import { runReviewCli } from './cli/review.js';
import { main } from './cli.js';
import { stageFinding, stageSlot, strategyRoot } from './ground/fixtures.js';
import { loadCatalog } from './catalog.js';
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
  const target='context.customer.need';
  /** The owner pins a watched cell that cites a superseded need; signups evidence trips its watch. */
  function fixture(extraWatch: string[] = []) {
    const base=temporary(); const root=strategyRoot(base);
    stageSlot(root,cell,2,'Who: owner-led studios.',{refs:[`${target}@1`],watch:[watch('each month'),...extraWatch]});
    stageSlot(root,target,1,'Need: fictional scheduling.',{watch:[],unpinned:true});
    stageSlot(root,target,2,'Need: fictional planning.',{watch:[]});
    stageFinding(root,'signups','---\nid: signups\nsource: user\nobserved: 2026-10-29\nby: researcher\nvalue: 11\n---\n- Observed signups.\n');
    return {base,root};
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
  it('uses actual store and citation index, plans the citing-cell drift, and preserves every filesystem byte', () => {
    const {base,root}=fixture(); const before=snapshot(base);
    const report=planReview(root, reader,{today:'2026-10-29'});
    expect(report.issues).toEqual([]);
    expect(report.requests.map(request=>request.kind)).toEqual(['tripwire','drift']);
    expect(report.requests.find(request=>request.kind==='drift')?.cells).toEqual([cell]);
    expect(snapshot(base)).toEqual(before);
    expect(planReview(root, reader,{today:'2026-10-28'}).requests.some(request=>request.kind==='tripwire')).toBe(false);
  });
  it('rejects a symlinked root without reading or writing the outside tree', () => {
    const {base,root}=fixture(); const alias=join(temporary(),'alias'); symlinkSync(root,alias);
    const before=snapshot(base);
    expect(()=>planReview(alias, reader,{today:'2026-10-29'})).toThrow(/invalid/);
    expect(snapshot(base)).toEqual(before);
  });
  it('reports malformed watches without writing', () => {
    const {base,root}=fixture(['If signups > 10 each fortnight, then review.']); const before=snapshot(base);
    expect(planReview(root, reader,{today:'2026-10-29'}).issues).toHaveLength(1);
    expect(snapshot(base)).toEqual(before);
  });
  it('exposes planned requests, clean plans and invalid arguments as 1/0/2 and never writes requests', () => {
    const {base,root}=fixture(); const before=snapshot(base);
    const output=vi.spyOn(console,'log').mockImplementation(()=>{});
    const errors=vi.spyOn(console,'error').mockImplementation(()=>{});
    try {
      expect(main(['review','--root',root,'--today','2026-10-29','--json'], store)).toBe(1);
      expect(runReviewCli(['--root',root,'--today','2026-10-29'], store)).toBe(1);
      expect(runReviewCli(['--root',root,'--today','2026-10-28'], store)).toBe(1);
      expect(runReviewCli(['--root',root,'--today','2026-02-30'], store)).toBe(2);
      expect(runReviewCli(['--force'], store)).toBe(2);
      expect(runReviewCli(['--root',root,'--root',root], store)).toBe(2);
      expect(runReviewCli(['--root',join(root,'missing')], store)).toBe(2);
      const clean=strategyRoot(temporary()); stageSlot(clean,cell,1,'Who: owner-led studios.',{watch:[]});
      expect(runReviewCli(['--root',clean,'--today','2026-10-29'], store)).toBe(0);
    } finally { output.mockRestore(); errors.mockRestore(); }
    expect(snapshot(base)).toEqual(before);
    expect(existsSync(join(root,'requests'))).toBe(false);
  });
  it('saves the plan as reports/review.json only with --write, and never a request', () => {
    const {base,root}=fixture(); const before=snapshot(base);
    const output=vi.spyOn(console,'log').mockImplementation(()=>{});
    try {
      expect(runReviewCli(['--root',root,'--today','2026-10-29','--write'], store)).toBe(1);
    } finally { output.mockRestore(); }
    const saved=JSON.parse(readFileSync(join(root,'..','..','evidence','director','reports','review.json'),'utf8'));
    expect(existsSync(join(root,'reports'))).toBe(false);
    expect(saved).toEqual(planReview(root, reader,{today:'2026-10-29'}));
    expect(saved.requests.length).toBeGreaterThan(0);
    expect(existsSync(join(root,'requests'))).toBe(false);
    const after=snapshot(base); delete after[Object.keys(after).find(key => key.endsWith('reports/review.json'))!];
    expect(after).toEqual(before);
  });
});
