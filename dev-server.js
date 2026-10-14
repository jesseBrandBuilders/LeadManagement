import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import app from './api/app.js';
import worker from './api/worker.js';
import tracking from './api/tracking.js';
import registration from './api/registration.js';
const root=fileURLToPath(new URL('./public/',import.meta.url));
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8'};
http.createServer(async(req,res)=>{
 try{const u=new URL(req.url,'http://localhost');req.query=Object.fromEntries(u.searchParams);
  if(u.pathname.startsWith('/api/')||/^\/(o|c|u)\//.test(u.pathname)){
   let body='';for await(const chunk of req){body+=chunk;if(body.length>2e6){res.statusCode=413;res.end('Request too large');return;}}req.body=body?JSON.parse(body):{};
   if(u.pathname==='/api/app')return app(req,res);if(u.pathname==='/api/worker')return worker(req,res);if(u.pathname==='/api/registration')return registration(req,res);
   const match=u.pathname.match(/^\/(o|c|u)\/(.+)$/);if(match)req.query={kind:({o:'open',c:'click',u:'unsubscribe'})[match[1]],token:match[2]};
   return tracking(req,res);
  }
  const file=path.resolve(root,'.'+(u.pathname==='/'?'/index.html':/^\/register\/[a-f0-9-]+$/i.test(u.pathname)?'/registration.html':u.pathname));
  if(!file.startsWith(root+path.sep)&&file!==path.join(root,'index.html')){res.statusCode=403;res.end();return;}
  res.setHeader('Content-Type',types[path.extname(file)]||'application/octet-stream');res.end(await readFile(file));
 }catch{res.statusCode=404;res.end('Not found');}
}).listen(Number(process.env.PORT||3000),'127.0.0.1',()=>console.log('Webinar Studio: http://localhost:'+(process.env.PORT||3000)+'/?demo=1'));
