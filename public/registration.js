const $=s=>document.querySelector(s);const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const query=new URLSearchParams(location.search);const demo=query.has('demo');
const campaign=location.pathname.match(/^\/register\/([a-f0-9-]+)$/i)?.[1]||query.get('campaign');
let nonce,webinar,turnstileToken='',widget;
function display(w){webinar=w;$('#webinar-title').textContent=w.title;document.title=w.title+' · Register';$('#webinar-when').textContent=w.when;$('#webinar-company').textContent=w.company;$('#webinar-description').innerHTML=w.description.split(/\n\s*\n/).map(p=>'<p>'+esc(p).replaceAll('\n','<br>')+'</p>').join('');}
async function init(){
 if(demo){display({title:'From insight to action',when:'Thursday, October 22 · 2:00 PM Eastern',company:'R3VCORE',description:'There is no shortage of data. The challenge is deciding what deserves our attention—and what we can do with it.\n\nJoin Jesse for a practical conversation about finding the right opportunities, asking better questions, and moving your team forward.'});$('#registration-note').textContent='DESIGN PREVIEW · This sample form does not save registrations.';$('#registration-note').style.display='block';$('#register-submit').disabled=false;return;}
 try{const r=await fetch('/api/registration?campaign='+encodeURIComponent(campaign||''));const data=await r.json();if(!r.ok)throw new Error(data.error);display(data.webinar);nonce=data.nonce;
  if(data.turnstile_site_key){const script=document.createElement('script');script.src='https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';script.onload=()=>{widget=window.turnstile.render('#turnstile',{sitekey:data.turnstile_site_key,callback:token=>{turnstileToken=token;$('#register-submit').disabled=false;},'expired-callback':()=>{turnstileToken='';$('#register-submit').disabled=true;},'error-callback':()=>{turnstileToken='';$('#registration-error').textContent='Verification could not load. Please refresh and try again.';}});};script.onerror=()=>$('#registration-error').textContent='Verification could not load. Please refresh and try again.';document.head.appendChild(script);
  }else $('#register-submit').disabled=false;
 }catch(e){$('#webinar-title').textContent='Registration isn’t available.';$('#webinar-description').textContent=e.message||'Please check your link or try again shortly.';$('#signup-content').hidden=true;}
}
$('#registration-form').onsubmit=async event=>{
 event.preventDefault();$('#registration-error').textContent='';const button=$('#register-submit');button.disabled=true;
 try{const form=Object.fromEntries(new FormData(event.target));const body={...form,marketing_opt_in:!!event.target.elements.marketing_opt_in.checked,nonce,turnstile_token:turnstileToken};
  if(!demo){const r=await fetch('/api/registration?campaign='+encodeURIComponent(campaign),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const data=await r.json();if(!r.ok)throw new Error(data.error);}
  $('#signup-content').hidden=true;$('#signup-success').hidden=false;$('#confirmation-details').innerHTML='<strong>'+esc(webinar.title)+'</strong><br>'+esc(webinar.when);
  if(demo){$('#signup-success .success-title').textContent='That’s the registration experience.';$('#signup-success p').textContent='Preview only—nothing has been saved or sent.';}
 }catch(e){$('#registration-error').textContent=e.message||'Could not save your registration';if(widget!==undefined){window.turnstile.reset(widget);turnstileToken='';}else button.disabled=false;}
};
init();
