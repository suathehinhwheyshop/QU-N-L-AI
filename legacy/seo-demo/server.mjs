import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
const files=new Map([
  ['/', ['index.html','text/html; charset=utf-8']],
  ['/index.html', ['index.html','text/html; charset=utf-8']],
  ['/styles.css', ['styles.css','text/css; charset=utf-8']],
  ['/app.mjs', ['app.mjs','text/javascript; charset=utf-8']],
  ['/workflow-engine.mjs', ['workflow-engine.mjs','text/javascript; charset=utf-8']],
  ['/orbit-general-demo.html', ['orbit-general-demo.html','text/html; charset=utf-8']],
]);
export function createAppServer(){return createServer(async(req,res)=>{
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Referrer-Policy','same-origin');
  res.setHeader('X-Frame-Options','SAMEORIGIN');
  if(!['GET','HEAD'].includes(req.method)){res.writeHead(405,{'Allow':'GET, HEAD'});res.end('Method not allowed');return}
  const [file,type]=files.get(new URL(req.url,'http://orbit.local').pathname)||[];
  if(!file){res.writeHead(404);res.end('Not found');return}
  try{const data=await readFile(new URL(file,import.meta.url));res.writeHead(200,{'Content-Type':type,'Cache-Control':'no-store'});res.end(req.method==='HEAD'?undefined:data)}catch{res.writeHead(500);res.end('Cannot load application')}
})}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const port=Number(process.env.PORT||3000);
  const server=createAppServer();
  server.on('error',e=>{console.error(`Cannot start Orbit: ${e.code}`);process.exitCode=1});
  server.listen(port,'0.0.0.0',()=>console.log(`Orbit SEO demo running on port ${port}`));
}
