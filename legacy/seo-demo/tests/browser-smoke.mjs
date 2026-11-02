// Requires Chromium with --remote-debugging-port=9229 and Orbit on port 3100.
import assert from 'node:assert/strict';
import {writeFile,mkdir} from 'node:fs/promises';
const origin=process.env.ORBIT_TEST_ORIGIN||'http://127.0.0.1:3100';
const tabs=await (await fetch('http://127.0.0.1:9229/json/list')).json();
const tab=tabs.find(t=>t.type==='page');
const ws=new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true})});
let seq=0;const pending=new Map(),errors=[];
ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.text);if(m.id){const p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result)}}};
function send(method,params={}){return new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));setTimeout(()=>{if(pending.delete(id))reject(Error('Timeout: '+method))},10000).unref()})}
async function evaluate(expression){const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result?.value}
async function waitFor(expression,ms=15000){const until=Date.now()+ms;while(Date.now()<until){if(await evaluate(expression))return;await new Promise(r=>setTimeout(r,120))}throw Error('Waiting for '+expression)}
async function click(selector){await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`)}
async function route(hash){await evaluate(`location.hash=${JSON.stringify(hash)}`);await waitFor(`document.querySelector('.nav-item.active').getAttribute('href')===${JSON.stringify(hash)}`)}
const checks=[];
try{
 await send('Runtime.enable');await send('Page.enable');
 await send('Page.navigate',{url:origin});await waitFor("document.querySelectorAll('.step').length===6");
 await evaluate("localStorage.removeItem('orbit-seo-demo-v1')");await send('Page.reload');await waitFor("document.querySelectorAll('.step').length===6");
 assert.match(await evaluate('document.body.innerText'),/Không gửi lệnh tới AI/);checks.push('demo disclosure and six steps');
 await click('[data-action="start"]');await waitFor("document.querySelectorAll('.step.done').length>=1");await click('[data-action="pause"]');
 const atPause=await evaluate("document.querySelectorAll('.step.done').length");
 await send('Page.reload');await waitFor("document.querySelector('[data-action=start]')?.textContent.includes('Tiếp tục')");
 assert.equal(await evaluate("document.querySelectorAll('.step.done').length"),atPause);checks.push('pause and reload recovery');
 await click('[data-action="start"]');await waitFor("document.querySelectorAll('.step.done').length===6");
 await route('#tasks');assert.equal(await evaluate('document.querySelectorAll("tbody tr").length'),4);assert.match(await evaluate('document.body.innerText'),/Ngoài phạm vi/);checks.push('closed pipeline produces four tasks, scoped execution');
 await click('[data-task="SEO-01"]');await evaluate("document.querySelector('#task-note').value='Ghi chú kiểm thử điện thoại'");await click('#save-note');await click('[data-task="SEO-01"]');assert.equal(await evaluate('document.querySelector("#task-note").value'),'Ghi chú kiểm thử điện thoại');await click('#task-done');checks.push('task note persistence');
 await click('[data-filter="blocked"]');assert.equal(await evaluate('document.querySelectorAll("tbody tr").length'),1);await click('[data-filter="all"]');
 await evaluate("const s=document.querySelector('#task-search');s.value='KHÔNG_TỒN_TẠI';s.dispatchEvent(new Event('input',{bubbles:true}))");assert.match(await evaluate('document.querySelector(".empty").textContent'),/Không có công việc/);checks.push('table filtering and search');
 await route('#data');assert.equal(await evaluate('document.querySelectorAll(".artifact-card").length'),6);await click('[data-artifact="report"]');assert.match(await evaluate('document.querySelector(".data-view").textContent'),/"websiteChanged": false/);await click('#artifact-done');checks.push('handoff artifacts and honest final report');
 await click('#create-run');await evaluate("document.querySelector('#scenario').value='export-error';document.querySelector('#run-form').requestSubmit()");await waitFor("document.querySelector('[data-action=start]')");await click('[data-action="start"]');await waitFor("document.querySelector('[data-action=retry]')");assert.equal(await evaluate('document.querySelectorAll(".step.done").length'),0);await click('[data-action="retry"]');await waitFor("document.querySelectorAll('.step.done').length===6");checks.push('failure blocks downstream; retry completes without duplication');
 await route('#tasks');assert.equal(await evaluate('document.querySelectorAll("tbody tr").length'),4);
 for(const width of [390,430]){
  await send('Emulation.setDeviceMetricsOverride',{width,height:844,deviceScaleFactor:1,mobile:true});
  for(const page of ['#workflow','#tasks','#data','#connections','#roadmap']){await route(page);const sizes=await evaluate('({scroll:document.documentElement.scrollWidth,width:innerWidth})');assert.ok(sizes.scroll<=width,`${page} overflows ${width}: ${JSON.stringify(sizes)}`)}
 }
 checks.push('all five screens fit 390px and 430px mobile viewports');
 await mkdir('docs/previews',{recursive:true});
 await route('#workflow');await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1150,deviceScaleFactor:1,mobile:false});await evaluate('scrollTo(0,0)');await new Promise(r=>setTimeout(r,200));
 let shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await writeFile('docs/previews/orbit-seo-desktop.png',Buffer.from(shot.data,'base64'));
 await send('Emulation.setDeviceMetricsOverride',{width:430,height:1370,deviceScaleFactor:2,mobile:true});await evaluate('scrollTo(0,0)');await new Promise(r=>setTimeout(r,200));
 shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await writeFile('docs/previews/orbit-seo-mobile.png',Buffer.from(shot.data,'base64'));
 await route('#tasks');await evaluate('scrollTo(0,0)');await new Promise(r=>setTimeout(r,200));shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await writeFile('docs/previews/orbit-seo-tasks-mobile.png',Buffer.from(shot.data,'base64'));
 assert.deepEqual(errors,[]);checks.push('no browser runtime exceptions');console.log(JSON.stringify({status:'PASS',checks,screenshots:'docs/previews'},null,2));
}finally{ws.close()}
