import {mime} from './core.js';
import {accessToken,sendGmail} from './gmail.js';
export async function deliver(db,c,recipient,token,send=sendGmail){
 let gmailID;
 try{const {raw}=mime(recipient,c);gmailID=await send(raw,token);}
 catch(error){
  const status=error.uncertain?'uncertain':'failed';
  await db.patch('recipients','id=eq.'+recipient.id+'&status=eq.sending',{status,error:error.message});
  if(!recipient.is_test)await db.patch('campaigns','id=eq.'+recipient.campaign_id,{status:'paused',last_error:error.message});
  return {status,error:error.message};
 }
 try{
  const rows=await db.patch('recipients','id=eq.'+recipient.id+'&status=eq.sending',{status:'accepted',gmail_id:gmailID,accepted_at:new Date().toISOString(),error:null});
  if(rows.length!==1)throw new Error('Message status changed');
 }catch{
  // Never follow successful Gmail acceptance with another attempt.
  console.error('Gmail accepted a message but the database write failed; stale-claim recovery must review it');
  try{await db.patch('recipients','id=eq.'+recipient.id,{status:'uncertain',error:'Gmail accepted this message; final status was not saved. Inspect Sent Mail.'});await db.patch('campaigns','id=eq.'+recipient.campaign_id,{status:'paused',last_error:'Review a send whose status could not be saved'});}catch{}
  return {status:'uncertain',error:'Acceptance could not be saved. Inspect Sent Mail before continuing.'};
 }
 return {status:'accepted',gmail_id:gmailID};
}
export async function runWorker(db,c,{tokenProvider=accessToken,send=sendGmail}={}){
 if(!c.enabled)throw new Error('Sending is disabled. Set SEND_ENABLED=true after setup.');
 const token=await tokenProvider(c);
 const owner=await db.rpc('acquire_worker');if(!owner)return {processed:0,busy:true};
 const started=Date.now();const results=[];
 try{
  for(let i=0;i<3 && Date.now()-started<55000;i++){
   const rows=await db.rpc('claim_recipient',{p_owner:owner,p_cap:c.cap});if(!rows.length)break;
   const row=rows[0];
   // Re-check suppression immediately before each send. A pause stops subsequent claims.
   const contact=await db.get('contacts','select=unsubscribed_at&id=eq.'+row.contact_id);
   if(contact[0]?.unsubscribed_at){await db.patch('recipients','id=eq.'+row.id,{status:'skipped',error:'Unsubscribed'});continue;}
   const result=await deliver(db,c,row,token,send);results.push(result);
   if(result.status!=='accepted')break;
  }
  return {processed:results.length,results};
 }finally{try{await db.rpc('release_worker',{p_owner:owner});}catch{console.error('Worker lock release failed; lease will expire');}}
}
