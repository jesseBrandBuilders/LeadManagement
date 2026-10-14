import {settings,uuid,validateCampaign,normalizeLeads,mime,emailValid} from '../lib/core.js';
import {DB,authorize} from '../lib/db.js';
import {accessToken} from '../lib/gmail.js';
import {runWorker,deliver} from '../lib/worker.js';
import {randomUUID} from 'node:crypto';
export function makeApp(c,{db=new DB(c),auth=authorize,tokenProvider=accessToken,worker=runWorker}={}){
 return async(req,res)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type','application/json');
  const reply=(status,data)=>{res.statusCode=status;res.end(JSON.stringify(data));};
  try{
   const url=new URL(req.url,'https://localhost');const action=typeof req.query?.action==='string'?req.query.action:url.searchParams.get('action')||'dashboard';
   if(action==='config')return reply(200,{supabase_url:c.supabase,anon_key:c.anon,admin_email:c.admin});
   if(!['GET','POST'].includes(req.method))return reply(405,{error:'Method not allowed'});
   await auth(req,c);
   const reads=['dashboard','campaign','setup'];if(!reads.includes(action)&&req.method!=='POST')return reply(405,{error:'Use POST'});
   let body=req.body||{};if(typeof body==='string'){try{body=JSON.parse(body);}catch{return reply(400,{error:'Invalid JSON'});}}
   if(action==='setup')return reply(200,{sender:c.sender,send_enabled:c.enabled,daily_cap:c.cap,google_configured:!!(c.client&&c.clientSecret&&c.refresh),app_url:c.app});
   if(action==='check_google'){await tokenProvider(c);return reply(200,{ok:true,message:'Google token refresh succeeded. Send a self-test to verify the sender.'});}
   if(action==='dashboard'){
    const [campaigns,lists,contacts,memberships]=await Promise.all([db.all('campaigns','select=*&order=created_at.desc,id.asc'),db.all('lead_lists','select=*&order=created_at.desc,id.asc'),db.all('contacts','select=id,email,first_name,last_name,organization,unsubscribed_at,created_at&order=created_at.desc,id.asc'),db.all('list_memberships','select=*&order=list_id.asc,contact_id.asc')]);
    return reply(200,{campaigns,lists:lists.map(l=>({...l,count:memberships.filter(m=>m.list_id===l.id).length})),contacts});
   }
   if(action==='import'){
    if(typeof body.name!=='string'||!body.name.trim()||body.name.length>120)throw new Error('Name this lead list');const parsed=normalizeLeads(body.rows);
    return reply(200,{...await db.rpc('import_leads',{p_name:body.name.trim(),p_rows:parsed.valid}),invalid:parsed.invalid,duplicates:parsed.duplicates});
   }
   if(action==='suppress'){
    const email=String(body.email||'').trim().toLowerCase();if(!emailValid(email))throw new Error('Invalid email');
    const changed=await db.patch('contacts','email=eq.'+encodeURIComponent(email),{unsubscribed_at:new Date().toISOString()});return reply(200,{updated:changed.length});
   }
   if(action==='create'){
    const newId=randomUUID();const proposed={...body,registration_url:body.registration_url?.trim()||c.app+'/register/'+newId};
    const data=validateCampaign(proposed);if(body.followup_from&&!uuid(body.followup_from))throw new Error('Invalid follow-up campaign');
    const rows=await db.insert('campaigns',{id:newId,...data,followup_from:body.followup_from||null});return reply(200,rows[0]);
   }
   const id=body.id||url.searchParams.get('id');if(!uuid(id))throw new Error('Valid campaign ID required');
   const campaigns=await db.get('campaigns','select=*&id=eq.'+id);const campaign=campaigns[0];if(!campaign)return reply(404,{error:'Campaign not found'});
   if(action==='campaign')return reply(200,{campaign,registration_page_url:c.app+'/register/'+id,...await db.rpc('campaign_report',{p_id:id})});
   if(action==='save')return reply(200,await db.rpc('save_campaign',{p_id:id,p_version:body.version,p_data:validateCampaign({...body,registration_url:body.registration_url?.trim()||c.app+'/register/'+id})}));
   if(action==='registration_toggle'){
    if(typeof body.enabled!=='boolean')throw new Error('Choose whether registration is open');
    await db.patch('campaigns','id=eq.'+id,{registration_open:body.enabled,...(!body.enabled&&campaign.status==='sending'?{status:'paused'}:{})});return reply(200,{ok:true});
   }
   if(action==='start'){
    if(!c.enabled)throw new Error('Sending is disabled in server settings');validateCampaign(campaign);
    if(campaign.registration_url===c.app+'/register/'+id&&!campaign.registration_open)throw new Error('Open the built-in registration page before sending');
    return reply(200,await db.rpc('start_campaign',{p_id:id}));
   }
   if(action==='pause'){
    await db.patch('campaigns','id=eq.'+id+'&status=eq.sending',{status:'paused'});return reply(200,{ok:true});
   }
   if(action==='registrations'){
    const parsed=normalizeLeads((body.emails||[]).map(email=>({email})));
    const matched=await db.rpc('import_registrations',{p_campaign:id,p_emails:parsed.valid.map(x=>x.email)});
    return reply(200,{matched,unmatched:parsed.valid.length-matched,invalid:parsed.invalid});
   }
   if(action==='test'){
    if(!c.enabled)throw new Error('Sending is disabled in server settings');if(campaign.status!=='draft')throw new Error('Tests are available on drafts');validateCampaign(campaign);
    if(campaign.registration_url===c.app+'/register/'+id&&!campaign.registration_open)throw new Error('Open the built-in registration page before testing');
    const token=await tokenProvider(c);const owner=await db.rpc('acquire_worker');if(!owner)return reply(409,{error:'A sender is already running. Try the test again shortly.'});
    try{
     const attempts=await db.all('recipients','select=id&attempted_at=gte.'+encodeURIComponent(new Date(Date.now()-86400000).toISOString())+'&order=id.asc');if(attempts.length>=c.cap)throw new Error('Daily send cap reached');
     const [recipient]=await db.insert('recipients',{campaign_id:id,email:c.sender,first_name:'Jesse',last_name:'Roberts',is_test:true,snapshot:campaign,status:'sending',attempted_at:new Date().toISOString(),claim_id:owner});
     const result=await deliver(db,c,recipient,token);if(result.status==='accepted')await db.patch('campaigns','id=eq.'+id+'&version=eq.'+campaign.version+'&status=eq.draft',{tested_version:campaign.version});
     return reply(200,result);
    }finally{await db.rpc('release_worker',{p_owner:owner});}
   }
   if(action==='resolve'){
    if(body.confirmed!==true||!uuid(body.recipient_id)||!['accepted','queued','failed'].includes(body.status))throw new Error('Confirm Gmail Sent Mail review first');
    if(campaign.status==='sending')throw new Error('Pause the campaign before resolving a message');
    const rows=await db.patch('recipients','id=eq.'+body.recipient_id+'&campaign_id=eq.'+id+'&status=in.(uncertain,failed)',{status:body.status,error:'Manually resolved after Gmail Sent Mail review',...(body.status==='accepted'?{accepted_at:new Date().toISOString()}:{} )});
    return reply(200,{updated:rows.length});
   }
   return reply(404,{error:'Unknown action'});
  }catch(error){console.error('App operation failed:',error.status||error.code||'request');return reply(error.status||400,{error:error.db&&error.code!=='P0001'?'Database operation failed. Check schema, permissions, or campaign state.':error.message});}
 };
}
export default async(req,res)=>{try{return await makeApp(settings())(req,res);}catch{res.statusCode=503;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({error:'Server configuration is incomplete. See the setup guide.'}));}};
