export class DB {
 constructor(c,fetcher=fetch){this.c=c;this.fetcher=fetcher;}
 async request(path,{method='GET',body,prefer}={}){
  const r=await this.fetcher(this.c.supabase+'/rest/v1/'+path,{method,redirect:'error',signal:AbortSignal.timeout(8000),headers:{apikey:this.c.service,Authorization:'Bearer '+this.c.service,'Content-Type':'application/json',...(prefer?{Prefer:prefer}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const text=await r.text();let data;try{data=text?JSON.parse(text):null;}catch{throw new Error('Unexpected database response');}
  if(!r.ok){const e=new Error(data?.message||'Database request failed');e.db=true;e.code=data?.code;throw e;}return data;
 }
 rpc(name,body={}){return this.request('rpc/'+name,{method:'POST',body});}
 get(table,query){return this.request(table+'?'+query);}
 insert(table,body){return this.request(table,{method:'POST',body,prefer:'return=representation'});}
 patch(table,query,body){return this.request(table+'?'+query,{method:'PATCH',body,prefer:'return=representation'});}
 async all(table,query='select=*') {const all=[];for(let offset=0;offset<20000;offset+=1000){const rows=await this.get(table,query+'&limit=1000&offset='+offset);all.push(...rows);if(rows.length<1000)return all;}throw new Error('Workspace exceeds this starter’s 20,000-record listing limit');}
}
export async function authorize(req,c,fetcher=fetch){
 const auth=req.headers.authorization||'';if(!auth.startsWith('Bearer '))throw Object.assign(new Error('Sign in to continue'),{status:401});
 const r=await fetcher(c.supabase+'/auth/v1/user',{headers:{apikey:c.anon,Authorization:auth},signal:AbortSignal.timeout(8000)});
 if(!r.ok)throw Object.assign(new Error('Session expired. Sign in again.'),{status:401});const user=await r.json();
 if(user.email?.toLowerCase()!==c.admin || !user.email_confirmed_at)throw Object.assign(new Error('This account is not an authorized administrator'),{status:403});
 return user;
}
