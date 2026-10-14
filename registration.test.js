import test from 'node:test';
import assert from 'node:assert/strict';
import {nonce,validNonce,validateSignup,checkTurnstile} from './lib/registration.js';
import {registrationHandler} from './api/registration.js';
import {makeApp} from './api/app.js';
const id='12345678-1234-1234-1234-123456789abc',secret='x'.repeat(40);
const c={secret,app:'https://app.example.com',enabled:true};
const webinar={id,title:'Useful conversations',webinar_when:'Thursday 2 PM Eastern',body:'Join us, {{first_name}}.',company_name:'R3VCORE',registration_open:true};
function res(){return {headers:{},setHeader(k,v){this.headers[k]=v;},end(value){this.body=value;}};}
function req(method='GET',body){return {method,url:'/api/registration?campaign='+id,headers:{},body};}
test('registration nonce is campaign-bound, signed and expires after two hours',()=>{
 const now=1000000000,n=nonce(id,secret,now);assert(validNonce(n,id,secret,now+5000));assert(!validNonce(n,id,secret,now+7201000));assert(!validNonce(n,'other',secret,now));assert(!validNonce(n.slice(0,-1)+'!',id,secret,now));
});
test('signup normalizes email and keeps optional marketing preference false',()=>{
 const value=validateSignup({email:' ALEX@EXAMPLE.COM ',first_name:' Alex ',last_name:' Reed '});assert.equal(value.email,'alex@example.com');assert.equal(value.optIn,false);assert.equal(value.first,'Alex');
 assert.equal(validateSignup({email:'a@example.com',first_name:'A',last_name:'B',marketing_opt_in:true}).optIn,true);
 assert.throws(()=>validateSignup({email:'a@example.com\r\nBcc: b@example.com',first_name:'A',last_name:'B'}));assert.throws(()=>validateSignup({email:'a@example.com',first_name:'A',last_name:'B',company_website:'bot.example.com'}));
});
test('public webinar details require no login and reveal no lead list, address or credentials',async()=>{
 const r=res();await registrationHandler(c,{get:async()=>[{...webinar,postal_address:'private',list_id:'private'}]})(req(),r);assert.equal(r.statusCode,200);const data=JSON.parse(r.body);assert.equal(data.webinar.description,'Join us, you.');assert(!('postal_address' in data.webinar));assert(!('list_id' in data.webinar));assert(data.nonce);
});
test('registration saves normalized values through privileged RPC and repeat calls have one unique address',async()=>{
 const entries=new Map(),db={get:async()=>[webinar],rpc:async(name,p)=>{assert.equal(name,'register_for_campaign');if(!entries.has(p.p_email))entries.set(p.p_email,p);}};
 const handler=registrationHandler(c,db);const body={email:' ALEX@example.com ',first_name:'Alex',last_name:'Reed',nonce:nonce(id,secret)};
 let r=res();await handler(req('POST',body),r);assert.equal(r.statusCode,200);r=res();await handler(req('POST',{...body,email:'alex@EXAMPLE.COM'}),r);assert.equal(r.statusCode,200);assert.equal(entries.size,1);assert.equal(entries.get('alex@example.com').p_opt_in,false);
});
test('closed webinar, invalid nonce and honeypot never create a registration',async()=>{
 let calls=0;const db={get:async()=>[webinar],rpc:async()=>{calls++;}};const handler=registrationHandler(c,db);
 let r=res();await handler(req('POST',{email:'a@example.com',first_name:'A',last_name:'B',nonce:'bad'}),r);assert.equal(r.statusCode,400);
 r=res();await handler(req('POST',{email:'a@example.com',first_name:'A',last_name:'B',company_website:'bot',nonce:nonce(id,secret)}),r);assert.equal(r.statusCode,400);
 r=res();await registrationHandler(c,{...db,get:async()=>[{...webinar,registration_open:false}]})(req(),r);assert.equal(r.statusCode,404);assert.equal(calls,0);
});
test('database failure never produces a false successful registration',async()=>{
 const r=res();await registrationHandler(c,{get:async()=>[webinar],rpc:async()=>{throw new Error('offline');}})(req('POST',{email:'a@example.com',first_name:'A',last_name:'B',nonce:nonce(id,secret)}),r);assert.equal(r.statusCode,503);assert(!JSON.parse(r.body).ok);
});
test('Turnstile is optional, but both settings and server verification are required when enabled',async()=>{
 assert(await checkTurnstile('', ''));assert(!await checkTurnstile('', 'secret'));
 assert(!await checkTurnstile('token','secret',async()=>({ok:true,json:async()=>({success:false})})));
 let r=res();await registrationHandler(c,{get:async()=>[webinar]},{siteKey:'site',turnstileSecret:''})(req(),r);assert.equal(r.statusCode,503);
 r=res();await registrationHandler(c,{get:async()=>[webinar],rpc:async()=>{throw new Error('must not run');}},{siteKey:'site',turnstileSecret:'secret',verifyBot:async()=>false})(req('POST',{email:'a@example.com',first_name:'A',last_name:'B',nonce:nonce(id,secret)}),r);assert.equal(r.statusCode,400);
});
test('new campaign gets a built-in registration URL if none is supplied',async()=>{
 let saved;const db={insert:async(t,body)=>{saved=body;return [body];}};
 const r=res();await makeApp(c,{db,auth:async()=>({})})({method:'POST',url:'/api/app?action=create',headers:{},body:{name:'Webinar',subject:'Join us',title:'Webinar',webinar_when:'Thursday',body:'Useful ideas',registration_url:'',company_name:'R3VCORE',postal_address:'123 Main',contact_reason:'You subscribed'}},r);
 assert.equal(r.statusCode,200);assert.equal(saved.registration_url,c.app+'/register/'+saved.id);
});
test('closing registration pauses an active campaign without modifying its frozen content',async()=>{
 let update;const db={get:async()=>[{...webinar,status:'sending'}],patch:async(t,q,body)=>{update=body;return [body];}};const r=res();await makeApp(c,{db,auth:async()=>({})})({method:'POST',url:'/api/app?action=registration_toggle',headers:{},body:{id,enabled:false}},r);assert.equal(r.statusCode,200);assert.deepEqual(update,{registration_open:false,status:'paused'});
});
