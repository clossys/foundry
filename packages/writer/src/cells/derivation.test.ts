import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { activate, readActive } from '@clossys/strategist/cell-format';
import { assembleWriterBrief, checkWriterDerivation } from './derivation.js';
import { compileWriterCells } from './compile.js';
import { parseWriterCell, serializeWriterCell, type WriterCell } from './parse.js';
import { loadWriterCatalog } from '../catalog/ia/index.js';

let root: string, director: string, writer: string, cell: WriterCell;
const ids = ['identity.brand.essence','identity.brand.personality','identity.visual.style','identity.verbal.voice','focus.segment.core','focus.category.stance','advantage.proposition.proof'];
const native = (id: string, version = 1, status = 'active', direction = '- Value: Generic direction.') => `---\nid: ${id}\nversion: ${version}\nstatus: ${status}\nupdated: 2026-10-29\ncites: []\nfeeds: []\nfunctions: []\n${status === 'active' ? 'confirmed: msg:2026-10-29-1#U1\n' : ''}---\n\n## Direction\n${direction}\n\n## Because\n- Evidence: observed msg:2026-10-29-1#U1\n\n## Watch\n- Review: changes\n`;
async function putDirector(id: string, version = 1, status = 'active', direction?: string) {
  await mkdir(join(director,'cells',id),{recursive:true});
  await writeFile(join(director,'cells',id,`v${version}.md`),native(id,version,status,direction));
}
async function putWriter(value = cell) { await writeFile(join(writer,'cells',value.id,`v${value.version}.md`),serializeWriterCell(value)); }
async function snapshot(path: string): Promise<unknown> {
  const result: Record<string,unknown> = {};
  for (const name of (await readdir(path)).sort()) {
    const next=join(path,name), stat=await lstat(next);
    result[name]=stat.isDirectory()?await snapshot(next):{hash:createHash('sha256').update(await readFile(next)).digest('hex'),mtime:stat.mtimeMs,size:stat.size};
  }
  return result;
}
beforeEach(async () => {
  root=await mkdtemp(join(tmpdir(),'writer-derivation-'));director=join(root,'director');writer=join(root,'writer');
  for (const id of ids) await putDirector(id,1,'active',id==='identity.verbal.voice'?'- Sound: Plain words.\n- Never: "risk-free"':id==='advantage.proposition.proof'?'- Never-claim: "guaranteed results"':id==='identity.brand.personality'?'- Traits: Calm.':undefined);
  await writeFile(join(director,'tree.json'),JSON.stringify({schemaVersion:1,active:Object.fromEntries(ids.map(id=>[id,1]))}));
  const brief=await assembleWriterBrief(director);
  cell={id:'site.home',version:1,status:'active',updated:'2026-10-29',confirmed:'msg:2026-10-29-1#U1',links:brief.directorInputs.map(i=>i.ref),locales:['en'],note:'Owner-authored rationale retained.',records:[
    {locale:'en',record:{id:'voice.plain',context:'site.home.voice',leaf:'lexicon.formality',value:'neutral',directorSources:brief.obligations.map(({ref,line})=>({ref,line}))},bindings:[]},
    {locale:'en',record:{id:'home.heading',context:'site.home.heading',leaf:'strings.labels',status:'draft',text:'Plan your work.',custom:'retain'},bindings:[]}
  ]};
  await mkdir(join(writer,'cells','site.home'),{recursive:true});await putWriter();
  await writeFile(join(writer,'tree.json'),JSON.stringify({schemaVersion:1,active:{'site.home':1},meta:{custom:'preserve'}}));
  await writeFile(join(writer,'compile.json'),JSON.stringify({schemaVersion:1,generated:'fixture',files:[{path:'copy.json',kind:'array',header:{},order:cell.records.map(r=>[cell.id,r.locale,r.record.id]),bindingOrder:[]}],passthrough:[]}));
});
afterEach(async () => { await rm(root,{recursive:true,force:true}); });

