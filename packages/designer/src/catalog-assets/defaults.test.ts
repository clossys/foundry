/** @vitest-environment node */
import {readFileSync} from 'node:fs';
import {describe,it,expect} from 'vitest';
import {loadCatalog} from '../catalog-core/index.js';
import {loadCoverageInput} from '../catalog/ia/check-coverage/load.js';
import {checkCoverage} from '../catalog/ia/check-coverage/check.js';
import {isImageResource,isVideoResource} from './media.js';
import {inspectSvg} from './svg.js';
import {PATTERN_RECIPES,PATTERN_TOKEN_READS,patternBackground} from '../tokens/pattern.js';

describe('Custom defaults for existing unfilled leaves',()=>{
 it('commits usable media resources with honest Custom provenance and no upstream claim',()=>{
  const catalog=loadCatalog();
  for(const leaf of ['image','video']){
   const fill=catalog.fills.find(fill=>fill.$extensions['com.clossys.fill'].id===`foundry/assets.${leaf}`)!;
   const document=JSON.parse(readFileSync(new URL(`../catalog/fills/foundry/assets.${leaf}.json`,import.meta.url),'utf8'));
   expect(document.$extensions['com.clossys.default']).toEqual({tier:'Custom',reason:'no shadcn@aria item'});
   expect(fill.$extensions['com.clossys.fill'].source).toBe('foundry');
   const resource=document.assets[leaf].default.$value;
   expect((leaf==='image'?isImageResource:isVideoResource)(resource)).toBe(true);
   if(leaf==='image'){
    expect(resource.decorative).toBe(true);
    expect(()=>inspectSvg(Buffer.from(resource.src.split(',')[1],'base64').toString())).not.toThrow();
   }else{
    expect(Buffer.from(resource.src.split(',')[1],'base64').subarray(0,4).toString('hex')).toBe('1a45dfa3');
    expect(resource.reducedMotion).toBe('poster');
   }
  }
 });
 it('fills all assets and the existing SemanticContent leaf without asserting checks or approval',()=>{
  const report=checkCoverage(loadCoverageInput());
  expect(report.findings.filter(finding=>finding.priority==='P1'&&finding.subject.startsWith('assets.'))).toEqual([]);
  expect(report.findings.filter(finding=>finding.code==='IA-UNFILLED'&&finding.subject==='components.semantic-content')).toEqual([]);
  const fill=JSON.parse(readFileSync(new URL('../catalog/fills/foundry/components.semantic-content.json',import.meta.url),'utf8'));
  expect(fill.$extensions['com.clossys.default']).toEqual({tier:'Custom',reason:'no shadcn@aria item'});
  expect(fill.$extensions['com.clossys.fill'].status).toBe('draft');
  expect(fill.components['semantic-content'].impl).toEqual({kind:'package',module:'@clossys/designer/components',export:'SemanticContent'});
 });
 it('binds every pattern stroke to the existing strong border token in either theme',()=>{
  expect(PATTERN_TOKEN_READS).toContain('tokens.border-color.strong');
  for(const recipe of Object.values(PATTERN_RECIPES)){
   expect(recipe.ink).toBe('--color-line-strong');
   expect(patternBackground(recipe).backgroundImage).toContain('var(--color-line-strong)');
  }
 });
});
