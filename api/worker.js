import {settings,secureEqual} from '../lib/core.js';
import {DB,authorize} from '../lib/db.js';
import {runWorker} from '../lib/worker.js';
export default async(req,res)=>{
 res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type','application/json');
 try{const c=settings();const cron=c.cron&&c.cron.length>=32&&secureEqual(req.headers.authorization||'','Bearer '+c.cron);
  if(!cron){if(req.method!=='POST'){res.statusCode=405;res.end(JSON.stringify({error:'Use POST'}));return;}await authorize(req,c);}
  res.end(JSON.stringify(await runWorker(new DB(c),c)));
 }catch(e){res.statusCode=e.status||503;res.end(JSON.stringify({error:e.message||'Worker could not run'}));}
};
