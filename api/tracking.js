import {settings,verify,registration} from '../lib/core.js';
import {DB} from '../lib/db.js';
const pixel=Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7','base64');
export function tracking(c,db=new DB(c)){return async(req,res)=>{
 res.setHeader('Cache-Control','no-store, max-age=0');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Content-Security-Policy',"default-src 'none'; form-action 'self'; frame-ancestors 'none'");
 const reply=(s,b,t='text/plain; charset=utf-8')=>{res.statusCode=s;res.setHeader('Content-Type',t);res.end(b);};
 const u=new URL(req.url,'https://localhost'),get=k=>typeof req.query?.[k]==='string'?req.query[k]:u.searchParams.get(k);
 const kind=get('kind'),id=verify(get('token'),c.secret);if(!id||!['open','click','unsubscribe'].includes(kind))return reply(404,'Invalid link');
 if((kind==='unsubscribe'&&!['GET','POST'].includes(req.method))||(kind!=='unsubscribe'&&req.method!=='GET'))return reply(405,'Method not allowed');
 if(kind==='unsubscribe'&&req.method==='GET')return reply(200,'<!doctype html><html><body><h2>Unsubscribe from future invitations</h2><p>Confirm below to stop receiving these emails.</p><form method="post"><button type="submit">Unsubscribe</button></form></body></html>','text/html; charset=utf-8');
 try{
  const rows=await db.get('recipients','select=id,email,snapshot&id=eq.'+id);const row=rows[0];if(!row)return reply(404,'Message not found');
  if(kind==='unsubscribe'){await db.rpc('suppress_recipient',{p_id:id});return reply(200,'You are unsubscribed from future invitations.');}
  const destination=kind==='click'?registration(row.snapshot.registration_url):null;
  try{await db.insert('email_events',{recipient_id:id,kind:kind==='open'?'image_load':'link_request'});}catch{console.error('A tracking event could not be saved');}
  if(kind==='open')return reply(200,pixel,'image/gif');res.setHeader('Location',destination);return reply(302,'');
 }catch{console.error('Tracking request failed');return reply(503,'Temporarily unavailable. Please try again.');}
};}
export default async(req,res)=>{try{return await tracking(settings())(req,res);}catch{res.statusCode=503;res.end('Tracker unavailable');}};
