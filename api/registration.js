import {settings,uuid} from '../lib/core.js';
import {DB} from '../lib/db.js';
import {nonce,validNonce,validateSignup,checkTurnstile} from '../lib/registration.js';
export function registrationHandler(c,db=new DB(c),{siteKey='',turnstileSecret='',verifyBot=checkTurnstile}={}){
 return async(req,res)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type','application/json');res.setHeader('X-Content-Type-Options','nosniff');
  const reply=(s,data)=>{res.statusCode=s;res.end(JSON.stringify(data));};
  const u=new URL(req.url,'https://localhost');const id=typeof req.query?.campaign==='string'?req.query.campaign:u.searchParams.get('campaign');
  if(!uuid(id))return reply(404,{error:'Webinar not found'});
  if(!['GET','POST'].includes(req.method))return reply(405,{error:'Method not allowed'});
  if(!!siteKey!==!!turnstileSecret)return reply(503,{error:'Registration is temporarily unavailable'});
  try{
   const rows=await db.get('campaigns','select=id,title,webinar_when,body,company_name,registration_open&id=eq.'+id);
   const webinar=rows[0];if(!webinar||!webinar.registration_open)return reply(404,{error:'Registration is not open for this webinar'});
   if(req.method==='GET')return reply(200,{webinar:{id:webinar.id,title:webinar.title,when:webinar.webinar_when,description:webinar.body.replaceAll('{{first_name}}','you').replaceAll('{{last_name}}',''),company:webinar.company_name},nonce:nonce(id,c.secret),turnstile_site_key:siteKey});
   let body=req.body;try{if(typeof body==='string')body=JSON.parse(body);}catch{return reply(400,{error:'Invalid registration'});}
   if(!validNonce(body?.nonce,id,c.secret))return reply(400,{error:'This form has expired. Refresh the page and try again.'});
   let values;try{values=validateSignup(body);}catch(e){return reply(400,{error:e.message});}
   if(!await verifyBot(body.turnstile_token,turnstileSecret))return reply(400,{error:'Please complete the verification and try again.'});
   await db.rpc('register_for_campaign',{p_campaign:id,p_email:values.email,p_first:values.first,p_last:values.last,p_organization:values.organization,p_opt_in:values.optIn});
   return reply(200,{ok:true,title:webinar.title,when:webinar.webinar_when,message:'You’re registered. Thank you for joining us.'});
  }catch(error){console.error('Registration request failed:',error.code||'request');return reply(error.code==='P0001'?409:503,{error:error.code==='P0001'?'Registration has closed.':'We couldn’t save your registration. Please try again.'});}
 };
}
export default async(req,res)=>{
 try{return await registrationHandler(settings(),undefined,{siteKey:process.env.TURNSTILE_SITE_KEY||'',turnstileSecret:process.env.TURNSTILE_SECRET_KEY||''})(req,res);}
 catch{res.statusCode=503;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({error:'Registration is temporarily unavailable'}));}
};
