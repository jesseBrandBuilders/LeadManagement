export async function accessToken(c,fetcher=fetch){
 if(!c.client||!c.clientSecret||!c.refresh)throw new Error('Google OAuth credentials are not configured');
 const r=await fetcher('https://oauth2.googleapis.com/token',{method:'POST',signal:AbortSignal.timeout(10000),headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:c.client,client_secret:c.clientSecret,refresh_token:c.refresh,grant_type:'refresh_token'})});
 const data=await r.json();if(!r.ok||!data.access_token)throw new Error('Google authorization failed. Check or reauthorize your refresh token.');return data.access_token;
}
export async function sendGmail(raw,token,fetcher=fetch){
 let r;try{r=await fetcher('https://gmail.googleapis.com/gmail/v1/users/me/messages/send',{method:'POST',signal:AbortSignal.timeout(12000),headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({raw})});}
 catch{throw Object.assign(new Error('Gmail response was interrupted. Inspect Sent Mail before retrying.'),{uncertain:true});}
 let data;try{data=await r.json();}catch{throw Object.assign(new Error('Gmail returned an unreadable response. Review before retrying.'),{uncertain:true});}
 if(!r.ok){throw Object.assign(new Error('Gmail rejected the request (HTTP '+r.status+'). Check authorization, account limits, or message configuration.'),{uncertain:r.status>=500});}
 if(!data.id)throw Object.assign(new Error('Gmail did not return a message ID. Review before retrying.'),{uncertain:true});return data.id;
}