describe('read-only Writer Director handoff',()=>{
  it('assembles only ACTIVE Director source versions and canonical leaves, retaining citations',async()=>{
    await putDirector('identity.verbal.voice',2,'draft','- Sound: Draft wording.');
    await putDirector('identity.naming.name',1,'draft','- Name: Draft brand.');
    const brief=await assembleWriterBrief(director);
    expect(brief.directorInputs).toHaveLength(7);expect(brief.missingInputs).toEqual([]);
    expect(brief.directorInputs.find(i=>i.id==='identity.verbal.voice')).toMatchObject({version:1,ref:'director:identity.verbal.voice@1'});
    expect(brief.directorInputs.some(i=>i.source.includes('Draft wording'))).toBe(false);
    expect(brief.directorInputs[0]!.because[0]!.text).toContain('msg:2026-10-29-1#U1');
    expect(brief.leaves.flatMap(l=>l.ids)).toEqual(loadWriterCatalog().slots.map(s=>s.id));
    expect(brief.obligations).toHaveLength(3);
  });
  it('runs the real named checks with a clean explicit mapping and writes no bytes or mtimes',async()=>{
    const before=await snapshot(root);const brief=await assembleWriterBrief(director);const result=await checkWriterDerivation(director,writer);
    expect(brief.obligations.length).toBeGreaterThan(0);expect(result).toMatchObject({exitCode:0,directorCount:7,writerCount:1,findings:[]});
    expect(result.checks?.voiceDerivation).toMatchObject({ok:true,obligationsChecked:3,rulesChecked:3});
    expect(result.checks?.localeCoverage).toMatchObject({complete:true,sourceEntryCount:1,findings:[]});
    expect(result.checks?.wontClaim).toMatchObject({state:'clean',filesScanned:1,unchecked:[]});
    expect(await snapshot(root)).toEqual(before);
  });
  it('reports exact no-link cells and missing rule identities instead of vacuous coverage',async()=>{
    cell.links=[];delete cell.records[0]!.record.directorSources;await putWriter();
    const result=await checkWriterDerivation(director,writer);
    expect(result.exitCode).toBe(2);expect(result.findings).toContainEqual(expect.objectContaining({rule:'director-link-missing',cell:'site.home@1'}));
    expect(result.checks?.voiceDerivation.rulesChecked).toBe(0);expect(result.findings.filter(f=>f.rule==='voice-derivation-coverage:missing')).toHaveLength(3);
  });
  it('detects drift to a new active Director version, ignoring an unactivated higher draft',async()=>{
    await putDirector('identity.verbal.voice',2,'draft','- Sound: Still a draft.');
    expect((await checkWriterDerivation(director,writer)).exitCode).toBe(0);
    await activate(director,['identity.verbal.voice@2'],{confirm:'msg:2026-10-29-1#U2'});
    const result=await checkWriterDerivation(director,writer);
    expect(result.exitCode).toBe(2); // New source lacks a quoted Never label, so prohibition checking cannot run.
    expect(result.findings).toContainEqual(expect.objectContaining({rule:'director-link-stale',cell:'site.home@1'}));
    expect(result.checks?.voiceDerivation.ok).toBe(false);
  });
  it('catches actual banned claims in copy through the existing prohibition checker',async()=>{
    cell.records[1]!.record.text='Risk-free planning with guaranteed results.';await putWriter();
    const result=await checkWriterDerivation(director,writer);
    expect(result.exitCode).toBe(1);expect(result.findings.filter(f=>f.rule==='wont-claim:hit')).toHaveLength(2);
    expect(result.checks?.wontClaim.findings.map(f=>f.found)).toEqual(['guaranteed results','Risk-free']);
  });
  it('reports unquoted prohibitions as unchecked, without inventing match phrases',async()=>{
    await putDirector('advantage.proposition.proof',1,'active','- Never-claim: Do not promise outcomes.');
    const result=await checkWriterDerivation(director,writer);expect(result.exitCode).toBe(1);
    expect(result.findings.some(f=>f.rule==='wont-claim:unchecked')).toBe(true);
  });
  it('ignores Writer tombstones even if an abandoned draft exists for that retired id',async()=>{
    const abandoned:WriterCell={...cell,id:'archived.page',version:2,status:'draft',links:[]};delete abandoned.confirmed;
    await mkdir(join(writer,'cells',abandoned.id));await putWriter(abandoned);
    await writeFile(join(writer,'tree.json'),JSON.stringify({schemaVersion:1,active:{'site.home':1,'archived.page':null},retired:['archived.page']}));
    const result=await checkWriterDerivation(director,writer);expect(result.exitCode).toBe(0);expect(result.writerCount).toBe(1);
  });
  it('reports ignored prohibition lines as unchecked copy rather than silent success',async()=>{
    cell.records[1]!.record.text='// wont-claim:ignore risk-free';await putWriter();
    const result=await checkWriterDerivation(director,writer);expect(result.exitCode).toBe(1);
    expect(result.findings.some(f=>f.rule==='wont-claim:ignored')).toBe(true);
  });
  it('returns explicit link and rule finding counts alongside exact identities',async()=>{
    cell.links=['director:identity.verbal.voice@9'];delete cell.records[0]!.record.directorSources;await putWriter();
    const result=await checkWriterDerivation(director,writer);
    expect(result.counts).toMatchObject({missingDirectorLinks:0,staleDirectorLinks:1,unmappedRules:3});
  });
  it('executes locale coverage over actual copy and declared project locales',async()=>{
    const result=await checkWriterDerivation(director,writer,{sourceLocale:'en',locales:['en','fr']});
    expect(result.exitCode).toBe(2);expect(result.findings.some(f=>f.rule==='locale-coverage:target-locale-missing')).toBe(true);
    cell.locales.push('fr');cell.records.push({locale:'fr',record:{id:'different.heading',context:'site.home.heading',leaf:'strings.labels',text:'Bonjour.'},bindings:[]});await putWriter();
    const partial=await checkWriterDerivation(director,writer,{sourceLocale:'en',locales:['en','fr']});
    expect(partial.exitCode).toBe(1);expect(partial.checks?.localeCoverage.complete).toBe(true);
    expect(partial.findings.some(f=>f.rule==='locale-coverage:missing-entry')).toBe(true);
  });
  it('checks a newer owner draft and its rationale without activation; maps roundtrip native activation and compilation',async()=>{
    const activeBefore=(await readActive(writer))[0]!.source;
    cell={...cell,version:2,status:'draft'};delete cell.confirmed;await putWriter();
    expect((await checkWriterDerivation(director,writer)).exitCode).toBe(0);
    expect((await readActive(writer))[0]!.source).toBe(activeBefore);
    const activated=await activate(writer,['site.home@2'],{confirm:'msg:2026-10-29-1#U2',beforeActivate:({cells})=>{for(const c of cells)parseWriterCell(c.source,c.path);}});
    const parsed=parseWriterCell(activated[0]!.source,activated[0]!.path);expect(parsed.note).toBe('Owner-authored rationale retained.');
    expect(parsed.records[0]!.record.directorSources).toEqual(cell.records[0]!.record.directorSources);
    const compiled=await compileWriterCells(writer);expect((compiled.files['copy.json'] as unknown[])[0]).toMatchObject({directorSources:cell.records[0]!.record.directorSources});
    expect((compiled.files['copy.json'] as unknown[])[1]).toMatchObject({custom:'retain',text:'Plan your work.'});
  });
  it('names unreadable or aliased roots as execution failures without creating missing roots',async()=>{
    const missing=join(root,'missing');expect((await checkWriterDerivation(director,missing)).exitCode).toBe(2);
    await expect(lstat(missing)).rejects.toMatchObject({code:'ENOENT'});
    const alias=join(root,'alias');await symlink(director,alias);expect((await checkWriterDerivation(alias,writer)).exitCode).toBe(2);
  });
});
