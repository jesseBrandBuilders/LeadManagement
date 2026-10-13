import {createHmac,timingSafeEqual,randomUUID} from 'node:crypto';
export const uuid=s=>typeof s==='string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(s);
export const emailValid=s=>typeof s==='string' && s.length<=254 && /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,63}$/.test(s);
export const escape=s=>String(s??'').replace(/[&<>"']/g,x=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x]));
export function secureEqual(a,b){const x=Buffer.from(String(a)),y=Buffer.from(String(b));return x.length===y.length&&timingSafeEqual(x,y);}
export function settings(env=process.env){
 const url=(s)=>{const u=new URL(s);if(u.protocol!=='https:'||u.username||u.password||u.pathname!=='/'||u.search||u.hash)throw new Error('HTTPS origin required');return u.origin;};
 const c={supabase:url(env.SUPABASE_URL),anon:env.SUPABASE_ANON_KEY,service:env.SUPABASE_SERVICE_ROLE_KEY,admin:(env.ADMIN_EMAIL||'jesse@r3vcore.com').toLowerCase(),sender:env.GMAIL_ADDRESS||'jesse@r3vcore.com',app:url(env.APP_URL),secret:env.TRACKING_SECRET,client:env.GOOGLE_CLIENT_ID,clientSecret:env.GOOGLE_CLIENT_SECRET,refresh:env.GOOGLE_REFRESH_TOKEN,cron:env.CRON_SECRET,cap:Number(env.DAILY_SEND_CAP||200),enabled:env.SEND_ENABLED==='true'};
 if(!c.anon||!c.service||!c.secret||c.secret.length<32||!emailValid(c.sender)||!emailValid(c.admin)||!Number.isInteger(c.cap)||c.cap<1||c.cap>2000)throw new Error('Incomplete server settings');
 return c;
}
export function sign(id,secret){return id+'.'+createHmac('sha256',secret).update('r3vcore-mail-v1:'+id).digest('base64url');}
export function verify(token,secret){if(typeof token!=='string'||token.length!==80)return null;const id=token.slice(0,36);return uuid(id)&&secureEqual(sign(id,secret),token)?id:null;}
export function registration(value){const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password||u.port&&u.port!=='443'||u.hostname==='localhost'||/^[\d.]+$/.test(u.hostname))throw new Error('Use a public HTTPS registration URL');return u.href;}
export function validateCampaign(data){
 const fields=['name','subject','title','webinar_when','body','registration_url','company_name','postal_address','contact_reason'];
 const result={};for(const k of fields){if(typeof data[k]!=='string'||!data[k].trim()||data[k].length>(k==='body'?12000:2000))throw new Error('Complete all campaign fields');result[k]=data[k].trim();}
 if(result.subject.length>180||/[\r\n]/.test(result.subject))throw new Error('Subject must be one line, under 180 characters');
 result.registration_url=registration(result.registration_url);
 result.list_id=data.list_id||null;if(result.list_id&&!uuid(result.list_id))throw new Error('Invalid lead list');
 return result;
}
export function normalizeLeads(rows){
 if(!Array.isArray(rows)||rows.length>2000)throw new Error('Upload up to 2,000 rows at a time');
 const seen=new Set(),valid=[];let invalid=0,duplicates=0;
 for(const r of rows){const email=String(r.email??'').trim().toLowerCase();if(!emailValid(email)){invalid++;continue;}if(seen.has(email)){duplicates++;continue;}seen.add(email);valid.push({email,first_name:String(r.first_name??'').trim().slice(0,100),last_name:String(r.last_name??'').trim().slice(0,100),organization:String(r.organization??'').trim().slice(0,200)});}
 if(!valid.length)throw new Error('No valid email addresses in this file');return {valid,invalid,duplicates};
}
export function mime(recipient,c){
 const s=recipient.snapshot;validateCampaign(s);
 const name=recipient.first_name?.trim()||'there';const token=sign(recipient.id,c.secret);
 const links={click:c.app+'/c/'+token,open:c.app+'/o/'+token,unsubscribe:c.app+'/u/'+token};
 const merge=t=>t.replaceAll('{{first_name}}',name).replaceAll('{{last_name}}',recipient.last_name||'');
 const body=merge(s.body);const subject=merge(s.subject);
 if(/[\r\n]/.test(subject)||subject.length>300||!emailValid(recipient.email))throw new Error('Invalid message headers');
 const plain=`Hi ${name},\n\n${body}\n\n${s.title}\n${s.webinar_when}\n\nRegister: ${links.click}\n\nHope you can join us,\nJesse\n${s.company_name}\n\n${s.contact_reason}\n${s.postal_address}\nUnsubscribe: ${links.unsubscribe}`;
 const html=`<!doctype html><html><body style="margin:0;background:#f5f7f7;font-family:Arial,sans-serif;color:#23333b;line-height:1.65"><div style="max-width:580px;margin:24px auto;background:white;padding:32px"><p>Hi ${escape(name)},</p>${body.split(/\n\s*\n/).map(p=>'<p>'+escape(p).replaceAll('\n','<br>')+'</p>').join('')}<h2 style="font-size:22px">${escape(s.title)}</h2><p>${escape(s.webinar_when)}</p><p><a style="display:inline-block;padding:12px 22px;border-radius:6px;background:#087e83;color:white;text-decoration:none" href="${escape(links.click)}">Save your seat</a></p><p>Hope you can join us,<br>Jesse<br>${escape(s.company_name)}</p><hr style="border:0;border-top:1px solid #eee"><p style="font-size:12px;color:#6b7b80">${escape(s.contact_reason)}<br>${escape(s.company_name)} · ${escape(s.postal_address)}<br><a href="${escape(links.unsubscribe)}">Unsubscribe</a></p><img src="${escape(links.open)}" width="1" height="1" alt=""></div></body></html>`;
 const b64=t=>Buffer.from(t).toString('base64').match(/.{1,76}/g).join('\r\n');
 const chunks=[];let part='';for(const ch of subject){if(Buffer.byteLength(part+ch)>42){chunks.push(part);part='';}part+=ch;}if(part)chunks.push(part);
 const encodedSubject=chunks.map(t=>'=?UTF-8?B?'+Buffer.from(t).toString('base64')+'?=').join('\r\n ');const boundary='mail_'+randomUUID();
 const raw=[`From: Jesse <${c.sender}>`,`To: ${recipient.email}`,`Reply-To: ${c.sender}`,`Subject: ${encodedSubject}`,`Date: ${new Date().toUTCString()}`,`Message-ID: <${recipient.id}@${c.sender.split('@')[1]}>`,'MIME-Version: 1.0',`List-Unsubscribe: <${links.unsubscribe}>`,`Content-Type: multipart/alternative; boundary="${boundary}"`,'',`--${boundary}`,'Content-Type: text/plain; charset=UTF-8','Content-Transfer-Encoding: base64','',b64(plain),`--${boundary}`,'Content-Type: text/html; charset=UTF-8','Content-Transfer-Encoding: base64','',b64(html),`--${boundary}--`,''].join('\r\n');
 return {raw:Buffer.from(raw).toString('base64url'),html,plain};
}
