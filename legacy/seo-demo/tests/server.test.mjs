import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createAppServer} from '../server.mjs';
test('serves the real UI and modules, rejects unknown/private paths and write methods',async()=>{
 const server=createAppServer();await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve)});
 const origin=`http://127.0.0.1:${server.address().port}`;
 try{
 const page=await fetch(origin);assert.equal(page.status,200);assert.match(await page.text(),/id="run-form"/);
 for(const [path,mime] of [['/app.mjs','javascript'],['/workflow-engine.mjs','javascript'],['/styles.css','css']]){const res=await fetch(origin+path);assert.equal(res.status,200);assert.ok(res.headers.get('Content-Type').includes(mime));assert.ok((await res.text()).length>100)}
 for(const path of ['/missing','/.git/config','/package.json'])assert.equal((await fetch(origin+path)).status,404);
 assert.equal((await fetch(origin,{method:'POST'})).status,405);
 const head=await fetch(origin,{method:'HEAD'});assert.equal(head.status,200);assert.equal(await head.text(),'');
 }finally{await new Promise(resolve=>server.close(resolve))}
});
