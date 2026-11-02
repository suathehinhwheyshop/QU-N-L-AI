import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRun,startRun,pauseRun,retryRun,advanceRun,recoverRun,updateNote,toCsv} from '../workflow-engine.mjs';
const config=(overrides={})=>({site:'https://wheyshop.vn',start:'2026-10-01',end:'2026-10-31',goal:'Phân tích GSC và tối ưu SEO',profile:'SEO',model:'model-do-anh-chon',scope:['metadata','links'],...overrides});
const finish=r=>{for(let i=0;i<10&&r.status==='running';i++)advanceRun(r);return r};
test('closed demo hands off source/config, respects scope and reports blocked work',()=>{
 const r=createRun(config());startRun(r);finish(r);
 assert.equal(r.steps.filter(s=>s.status==='done').length,6);
 assert.deepEqual(r.artifacts.map(a=>a.id),['gsc','analysis','plan','changes','checks','report']);
 const gsc=r.artifacts[0].payload;
 assert.equal(gsc.site,'https://wheyshop.vn');assert.deepEqual(gsc.comparison,{start:'2026-08-31',end:'2026-09-30'});
 assert.equal(r.artifacts[1].payload.model,'model-do-anh-chon');
 assert.equal(r.tasks.filter(t=>t.status==='verified').length,3);
 assert.equal(r.tasks.find(t=>t.type==='content').evidence,null);
 assert.equal(r.tasks.find(t=>t.type==='content').status,'blocked');
 assert.equal(r.status,'needs_action');assert.equal(r.artifacts.at(-1).payload.websiteChanged,false);
 const snapshot=JSON.stringify(r);assert.equal(advanceRun(r),null);assert.equal(startRun(r),false);assert.equal(JSON.stringify(r),snapshot);
});
test('all permitted tasks can complete the simulation without claiming real execution',()=>{
 const r=createRun(config({scope:['metadata','links','content']}));startRun(r);finish(r);
 assert.equal(r.status,'complete');assert.equal(r.tasks.filter(t=>t.status==='verified').length,4);
 assert.ok(r.tasks.every(t=>t.evidence.demo));
});
test('export failure blocks downstream, retry retains ID and avoids duplicate artifacts',()=>{
 const r=createRun(config({scenario:'export-error'})),id=r.id;startRun(r);advanceRun(r);
 assert.equal(r.status,'error');assert.equal(r.tasks.length,0);assert.equal(r.artifacts.length,0);
 assert.equal(advanceRun(r),null);assert.equal(retryRun(r),true);finish(r);
 assert.equal(r.id,id);assert.equal(r.steps[0].attempts,2);assert.equal(r.artifacts.length,6);assert.equal(new Set(r.tasks.map(t=>t.id)).size,4);
});
test('pause and browser recovery retain completed work, notes and resume point',()=>{
 const r=createRun(config());startRun(r);advanceRun(r);pauseRun(r);
 assert.equal(advanceRun(r),null);assert.equal(r.artifacts.length,1);
 startRun(r);advanceRun(r);advanceRun(r);updateNote(r,'SEO-01','Giữ ghi chú của anh');
 const restored=recoverRun(JSON.parse(JSON.stringify(r)));assert.equal(restored.status,'paused');
 assert.equal(restored.tasks[0].note,'Giữ ghi chú của anh');startRun(restored);finish(restored);
 assert.equal(restored.steps[0].attempts,1);assert.equal(restored.artifacts.length,6);assert.equal(restored.tasks[0].note,'Giữ ghi chú của anh');
});
test('validate input site, period and allowed scope',()=>{
 for(const site of ['javascript:alert(1)','https://user:pass@website.vn','https://website.vn/admin','https://website.vn/?token=x']) assert.throws(()=>createRun(config({site})));
 for(const x of [{start:'2026-02-30'},{end:'2026-09-01'},{end:'2099-01-01'},{scope:[]},{scope:['admin']},{goal:'   '}])assert.throws(()=>createRun(config(x)));
 const r=createRun(config({site:'https://example.org',scope:['links']}));startRun(r);finish(r);
 assert.ok(r.tasks.every(t=>new URL(t.url).origin==='https://example.org'));
 assert.equal(r.tasks.filter(t=>t.status==='verified').length,1);
});
test('Excel CSV escapes quotes, multiline notes and formula prefixes',()=>{
 const r=createRun(config());startRun(r);finish(r);updateNote(r,'SEO-01','=HYPERLINK("https://example.org")\nGhi chú');
 const csv=toCsv(r);assert.equal(csv[0],'\ufeff');assert.ok(csv.includes("\"'=HYPERLINK(\"\"https://example.org\"\")\nGhi chú\""));assert.ok(csv.includes('DEMO - chưa sửa website'));
});
