export async function accessToken(console.log('Google OAuth configuration', {
  clientIdPresent: Boolean(c.client),
  clientSecretPresent: Boolean(c.clientSecret),
  refreshTokenPresent: Boolean(c.refresh),
  deployment: process.env.VERCEL_ENV
})};
}
export async function sendGmail(raw,token,fetcher=fetch){
 let r;try{r=await fetcher('https://gmail.googleapis.com/gmail/v1/users/me/messages/send',{method:'POST',signal:AbortSignal.timeout(12000),headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({raw})});}
 catch{throw Object.assign(new Error('Gmail response was interrupted. Inspect Sent Mail before retrying.'),{uncertain:true});}
 let data;try{data=await r.json();}catch{throw Object.assign(new Error('Gmail returned an unreadable response. Review before retrying.'),{uncertain:true});}
 if(!r.ok){throw Object.assign(new Error('Gmail rejected the request (HTTP '+r.status+'). Check authorization, account limits, or message configuration.'),{uncertain:r.status>=500});}
 if(!data.id)throw Object.assign(new Error('Gmail did not return a message ID. Review before retrying.'),{uncertain:true});return data.id;
}
