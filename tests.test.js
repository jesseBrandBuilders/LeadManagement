import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {normalizeLeads,validateCampaign,mime,sign,verify} from './lib/core.js';
import {DB,authorize} from './lib/db.js';
import {accessToken,sendGmail} from './lib/gmail.js';
import {deliver,runWorker} from './lib/worker.js';
import {makeApp} from './api/app.js';
import {tracking} from './api/tracking.js';
import {parseCSV,detect,mapRows,exportCSV} from './public/csv.js';
const id='12345678-1234-1234-1234-123456789abc';
const c={sender:'jesse@r3vcore.com',admin:'jesse@r3vcore.com',app:'https://app.example.com',secret:'x'.repeat(40),supabase:'https://db.supabase.co',anon:'anon',service:'server',client:'client',clientSecret:'private',refresh:'refresh',enabled:true,cap:200};
const campaign={id,name:'Webinar',list_id:null,subject:'Join us, {{first_name}} — a useful conversation',title:'A useful conversation',webinar_when:'Thursday 2 PM Eastern',body:'A clear benefit.\n\nSome practical takeaways.',registration_url:'https://example.com/register',company_name:'R3VCORE',postal_address:'123 Main St',contact_reason:'You subscribed',version:1,status:'draft'};
const recipient={id,campaign_id:id,contact_id:id,email:'lead@example.com',first_name:'<José & JR>',last_name:'Reed',snapshot:campaign,is_test:false};
function response(){return {headers:{},setHeader(k,v){this.headers[k]=v;},end(v){this.body=v;}};}
test('CSV handles BOM, quoted commas, Unicode, CRLF, escaped quotes and multiline values',()=>{
 const csv=parseCSV('\uFEFFEmail,First Name,Last Name,Organization\r\nlead@example.com,José,Reed,"School, Inc."\r\nsecond@example.com,"Alex ""AJ""",Brooks,"Line one\nLine two"\r\n');
 const rows=mapRows(csv,detect(csv.headers));assert.equal(rows.length,2);assert.equal(rows[0].first_name,'José');assert.equal(rows[0].organization,'School, Inc.');assert.equal(rows[1].first_name,'Alex "AJ"');assert.equal(rows[1].organization,'Line one\nLine two');
 assert.throws(()=>parseCSV('Email,Name\na@example.com,"unfinished'));assert.throws(()=>parseCSV('Email\na,b'));
});
test('CSV export prevents spreadsheet formula execution',()=>{const out=exportCSV([{email:'=HYPERLINK("bad")',name:'@SUM(1)'}],['email','name']);assert(out.includes("'=HYPERLINK"));assert(out.includes("'@SUM"));});
test('lead import normalizes, deduplicates and rejects header injection',()=>{
 const p=normalizeLeads([{email:' LEAD@EXAMPLE.COM ',first_name:' Alex '},{email:'lead@example.com'},{email:'bad'},{email:'x@example.com\r\nBcc: y@example.com'}]);assert.equal(p.valid.length,1);assert.equal(p.valid[0].email,'lead@example.com');assert.equal(p.valid[0].first_name,'Alex');assert.equal(p.invalid,2);assert.equal(p.duplicates,1);
});
test('campaign validation rejects missing fields, unsafe registration URLs and injected subject headers',()=>{
 assert.equal(validateCampaign(campaign).company_name,'R3VCORE');assert.throws(()=>validateCampaign({...campaign,subject:'x\r\nBcc: a@example.com'}));assert.throws(()=>validateCampaign({...campaign,postal_address:''}));assert.throws(()=>validateCampaign({...campaign,registration_url:'javascript:alert(1)'}));
});
test('MIME is base64url, Unicode-safe, escaped, multipart and contains signed tracking links',()=>{
 const m=mime(recipient,c);assert(!/[+/=]/.test(m.raw));const raw=Buffer.from(m.raw,'base64url').toString();assert(raw.includes('From: Jesse <jesse@r3vcore.com>'));assert(raw.includes('multipart/alternative'));assert(m.html.includes('&lt;José &amp; JR&gt;'));assert(m.plain.includes('/c/'));assert(m.html.includes('/o/'));assert(m.html.includes('/u/'));assert(!m.html.includes('lead@example.com'));
 const token=sign(id,c.secret);assert.equal(verify(token,c.secret),id);assert.equal(verify(token.slice(0,-1)+'!',c.secret),null);assert.equal(verify('bad',c.secret),null);
});
test('Supabase Auth checks confirmed allowlisted admin against the actual user endpoint',async()=>{
 const req={headers:{authorization:'Bearer token'}};
 assert.equal((await authorize(req,c,async()=>({ok:true,json:async()=>({email:c.admin,email_confirmed_at:'now'})}))).email,c.admin);
 await assert.rejects(()=>authorize(req,c,async()=>({ok:true,json:async()=>({email:'other@example.com',email_confirmed_at:'now'})})),e=>e.status===403);
 await assert.rejects(()=>authorize(req,c,async()=>({ok:true,json:async()=>({email:c.admin})})),e=>e.status===403);
 await assert.rejects(()=>authorize({headers:{}},c),e=>e.status===401);
});
test('DB keeps service role server-side and surfaces failed RPC instead of assuming success',async()=>{
 let options;const db=new DB(c,async(url,o)=>{options=o;return {ok:true,text:async()=>JSON.stringify([{id}])};});await db.insert('campaigns',campaign);assert.equal(options.headers.Authorization,'Bearer server');
 const bad=new DB(c,async()=>({ok:false,text:async()=>JSON.stringify({code:'P0001',message:'Review uncertain sends'})}));await assert.rejects(()=>bad.rpc('start_campaign'),e=>e.db&&e.code==='P0001');
});
test('Google refresh sends existing OAuth values and never returns/logs refresh token',async()=>{
 let body;const token=await accessToken(c,async(url,o)=>{body=o.body;return {ok:true,json:async()=>({access_token:'short-lived'})};});assert.equal(token,'short-lived');assert.equal(body.get('refresh_token'),'refresh');
 await assert.rejects(()=>accessToken(c,async()=>({ok:false,json:async()=>({error:'invalid_grant'})})),/authorization failed/);
});
test('Gmail send classifies interrupted/5xx responses as uncertain and definite rejection as failed',async()=>{
 await assert.rejects(()=>sendGmail('raw','token',async()=>{throw new Error('timeout');}),e=>e.uncertain===true);
 await assert.rejects(()=>sendGmail('raw','token',async()=>({ok:false,status:503,json:async()=>({})})),e=>e.uncertain===true);
 await assert.rejects(()=>sendGmail('raw','token',async()=>({ok:false,status:403,json:async()=>({})})),e=>e.uncertain===false);
 assert.equal(await sendGmail('raw','token',async()=>({ok:true,json:async()=>({id:'gmail123'})})),'gmail123');
});
test('failed send pauses campaign; unknown result is never re-sent by deliver',async()=>{
 const writes=[];let sends=0;const db={patch:async(t,q,data)=>{writes.push({t,data});return [data];}};
 const result=await deliver(db,c,recipient,'token',async()=>{sends++;throw Object.assign(new Error('Unknown outcome'),{uncertain:true});});
 assert.equal(result.status,'uncertain');assert.equal(sends,1);assert.equal(writes[0].data.status,'uncertain');assert.equal(writes[1].data.status,'paused');
});
test('Gmail accepted/database-save failure is uncertain and never retried',async()=>{
 let sends=0,calls=0;const db={patch:async()=>{calls++;if(calls===1)throw new Error('DB timeout');return [{}];}};
 assert.equal((await deliver(db,c,recipient,'token',async()=>{sends++;return 'gmail123';})).status,'uncertain');assert.equal(sends,1);
});
test('worker honors lease, suppression, batch size and releases the lock',async()=>{
 let claimed=0,sends=0,released=false;const updates=[];
 const db={rpc:async(name)=>{if(name==='acquire_worker')return 'owner';if(name==='release_worker'){released=true;return;}if(name==='claim_recipient'){claimed++;return claimed<=2?[{...recipient,id:claimed===1?id:'22345678-1234-1234-1234-123456789abc'}]:[];}},get:async()=>[{unsubscribed_at:claimed===1?'now':null}],patch:async(t,q,d)=>{updates.push(d);return [d];}};
 const result=await runWorker(db,c,{tokenProvider:async()=> 'token',send:async()=>{sends++;return 'google';}});assert.equal(sends,1);assert.equal(result.processed,1);assert(released);assert.equal(updates[0].status,'skipped');
 const locked={rpc:async()=>null};assert((await runWorker(locked,c,{tokenProvider:async()=> 'token'})).busy);
 await assert.rejects(()=>runWorker(db,{...c,enabled:false}),/disabled/);
});
test('public config exposes only public Auth settings; admin writes require authorization',async()=>{
 const res=response();await makeApp(c,{db:{},auth:async()=>{throw Object.assign(new Error('Unauthorized'),{status:401});}})({method:'GET',url:'/api/app?action=config',headers:{}},res);
 const publicData=JSON.parse(res.body);assert(!JSON.stringify(publicData).includes('server'));assert(!('refresh' in publicData));
 const denied=response();await makeApp(c,{db:{},auth:async()=>{throw Object.assign(new Error('Unauthorized'),{status:401});}})({method:'POST',url:'/api/app?action=start',headers:{},body:{id}},denied);assert.equal(denied.statusCode,401);
});
test('tracking confirms POST only after durable suppression, rejects tampering, and records a click',async()=>{
 let suppressed=0,events=0;const db={get:async()=>[{id,snapshot:campaign}],rpc:async()=>{suppressed++;},insert:async()=>{events++;}};const token=sign(id,c.secret);const req=(kind,method='GET')=>({url:'/api/tracking',query:{kind,token},method});
 let res=response();await tracking(c,db)(req('unsubscribe'),res);assert.equal(suppressed,0);assert.equal(res.statusCode,200);
 res=response();await tracking(c,db)(req('unsubscribe','POST'),res);assert.equal(suppressed,1);assert.equal(res.statusCode,200);
 res=response();await tracking(c,db)(req('click'),res);assert.equal(events,1);assert.equal(res.headers.Location,campaign.registration_url);
 res=response();await tracking(c,db)({...req('click'),query:{kind:'click',token:'bad'}},res);assert.equal(res.statusCode,404);
 res=response();await tracking(c,{...db,rpc:async()=>{throw new Error('offline');}})(req('unsubscribe','POST'),res);assert.equal(res.statusCode,503);
});
test('database security and queue migration include grants, locks, version checks and no automatic uncertain retry',async()=>{
 const sql=await readFile(new URL('./supabase/schema.sql',import.meta.url),'utf8');
 assert(sql.includes('enable row level security'));assert(sql.includes('from public, anon, authenticated'));assert(sql.includes('for update of r skip locked'));assert(sql.includes('c.tested_version is distinct from c.version'));assert(sql.includes("status='uncertain'"));assert(!sql.includes("status='queued' where status='uncertain'"));
});
