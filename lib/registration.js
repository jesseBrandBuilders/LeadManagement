import {createHmac} from 'node:crypto';
import {secureEqual,emailValid} from './core.js';
export function nonce(campaign,secret,now=Date.now()){
 const payload=campaign+'.'+Math.floor(now/1000);return payload+'.'+createHmac('sha256',secret).update('registration-v1:'+payload).digest('base64url');
}
export function validNonce(value,campaign,secret,now=Date.now()){
 if(typeof value!=='string'||value.length>150)return false;
 const parts=value.split('.');if(parts.length!==3||parts[0]!==campaign||!/^\d+$/.test(parts[1]))return false;
 const time=Number(parts[1])*1000;if(time>now+30000||now-time>7200000)return false;
 return secureEqual(nonce(campaign,secret,time),value);
}
export function validateSignup(body){
 if(!body||typeof body!=='object'||body.company_website)throw new Error('Invalid registration');
 const email=String(body.email||'').trim().toLowerCase();
 const first=String(body.first_name||'').trim(),last=String(body.last_name||'').trim(),organization=String(body.organization||'').trim();
 if(!emailValid(email)||!first||!last||first.length>100||last.length>100||organization.length>200)throw new Error('Enter your name and a valid email address');
 if(body.marketing_opt_in!==undefined&&typeof body.marketing_opt_in!=='boolean')throw new Error('Invalid preference');
 return {email,first,last,organization,optIn:body.marketing_opt_in===true};
}
export async function checkTurnstile(token,secret,fetcher=fetch){
 if(!secret)return true;
 if(typeof token!=='string'||!token||token.length>4096)return false;
 const r=await fetcher('https://challenges.cloudflare.com/turnstile/v0/siteverify',{method:'POST',signal:AbortSignal.timeout(8000),body:new URLSearchParams({secret,response:token})});
 if(!r.ok)return false;return (await r.json()).success===true;
}
