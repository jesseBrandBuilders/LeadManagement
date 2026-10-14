import {parseCSV,detect,mapRows,exportCSV} from './csv.js';

const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({
  '&':'&amp;',
  '<':'&lt;',
  '>':'&gt;',
  '"':'&quot;',
  "'":'&#39;'
}[c]));

const state={
  demo:false,
  page:'overview',
  data:{campaigns:[],lists:[],contacts:[]},
  campaign:null,
  report:null,
  tab:'editor',
  setup:null,
  config:null,
  session:null,
  pumping:false,
  importCSV:null,
  registrationImport:false
};

let refreshPromise=null,toastTimer,pumpTimer;

const badge=s=>`<span class="badge ${esc(s)}"><i></i>${esc(s)}</span>`;
const date=s=>s?new Date(s).toLocaleDateString(undefined,{month:'short',day:'numeric'}):'—';
const stat=(label,value,note,accent=false)=>`<div class="stat"><div class="label">${label}<span>${accent?'↗':'◦'}</span></div><strong class="${accent?'accent':''}">${value}</strong><small>${note}</small></div>`;

function toast(text){
  $('#toast').textContent=text;
  $('#toast').style.display='block';
  clearTimeout(toastTimer);
  toastTimer=setTimeout(()=>$('#toast').style.display='none',6500);
}

function modal(title,body){
  $('#modal-content').innerHTML=`<div class="modal-head"><h2>${title}</h2><button data-close aria-label="Close">×</button></div><div class="modal-body">${body}</div>`;
  if(!$('#modal').open)$('#modal').showModal();
}

function closeModal(){
  $('#modal').close();
}

async function sessionToken(){
  if(!state.session)throw new Error('Sign in to continue');

  if(Date.now()/1000>state.session.expires_at-90){
    if(!refreshPromise){
      refreshPromise=(async()=>{
        const r=await fetch(
          state.config.supabase_url+'/auth/v1/token?grant_type=refresh_token',
          {
            method:'POST',
            headers:{
              apikey:state.config.anon_key,
              'Content-Type':'application/json'
            },
            body:JSON.stringify({
              refresh_token:state.session.refresh_token
            })
          }
        );

        const data=await r.json();

        if(!r.ok){
          signout();
          throw new Error('Session expired. Sign in again.');
        }

        storeSession(data);
      })().finally(()=>refreshPromise=null);
    }

    await refreshPromise;
  }

  return state.session.access_token;
}

function storeSession(data){
  state.session={
    access_token:data.access_token,
    refresh_token:data.refresh_token,
    expires_at:data.expires_at||Math.floor(Date.now()/1000)+data.expires_in
  };

  sessionStorage.setItem('r3vcore-session',JSON.stringify(state.session));
}

async function api(action,body=null){
  if(state.demo)return demoAPI(action,body);

  const token=await sessionToken();

  const r=await fetch(
    '/api/app?action='+action+
    (action==='campaign'?'&id='+body.id:''),
    {
      method:body&&action!=='campaign'?'POST':'GET',
      headers:{
        Authorization:'Bearer '+token,
        'Content-Type':'application/json'
      },
      ...(body&&action!=='campaign'?{
        body:JSON.stringify(body)
      }:{})
    }
  );

  const data=await r.json();
  if(!r.ok)throw new Error(data.error||'Request failed');
  return data;
}

async function worker(){
  const token=await sessionToken();

  const r=await fetch('/api/worker',{
    method:'POST',
    headers:{Authorization:'Bearer '+token}
  });

  const data=await r.json();
  if(!r.ok)throw new Error(data.error||'Sender failed');
  return data;
}

function seedDemo(){
  const listID=crypto.randomUUID();

  const contacts=Array.from({length:24},(_,i)=>({
    id:crypto.randomUUID(),
    email:`sample${i+1}@example.com`,
    first_name:['Alex','Morgan','Taylor','Jamie'][i%4],
    last_name:['Reed','Parker','Ellis','Brooks'][i%4],
    organization:'Sample organization',
    created_at:new Date().toISOString(),
    unsubscribed_at:i===22?new Date().toISOString():null
  }));

  const common={
    list_id:listID,
    subject:'A practical conversation about your next enrollment season',
    title:'From insight to action',
    webinar_when:'Thursday, October 22 · 2:00 PM Eastern',
    body:'There is no shortage of data. The challenge is deciding what deserves our attention—and what we can do with it.\n\nJoin me for a practical conversation about finding the right opportunities, asking better questions, and moving your team forward.',
    registration_url:'https://example.com/register',
    company_name:'R3VCORE',
    postal_address:'123 Example Street · Sample address',
    contact_reason:'Sample invitation for an opted-in audience.',
    version:1,
    tested_version:null,
    created_at:new Date().toISOString()
  };

  state.data={
    contacts,
    lists:[{id:listID,name:'Example webinar audience',count:24}],
    campaigns:[
      {
        ...common,
        id:crypto.randomUUID(),
        name:'October conversation',
        status:'draft'
      },
      {
        ...common,
        id:crypto.randomUUID(),
        name:'September leadership webinar',
        status:'completed',
        created_at:'2026-09-18T14:00:00Z'
      }
    ]
  };

  state.setup={
    sender:'jesse@r3vcore.com',
    send_enabled:false,
    daily_cap:200,
    google_configured:false,
    app_url:'Design preview'
  };
}

async function demoAPI(action,body){
  if(action==='dashboard')return state.data;
  if(action==='setup')return state.setup;

  if(['start','test','check_google','resolve'].includes(action)){
    throw new Error('Live sending is disabled in design preview. Connect your project to use this action.');
  }

  if(action==='registration_toggle'){
    const c=state.data.campaigns.find(c=>c.id===body.id);
    c.registration_open=body.enabled;
    return {ok:true};
  }

  if(action==='campaign'){
    const c=state.data.campaigns.find(c=>c.id===body.id);
    const completed=c.status==='completed';

    return {
      campaign:c,
      registration_page_url:'https://webinars.example.com/register/'+c.id,
      registrations:completed
        ?state.data.contacts.slice(0,9).map((x,i)=>({
          ...x,
          id:crypto.randomUUID(),
          created_at:new Date().toISOString(),
          marketing_opt_in:i%3===0,
          source:'web'
        }))
        :[],
      recipients:[],
      stats:{
        total:completed?24:0,
        accepted:completed?23:0,
        queued:0,
        uncertain:0,
        failed:0,
        registered:completed?9:0,
        open_signals:completed?17:0,
        click_signals:completed?12:0
      }
    };
  }

  if(action==='create'){
    const newId=crypto.randomUUID();

    const c={
      ...body,
      id:newId,
      registration_url:body.registration_url||
        'https://webinars.example.com/register/'+newId,
      registration_open:false,
      status:'draft',
      version:1,
      tested_version:null,
      created_at:new Date().toISOString()
    };

    state.data.campaigns.unshift(c);
    return c;
  }

  if(action==='save'){
    const i=state.data.campaigns.findIndex(c=>c.id===body.id);

    state.data.campaigns[i]={
      ...state.data.campaigns[i],
      ...body,
      version:body.version+1,
      tested_version:null
    };

    return state.data.campaigns[i];
  }

  if(action==='import'){
    const id=crypto.randomUUID();
    const seen=new Set();
    let imported=0,invalid=0,duplicates=0;

    for(const row of body.rows){
      const email=String(row.email||'').trim().toLowerCase();

      if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){
        invalid++;
        continue;
      }

      if(seen.has(email)){
        duplicates++;
        continue;
      }

      seen.add(email);

      if(!state.data.contacts.some(c=>c.email===email)){
        state.data.contacts.push({
          ...row,
          email,
          id:crypto.randomUUID(),
          created_at:new Date().toISOString()
        });
      }

      imported++;
    }

    state.data.lists.unshift({id,name:body.name,count:imported});
    return {imported,invalid,duplicates};
  }

  if(action==='suppress'){
    const contact=state.data.contacts.find(c=>c.email===body.email);
    if(contact)contact.unsubscribed_at=new Date().toISOString();
    return {updated:1};
  }

  if(action==='registrations'){
    return {matched:0,unmatched:body.emails.length,invalid:0};
  }

  return {ok:true};
}

async function load(){
  state.data=await api('dashboard');
  render();

  if(state.data.campaigns.some(c=>c.status==='sending')&&!state.demo){
    schedulePump();
  }
}

function enter(){
  $('#login').hidden=true;
  $('#shell').hidden=false;
  $('#demo-banner').hidden=!state.demo;
}

async function signout(){
  clearTimeout(pumpTimer);

  if(state.session&&state.config){
    fetch(state.config.supabase_url+'/auth/v1/logout',{
      method:'POST',
      headers:{
        apikey:state.config.anon_key,
        Authorization:'Bearer '+state.session.access_token
      }
    }).catch(()=>{});
  }

  state.session=null;
  sessionStorage.removeItem('r3vcore-session');
  state.demo=false;
  state.campaign=null;
  state.report=null;
  $('#shell').hidden=true;
  $('#login').hidden=false;
}

function nav(page){
  state.page=page;
  state.campaign=null;
  state.report=null;
  render();

  if(page==='settings'){
    api('setup')
      .then(s=>{
        state.setup=s;
        render();
      })
      .catch(e=>toast(e.message));
  }
}

function render(){
  document.querySelectorAll('.nav').forEach(b=>{
    b.classList.toggle('active',b.dataset.page===state.page);
  });

  $('#page-title').textContent={
    overview:'Your invitation workspace',
    campaigns:'Campaigns',
    leads:'Your leads',
    settings:'Connection & sending'
  }[state.page];

  $('#content').innerHTML=state.campaign
    ?campaignView()
    :{
      overview,
      campaigns:campaignList,
      leads,
      settings:settingsView
    }[state.page]();

  if(state.campaign&&state.tab==='editor')bindEditor();
}

function campaignTable(){
  return state.data.campaigns.length
    ?`<div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Campaign</th>
            <th>Audience</th>
            <th>Status</th>
            <th>Created</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${state.data.campaigns.map(c=>`
            <tr>
              <td>
                <strong>${esc(c.name)}</strong>
                <small>${esc(c.title)}</small>
              </td>
              <td>${esc(state.data.lists.find(l=>l.id===c.list_id)?.name||'Not selected')}</td>
              <td>${badge(c.status)}</td>
              <td>${date(c.created_at)}</td>
              <td>
                <button class="row-action" data-open="${c.id}">
                  Open workspace →
                </button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>`
    :`<div class="empty">
      <div class="empty-icon">↗</div>
      <h2>Your first invitation starts here.</h2>
      <p>Upload your leads, write something worth opening, and send a test before you launch.</p>
      <button class="primary" data-new>Create a campaign</button>
    </div>`;
}

function overview(){
  const active=state.data.contacts.filter(c=>!c.unsubscribed_at).length;
  const drafts=state.data.campaigns.filter(c=>c.status==='draft').length;
  const sending=state.data.campaigns.filter(c=>c.status==='sending').length;

  return `
    <div class="hero">
      <div>
        <span class="eyebrow">MAKE THE INVITATION COUNT</span>
        <h2>A conversation worth joining.</h2>
        <p>Bring your audience together with a thoughtful message—and a clear view of what happens next.</p>
      </div>
      <div class="hero-icon">↗</div>
    </div>

    <div class="stats">
      ${stat('Available leads',active,'Deduplicated across uploaded lists',true)}
      ${stat('Campaigns',state.data.campaigns.length,'Every invitation, in one place')}
      ${stat('Drafts',drafts,'Ready for your next good idea')}
      ${stat('Sending',sending,sending?'Queue running · you can pause anytime':'No campaigns currently sending')}
    </div>

    <div class="panel">
      <div class="panel-head">
        <div>
          <h2>Your campaigns</h2>
          <p>Draft, send, and follow through.</p>
        </div>
        <button class="text-button" data-page="campaigns">View all →</button>
      </div>
      ${campaignTable()}
    </div>

    <div class="two-col">
      <div class="panel">
        <div class="panel-body">
          <span class="eyebrow">A SIMPLE PATH TO LAUNCH</span>
          <ol class="steps">
            <li>
              <span class="step-number">1</span>
              <div>
                <strong>Bring your leads</strong>
                <p>Upload a CSV. Map the columns. Duplicates and opt-outs stay under control.</p>
              </div>
            </li>
            <li>
              <span class="step-number">2</span>
              <div>
                <strong>Make it sound like you</strong>
                <p>Write the invitation, preview it, and send yourself a test.</p>
              </div>
            </li>
            <li>
              <span class="step-number">3</span>
              <div>
                <strong>Send, then follow through</strong>
                <p>Watch the queue and import registrations before your follow-up.</p>
              </div>
            </li>
          </ol>
        </div>
      </div>

      <div class="panel">
        <div class="panel-body">
          <span class="eyebrow">A LITTLE PERSPECTIVE</span>
          <h2 style="margin-top:15px">Signals help.<br>Registrations tell the story.</h2>
          <p>Image loads and link requests can include privacy tools and security scanners. Use them as clues, then focus on the people who actually register.</p>
          <button class="text-button" data-page="leads">See your audience →</button>
        </div>
      </div>
    </div>
  `;
}

function campaignList(){
  return `
    <div class="section-head">
      <div>
        <h2>Every invitation has a purpose.</h2>
        <p>Create a draft or pick up where you left off.</p>
      </div>
    </div>
    <div class="panel">${campaignTable()}</div>
  `;
}

function leads(){
  return `
    <div class="stats">
      ${stat('Total leads',state.data.contacts.length,'Unique email addresses',true)}
      ${stat('Available',state.data.contacts.filter(c=>!c.unsubscribed_at).length,'Eligible for list selection')}
      ${stat('Opted out',state.data.contacts.filter(c=>c.unsubscribed_at).length,'Excluded from future sends')}
      ${stat('Lead lists',state.data.lists.length,'Separate audiences for each campaign')}
    </div>

    <div>
      ${state.data.lists.map(l=>`
        <span class="list-chip">${esc(l.name)}<b>${l.count}</b></span>
      `).join('')}
    </div>

    <div class="panel">
      <div class="panel-head">
        <div>
          <h2>Your audience</h2>
          <p>Upload CSVs with Email, First Name, Last Name, and Organization.</p>
        </div>
        <input
          id="lead-search"
          class="search"
          placeholder="Search name, email, organization…"
          aria-label="Search leads"
        >
      </div>

      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Organization</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody id="lead-body">${leadRows(state.data.contacts)}</tbody>
        </table>
      </div>
    </div>
  `;
}

function leadRows(rows){
  return rows.length
    ?rows.map(c=>`
      <tr>
        <td>
          <strong>${esc([c.first_name,c.last_name].filter(Boolean).join(' ')||'No name provided')}</strong>
        </td>
        <td>${esc(c.email)}</td>
        <td>${esc(c.organization||'—')}</td>
        <td>${badge(c.unsubscribed_at?'suppressed':'available')}</td>
        <td>
          ${!c.unsubscribed_at?`
            <button class="row-action" data-suppress="${esc(c.email)}">
              Opt out
            </button>
          `:''}
        </td>
      </tr>
    `).join('')
    :`<tr>
      <td colspan="5" style="text-align:center;padding:40px">
        No leads to show. Upload your first CSV to get started.
      </td>
    </tr>`;
}

function settingsView(){
  const s=state.setup;

  return `
    <div class="notice teal">
      Your existing Google OAuth setup can be reused. Credentials stay on the server; they never appear in this workspace.
    </div>

    <div class="settings-grid">
      <div class="panel">
        <div class="panel-head">
          <div>
            <h2>Your Google account</h2>
            <p>The same sender your audience can reply to.</p>
          </div>
          <span class="badge ${s?.google_configured?'accepted':'draft'}">
            ${s?.google_configured?'Configured':'Setup needed'}
          </span>
        </div>

        <div class="panel-body">
          <div class="status-row">
            <span>Sender</span>
            <strong>jesse@r3vcore.com</strong>
          </div>
          <div class="status-row">
            <span>Authentication</span>
            <strong>Google OAuth · send-only</strong>
          </div>
          <div class="status-row">
            <span>Credentials</span>
            <span>${s?.google_configured?'Configured on Vercel':'Add your existing OAuth values'}</span>
          </div>
          <p>Check token authorization, then send a self-test to verify the sender and message.</p>
          <button class="secondary" data-check-google>Check Google connection</button>
        </div>
      </div>

      <div class="panel">
        <div class="panel-head">
          <div>
            <h2>Sending controls</h2>
            <p>A measured pace, with a clear stop button.</p>
          </div>
        </div>

        <div class="panel-body">
          <div class="status-row">
            <span>Live sending</span>
            ${badge(s?.send_enabled?'enabled':'disabled')}
          </div>
          <div class="status-row">
            <span>Daily application cap</span>
            <strong>${s?.daily_cap||200} attempts / rolling 24 hours</strong>
          </div>
          <div class="status-row">
            <span>Worker</span>
            <strong>Up to 3 messages per request</strong>
          </div>
          <p>The dashboard runs the queue while open. For unattended sending, configure the protected worker endpoint with a scheduler.</p>
          <button class="text-button" data-run-worker>Run a queue batch now →</button>
        </div>
      </div>

      <div class="panel">
        <div class="panel-head"><h2>Project setup</h2></div>
        <div class="panel-body">
          <ol class="steps">
            <li>
              <span class="step-number">1</span>
              <div>
                <strong>Create the Supabase project</strong>
                <p>Apply the supplied SQL migration and add your administrator in Supabase Auth.</p>
              </div>
            </li>
            <li>
              <span class="step-number">2</span>
              <div>
                <strong>Connect GitHub to Vercel</strong>
                <p>Deploy this project and add the server environment values from the setup guide.</p>
              </div>
            </li>
            <li>
              <span class="step-number">3</span>
              <div>
                <strong>Reuse your Google OAuth credentials</strong>
                <p>Add your client ID, client secret, and refresh token to Vercel. Set live sending on when ready to test.</p>
              </div>
            </li>
          </ol>
        </div>
      </div>

      <div class="panel">
        <div class="panel-head"><h2>Tracking & privacy</h2></div>
        <div class="panel-body">
          <p>Open signals come from a tracking pixel. Click signals come from a signed redirect link. Neither proves a human took action.</p>
          <p>Opt-outs are stored centrally and checked before each send. Import registrations to keep follow-ups relevant.</p>
          <p>No recipient email address is included in tracking URLs. No IP address or user-agent data is recorded by the application.</p>
        </div>
      </div>
    </div>
  `;
}

function blankCampaign(){
  return {
    id:null,
    name:'',
    list_id:state.data.lists[0]?.id||'',
    subject:'',
    title:'',
    webinar_when:'',
    body:'',
    registration_url:'',
    company_name:'R3VCORE',
    postal_address:'',
    contact_reason:'',
    status:'draft',
    version:1
  };
}

function newCampaign(source=null){
  state.page='campaigns';
  state.tab='editor';
  state.report=null;

  state.campaign=source
    ?{
      ...source,
      id:null,
      name:source.name+' · follow-up',
      status:'draft',
      version:1,
      tested_version:null,
      registration_open:false,
      followup_from:source.followup_from||source.id
    }
    :blankCampaign();

  render();
  window.scrollTo(0,0);
}

async function openCampaign(id){
  const report=await api('campaign',{id});
  state.report=report;
  state.campaign=report.campaign;
  state.page='campaigns';
  state.tab=state.campaign.status==='draft'?'editor':'results';
  render();
  window.scrollTo(0,0);
}

function campaignView(){
  const c=state.campaign;

  return `
    <div class="campaign-top">
      <div>
        <button class="text-button" data-back>← All campaigns</button>
        <h2>${esc(c.name||'A new invitation')} ${badge(c.status)}</h2>
      </div>

      <div class="actions">
        ${c.status==='draft'?`
          <button class="secondary" data-save>Save draft</button>
          <button class="secondary" data-test ${!c.id?'disabled':''}>Send self-test</button>
          <button class="primary" data-launch ${!c.id?'disabled':''}>Review & start →</button>
        `:c.status==='sending'?`
          <button class="danger" data-pause>Pause sending</button>
        `:c.status==='paused'?`
          <button class="primary" data-launch>Resume queue →</button>
        `:`
          <button class="primary" data-followup>Create follow-up →</button>
        `}
      </div>
    </div>

    <div class="tabs">
      <button class="tab ${state.tab==='editor'?'active':''}" data-tab="editor">
        Invitation
      </button>
      <button
        class="tab ${state.tab==='registrations'?'active':''}"
        data-tab="registrations"
        ${!c.id?'disabled':''}
      >
        Registrations
      </button>
      <button
        class="tab ${state.tab==='results'?'active':''}"
        data-tab="results"
        ${!c.id?'disabled':''}
      >
        Queue & results
      </button>
    </div>

    ${c.last_error?`<div class="notice">${esc(c.last_error)}</div>`:''}
    ${state.tab==='editor'
      ?editorView()
      :state.tab==='registrations'
        ?registrationsView()
        :resultsView()}
  `;
}

function field(label,name,type='text',extra=''){
  const c=state.campaign;
  const disabled=c.status!=='draft';

  return `
    <label>
      ${label}
      <input
        name="${name}"
        type="${type}"
        value="${esc(c[name]||'')}"
        ${disabled?'disabled':''}
        ${extra}
      >
    </label>
  `;
}

function editorView(){
  const c=state.campaign;
  const disabled=c.status!=='draft';

  return `
    <div class="editor-grid">
      <form id="campaign-form" class="form-panel">
        <div class="form-heading">Campaign & audience</div>

        ${field('Campaign name','name','text','required maxlength="120"')}

        <label>
          Lead list
          <select name="list_id" ${disabled?'disabled':''}>
            <option value="">Select a list</option>
            ${state.data.lists.map(l=>`
              <option value="${l.id}" ${c.list_id===l.id?'selected':''}>
                ${esc(l.name)} · ${l.count} leads
              </option>
            `).join('')}
          </select>
          <span class="helper">Duplicates and opted-out contacts are excluded at launch.</span>
        </label>

        ${c.followup_from?`
          <div class="notice teal">
            This follow-up excludes registrants from the original campaign.
          </div>
        `:''}

        <div class="form-heading">The invitation</div>

        ${field('Email subject','subject','text','required maxlength="180"')}
        ${field('Webinar title','title','text','required')}
        ${field('Date, time & timezone','webinar_when','text','required placeholder="Thursday, October 22 · 2:00 PM Eastern"')}

        <label>
          Your message
          <textarea
            name="body"
            ${disabled?'disabled':''}
            required
            placeholder="Why is this conversation worth their time? Share the practical value in a few short paragraphs."
          >${esc(c.body)}</textarea>
          <span class="helper">
            A first-name greeting is added automatically. You can use {{first_name}} in your message or subject.
          </span>
        </label>

        ${field('Registration link','registration_url','url','placeholder="Leave blank to create your built-in signup link"')}

        <p class="fine">
          Leave blank to use the built-in registration page. Open it in the Registrations tab before testing or sending.
        </p>

        <div class="form-heading">Sender & footer</div>

        ${field('Company name','company_name','text','required')}
        ${field('Company postal address','postal_address','text','required')}
        ${field('Why this person is receiving your email','contact_reason','text','required placeholder="You subscribed to our webinar updates."')}

        <p class="fine">
          From Jesse &lt;jesse@r3vcore.com&gt; · Replies go directly to your inbox.
        </p>
      </form>

      <div class="preview-shell">
        <div class="preview-head">
          <span>EMAIL PREVIEW</span>
          <span>Personalized for Alex</span>
        </div>
        <div id="email-preview"></div>
        <p class="fine">Text and HTML versions are included in the sent message.</p>
      </div>
    </div>
  `;
}

function formValues(){
  const c=state.campaign;
  if(c.status!=='draft')return c;

  return {
    ...c,
    ...Object.fromEntries(new FormData($('#campaign-form')).entries())
  };
}

function preview(c){
  const merge=t=>String(t||'')
    .replaceAll('{{first_name}}','Alex')
    .replaceAll('{{last_name}}','Reed');

  return `
    <div class="mail">
      <div class="mail-header">
        <b>Jesse</b> &lt;jesse@r3vcore.com&gt;<br>
        <b>To:</b> Alex Reed<br>
        <b>Subject:</b> ${esc(merge(c.subject)||'Your email subject')}
      </div>

      <div class="mail-body">
        <p>Hi Alex,</p>

        ${c.body
          ?merge(c.body)
            .split(/\n\s*\n/)
            .map(p=>`<p>${esc(p).replaceAll('\n','<br>')}</p>`)
            .join('')
          :`<p style="color:#a0aeab">
            Your message will appear here as you write. A clear invitation begins with a reason to join.
          </p>`}

        <h3>${esc(c.title||'Your webinar title')}</h3>
        <p>${esc(c.webinar_when||'Your date, time & timezone')}</p>
        <span class="mail-button">Save your seat ↗</span>

        <p>
          Hope you can join us,<br>
          Jesse<br>
          ${esc(c.company_name||'R3VCORE')}
        </p>

        <div class="mail-footer">
          ${esc(c.contact_reason||'Why this person is receiving your invitation')}<br>
          ${esc(c.company_name||'R3VCORE')} · ${esc(c.postal_address||'Your company postal address')}<br>
          <u>Unsubscribe</u>
        </div>
      </div>
    </div>
  `;
}

function bindEditor(){
  $('#email-preview').innerHTML=preview(state.campaign);

  $('#campaign-form').addEventListener('input',()=>{
    $('#email-preview').innerHTML=preview(formValues());
  });

  $('#campaign-form').addEventListener('submit',e=>e.preventDefault());
}

async function saveDraft(show=true){
  const form=$('#campaign-form');

  // The other tabs do not contain the invitation form.
  // Use the already-saved campaign when launching from those tabs.
  if(!form){
    if(state.campaign?.id)return state.campaign;
    throw new Error('Open the Invitation tab and save your draft first.');
  }

  if(!form.reportValidity()){
    throw new Error('Complete the required campaign details');
  }

  const draft={
    ...state.campaign,
    ...Object.fromEntries(new FormData(form).entries())
  };

  const fields=[
    'name',
    'list_id',
    'subject',
    'title',
    'webinar_when',
    'body',
    'registration_url',
    'company_name',
    'postal_address',
    'contact_reason'
  ];

  const unchanged=draft.id&&fields.every(
    key=>(draft[key]??'')===(state.campaign[key]??'')
  );

  // Avoid invalidating a successful self-test for an unchanged draft.
  if(unchanged){
    if(show)toast('Draft is already saved.');
    return state.campaign;
  }

  const saved=await api(draft.id?'save':'create',draft);

  state.campaign=saved;
  state.data=await api('dashboard');
  state.report=null;
  render();

  if(show){
    toast('Draft saved. Send a self-test of this version before launch.');
  }

  return saved;
}

function resultsView(){
  const r=state.report||{stats:{},recipients:[]};
  const s=r.stats;
  const c=state.campaign;

  const progress=s.total
    ?Math.round((s.total-(s.queued||0))/s.total*100)
    :0;

  return `
    <div class="stats">
      ${stat('Accepted by Gmail',s.accepted||0,'Handoff confirmed; not delivery',true)}
      ${stat('Open signals',s.open_signals||0,'Unique recipients with an image load')}
      ${stat('Click signals',s.click_signals||0,'Unique recipients with a link request')}
      ${stat('Registered',s.registered||0,'Unique webinar registrations')}
    </div>

    <div class="panel">
      <div class="queue-bar">
        <div style="flex:1">
          <h3>
            ${c.status==='sending'
              ?'The invitation is on its way.'
              :c.status==='completed'
                ?'This queue is complete.'
                :c.status==='paused'
                  ?'Sending is paused.'
                  :'Your queue will appear after launch.'}
          </h3>

          <p style="margin:6px 0;font-size:12px">
            ${s.queued||0} queued · ${s.uncertain||0} uncertain · ${s.failed||0} rejected
          </p>

          <div class="progress">
            <div style="width:${progress}%"></div>
          </div>
        </div>

        <div class="actions">
          <button class="secondary" data-refresh>Refresh</button>
          ${c.status==='sending'?`
            <button class="secondary" data-run-worker>Run batch</button>
          `:''}
          <button class="secondary" data-registration>↑ Import registrations</button>
          <button class="secondary" data-export>↓ Export results</button>
        </div>
      </div>
    </div>

    ${s.uncertain?`
      <div class="notice">
        An uncertain send may already be in Gmail Sent Mail. Review it before requeueing. The app will not automatically retry.
      </div>
    `:''}

    <div class="panel">
      <div class="panel-head">
        <div>
          <h2>Recipient activity</h2>
          <p>Test emails are labeled separately. Open/click signals can include automated activity.</p>
        </div>
      </div>

      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Recipient</th>
              <th>Status</th>
              <th>Opens</th>
              <th>Clicks</th>
              <th>Registered</th>
              <th></th>
            </tr>
          </thead>

          <tbody>
            ${r.recipients.length?r.recipients.map(x=>`
              <tr>
                <td>
                  <strong>
                    ${esc(x.first_name+' '+x.last_name)}${x.is_test?' · SELF-TEST':''}
                  </strong>
                  <small>${esc(x.email)}</small>
                  ${x.error?`
                    <small title="${esc(x.error)}">${esc(x.error.slice(0,90))}</small>
                  `:''}
                </td>
                <td>${badge(x.status)}</td>
                <td>${x.opens}</td>
                <td>${x.clicks}</td>
                <td>${x.registered_at?'✓ '+date(x.registered_at):'—'}</td>
                <td>
                  ${['uncertain','failed'].includes(x.status)?`
                    <button class="row-action" data-resolve="${x.id}">Review</button>
                  `:''}
                </td>
              </tr>
            `).join(''):`
              <tr>
                <td colspan="6" style="text-align:center;padding:45px">
                  No recipients yet. Send a self-test, then start your invitation.
                </td>
              </tr>
            `}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

async function refreshCampaign(){
  if(!state.campaign?.id)return;

  const r=await api('campaign',{id:state.campaign.id});
  state.report=r;
  state.campaign=r.campaign;
  state.data=await api('dashboard');
  render();
}

async function launchModal(){
  if(state.campaign.status==='draft'){
    await saveDraft(false);
  }

  if(
    state.campaign.status==='draft'&&
    state.campaign.tested_version!==state.campaign.version
  ){
    toast('This version needs a self-test. Send one, review it in Gmail, then start.');
    return;
  }

  const c=state.campaign;

  modal(
    c.status==='paused'?'Resume this queue?':'Ready to invite your audience?',
    `
      <p>
        <strong>${esc(c.name)}</strong><br>
        From jesse@r3vcore.com<br>
        ${esc(c.subject)}
      </p>

      <div class="notice teal">
        Opted-out contacts and registered attendees of a linked follow-up are excluded. Campaign content is locked after launch.
      </div>

      <label class="checkbox">
        <input id="launch-confirm" type="checkbox">
        I reviewed the test email, registration link, date/time, and selected audience.
      </label>

      <div class="modal-actions">
        <button class="secondary" data-close>Keep reviewing</button>
        <button class="primary" id="confirm-launch">
          ${c.status==='paused'?'Resume sending':'Start sending'}
        </button>
      </div>
    `
  );

  $('#confirm-launch').onclick=async()=>{
    if(!$('#launch-confirm').checked){
      toast('Confirm your test-email review before starting.');
      return;
    }

    await busy($('#confirm-launch'),async()=>{
      await api('start',{id:c.id});
      closeModal();
      state.tab='results';
      await refreshCampaign();
      toast('Queue started. Keep this dashboard open, or use your configured scheduler.');
      schedulePump();
    });
  };
}

async function sendTest(){
  const saved=await saveDraft(false);

  await busy(null,async()=>{
    const r=await api('test',{id:saved.id});
    await refreshCampaign();

    if(r.status==='accepted'){
      toast('Self-test accepted by Gmail. Check your inbox and links before launching.');
    }else{
      toast(r.error||'The test needs review.');
    }
  });
}

function openImport(registrations=false){
  state.registrationImport=registrations;
  state.importCSV=null;

  modal(
    registrations
      ?'Import webinar registrations'
      :'Bring your leads into the workspace',
    `
      <p>
        ${registrations
          ?'Upload a registration CSV with an email column. Matching recipients will be marked registered.'
          :'Upload a CSV with a header row. We’ll help map Email, First Name, Last Name, and Organization.'}
      </p>

      ${!registrations?`
        <label>
          List name
          <input id="list-name" placeholder="October webinar audience" required>
        </label>
      `:''}

      <div class="dropzone">
        <strong>Choose your CSV file</strong>
        <p class="fine">Up to 2,000 rows · UTF-8 CSV</p>
        <input
          id="csv-file"
          type="file"
          accept=".csv,text/csv"
          aria-label="Choose CSV file"
        >
      </div>

      <div id="mapping-area"></div>

      <div class="modal-actions">
        <button class="secondary" data-close>Cancel</button>
        <button id="confirm-import" class="primary" disabled>
          ${registrations?'Import registrations':'Import leads'}
        </button>
      </div>
    `
  );

  $('#csv-file').onchange=async()=>{
    try{
      const file=$('#csv-file').files[0];
      if(!file)return;

      if(file.size>2e6){
        throw new Error('CSV exceeds the 2 MB upload limit');
      }

      state.importCSV=parseCSV(await file.text());

      if(!registrations&&!$('#list-name').value){
        $('#list-name').value=file.name.replace(/\.csv$/i,'');
      }

      drawMapping();
      $('#confirm-import').disabled=false;
    }catch(e){
      toast(e.message);
      $('#confirm-import').disabled=true;
    }
  };

  $('#confirm-import').onclick=()=>busy($('#confirm-import'),async()=>{
    const mapping=currentMapping();
    if(mapping.email<0)throw new Error('Map the Email column');

    const rows=mapRows(state.importCSV,mapping);

    const result=await api(
      registrations?'registrations':'import',
      registrations
        ?{id:state.campaign.id,emails:rows.map(r=>r.email)}
        :{name:$('#list-name').value,rows}
    );

    closeModal();

    if(registrations){
      await refreshCampaign();
      toast(`${result.matched} registrations imported · duplicates count once.`);
    }else{
      await load();
      toast(`${result.imported} leads imported · ${result.duplicates} duplicates skipped · ${result.invalid} invalid rows skipped.`);
    }
  });
}

function currentMapping(){
  return Object.fromEntries(
    [...document.querySelectorAll('[data-map]')].map(s=>[
      s.dataset.map,
      Number(s.value)
    ])
  );
}

function drawMapping(){
  const csv=state.importCSV;
  const mapping=detect(csv.headers);

  const fields=state.registrationImport
    ?['email']
    :['email','first_name','last_name','organization'];

  $('#mapping-area').innerHTML=`
    <h3 style="margin-bottom:15px">${csv.rows.length} rows found. Check the columns.</h3>

    <div class="mapping">
      ${fields.map(k=>`
        <label>
          ${k.replace('_',' ')}
          <select data-map="${k}">
            <option value="-1">
              ${k==='email'?'Select email column':'Skip this field'}
            </option>
            ${csv.headers.map((h,i)=>`
              <option value="${i}" ${mapping[k]===i?'selected':''}>
                ${esc(h)}
              </option>
            `).join('')}
          </select>
        </label>
      `).join('')}
    </div>

    <div id="import-preview" class="import-preview"></div>
  `;

  document.querySelectorAll('[data-map]').forEach(s=>{
    s.onchange=drawImportPreview;
  });

  drawImportPreview();
}

function drawImportPreview(){
  const rows=mapRows(state.importCSV,currentMapping()).slice(0,5);

  $('#import-preview').innerHTML=`
    <table>
      <thead>
        <tr>
          <th>Email</th>
          <th>First name</th>
          <th>Last name</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map(r=>`
          <tr>
            <td>${esc(r.email)}</td>
            <td>${esc(r.first_name)}</td>
            <td>${esc(r.last_name)}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

function downloadResults(){
  const csv=exportCSV(state.report.recipients,[
    'email',
    'first_name',
    'last_name',
    'status',
    'opens',
    'clicks',
    'registered_at',
    'accepted_at',
    'is_test',
    'error'
  ]);

  const url=URL.createObjectURL(
    new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8'})
  );

  const a=document.createElement('a');
  a.href=url;
  a.download='webinar-results.csv';
  a.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}

function registrationsView(){
  const c=state.campaign;
  const r=state.report||{};
  const rows=r.registrations||[];
  const link=r.registration_page_url||'';
  const open=!!c.registration_open;

  return `
    <div class="stats">
      ${stat('Registrations',r.stats?.registered||0,'Unique email addresses',true)}
      ${stat('Web signups',rows.filter(x=>x.source==='web').length,'Collected by the public form')}
      ${stat('Future updates',rows.filter(x=>x.marketing_opt_in).length,'Explicit optional opt-in')}
      ${stat('Signup page',open?'Open':'Closed','You control when registration is available')}
    </div>

    <div class="panel">
      <div class="panel-head">
        <div>
          <h2>Your public registration page</h2>
          <p>A shareable signup link for this webinar.</p>
        </div>
        <button class="${open?'secondary':'primary'}" data-reg-toggle>
          ${open?'Close registration':'Open registration'}
        </button>
      </div>

      <div class="panel-body">
        <label>
          Share this link
          <input id="registration-share-link" readonly value="${esc(link)}">
        </label>

        <div class="actions">
          <button class="secondary" data-reg-copy>Copy link</button>
          <button class="secondary" data-reg-visit ${!open?'disabled':''}>
            View signup page ↗
          </button>

          ${c.status==='draft'?`
            <button class="secondary" data-reg-use>
              Use this link in the invitation
            </button>
          `:''}

          <button class="secondary" data-registration>↑ Import registration CSV</button>
        </div>

        <p class="fine">
          ${open
            ?'Anyone with this link can register without signing in.'
            :'Open registration before sharing. The page stays private until you enable it.'}
          Closing registration also pauses an active send queue.
        </p>

        ${c.followup_from?`
          <p class="fine">
            Registrations for the linked original campaign are included here too. The invitation may continue to use the original webinar signup link.
          </p>
        `:''}
      </div>
    </div>

    <div class="panel">
      <div class="panel-head">
        <div>
          <h2>Who’s joining us</h2>
          <p>Repeated signups with the same email count once. Webinar registration does not automatically add someone to marketing lists.</p>
        </div>

        <div class="actions">
          <button class="secondary" data-reg-refresh>Refresh count</button>
          <button class="secondary" data-reg-export>↓ Export registrants</button>
        </div>
      </div>

      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Organization</th>
              <th>Registered</th>
              <th>Source</th>
              <th>Future updates</th>
            </tr>
          </thead>

          <tbody>
            ${rows.length?rows.map(x=>`
              <tr>
                <td>
                  <strong>${esc([x.first_name,x.last_name].filter(Boolean).join(' ')||'Name not provided')}</strong>
                </td>
                <td>${esc(x.email)}</td>
                <td>${esc(x.organization||'—')}</td>
                <td>${date(x.created_at)}</td>
                <td>${esc(x.source==='web'?'Signup form':'CSV import')}</td>
                <td>${x.marketing_opt_in?'✓ Opted in':'Not opted in'}</td>
              </tr>
            `).join(''):`
              <tr>
                <td colspan="6" style="text-align:center;padding:45px">
                  Your registrations will appear here as people sign up.
                </td>
              </tr>
            `}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function exportRegistrations(){
  const rows=state.report?.registrations||[];

  const csv=exportCSV(rows,[
    'email',
    'first_name',
    'last_name',
    'organization',
    'created_at',
    'source',
    'marketing_opt_in'
  ]);

  const url=URL.createObjectURL(
    new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8'})
  );

  const a=document.createElement('a');
  a.href=url;
  a.download='webinar-registrations.csv';
  a.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}

document.addEventListener('click',event=>{
  if(event.target.closest('[data-reg-refresh]')){
    busy(null,refreshCampaign);
  }
});

setInterval(()=>{
  if(
    state.campaign?.id&&
    state.tab==='registrations'&&
    !state.demo&&
    state.session&&
    !state.pumping&&
    !document.hidden
  ){
    busy(null,refreshCampaign);
  }
},20000);

document.addEventListener('click',event=>{
  const b=event.target.closest('button');
  if(!b)return;

  if(b.hasAttribute('data-reg-toggle')){
    return busy(b,async()=>{
      await api('registration_toggle',{
        id:state.campaign.id,
        enabled:!state.campaign.registration_open
      });

      await refreshCampaign();

      toast(
        state.campaign.registration_open
          ?'Registration is open. Copy and share the signup link.'
          :'Registration closed.'
      );
    });
  }

  if(b.hasAttribute('data-reg-copy')){
    return busy(b,async()=>{
      try{
        await navigator.clipboard.writeText(state.report.registration_page_url);
        toast('Registration link copied.');
      }catch{
        $('#registration-share-link').select();
        toast('Select and copy the link above.');
      }
    });
  }

  if(b.hasAttribute('data-reg-visit')){
    if(state.demo){
      toast('This is the design preview. Open the separate registration-page preview to try the form.');
      return;
    }

    window.open(state.report.registration_page_url,'_blank','noopener');
    return;
  }

  if(b.hasAttribute('data-reg-use')){
    return busy(b,async()=>{
      state.campaign=await api('save',{
        ...state.campaign,
        registration_url:state.report.registration_page_url
      });

      state.tab='editor';
      await refreshCampaign();
      toast('The invitation now uses your built-in signup page. Send a new self-test before launching.');
    });
  }

  if(b.hasAttribute('data-reg-export')){
    return exportRegistrations();
  }
});

async function busy(button,fn){
  if(button)button.disabled=true;

  try{
    return await fn();
  }catch(e){
    toast(e.message);
  }finally{
    if(button?.isConnected)button.disabled=false;
  }
}

function schedulePump(){
  clearTimeout(pumpTimer);
  if(state.demo||!state.session)return;
  pumpTimer=setTimeout(pump,2200);
}

async function pump(){
  if(state.pumping||!state.session||state.demo)return;
  state.pumping=true;

  try{
    const r=await worker();

    if(r.results?.some(x=>x.status!=='accepted')){
      toast('Sending paused. Review the message status before continuing.');
    }

    if(state.campaign&&state.campaign.status!=='draft'){
      await refreshCampaign();
    }else{
      state.data=await api('dashboard');
      if(!state.campaign)render();
    }

    if(state.data.campaigns.some(c=>c.status==='sending')){
      if(!r.processed&&!r.busy){
        toast('No send was claimed. The daily cap may be reached; queue remains saved.');
        pumpTimer=setTimeout(pump,60000);
      }else{
        schedulePump();
      }
    }
  }catch(e){
    toast(e.message+' Queue is saved; use Run batch when ready.');
  }finally{
    state.pumping=false;
  }
}

function resolveModal(id){
  const recipient=state.report.recipients.find(r=>r.id===id);

  modal('Review this send before retrying',`
    <p><strong>${esc(recipient.email)}</strong></p>

    <div class="notice">
      Check Gmail Sent Mail for this recipient and subject first. A network timeout can happen after Google accepted the email.
    </div>

    <label>
      What did you confirm?
      <select id="resolution">
        <option value="accepted">The message was sent — mark accepted</option>
        <option value="queued">It was not sent — return to queue</option>
        <option value="failed">Leave it failed — do not send</option>
      </select>
    </label>

    <label class="checkbox">
      <input id="review-confirm" type="checkbox">
      I checked Gmail Sent Mail and confirmed the outcome.
    </label>

    <div class="modal-actions">
      <button class="secondary" data-close>Cancel</button>
      <button class="primary" id="confirm-resolve">Save resolution</button>
    </div>
  `);

  $('#confirm-resolve').onclick=()=>busy($('#confirm-resolve'),async()=>{
    if(!$('#review-confirm').checked){
      throw new Error('Confirm your Sent Mail review');
    }

    await api('resolve',{
      id:state.campaign.id,
      recipient_id:id,
      status:$('#resolution').value,
      confirmed:true
    });

    closeModal();
    await refreshCampaign();
  });
}

document.addEventListener('click',e=>{
  const b=e.target.closest('button');
  if(!b)return;

  if(b.hasAttribute('data-close'))return closeModal();
  if(b.dataset.page)return nav(b.dataset.page);
  if(b.hasAttribute('data-new'))return newCampaign();
  if(b.dataset.open)return busy(b,()=>openCampaign(b.dataset.open));
  if(b.hasAttribute('data-back'))return nav('campaigns');

  if(b.dataset.tab){
    return busy(b,async()=>{
      if(state.tab==='editor'&&state.campaign.status==='draft'){
        await saveDraft(false);
      }

      state.tab=b.dataset.tab;

      if(state.tab!=='editor'){
        await refreshCampaign();
      }else{
        render();
      }
    });
  }

  if(b.hasAttribute('data-save'))return busy(b,saveDraft);
  if(b.hasAttribute('data-test'))return busy(b,sendTest);
  if(b.hasAttribute('data-launch'))return busy(b,launchModal);

  if(b.hasAttribute('data-pause')){
    return busy(b,async()=>{
      await api('pause',{id:state.campaign.id});
      await refreshCampaign();
      toast('Paused. An in-flight message may finish; no new messages will be claimed.');
    });
  }

  if(b.hasAttribute('data-followup'))return newCampaign(state.campaign);
  if(b.hasAttribute('data-registration'))return openImport(true);
  if(b.hasAttribute('data-refresh'))return busy(b,refreshCampaign);
  if(b.hasAttribute('data-export'))return downloadResults();

  if(b.hasAttribute('data-run-worker')){
    return busy(b,async()=>{
      if(state.demo){
        throw new Error('Live sending is disabled in design preview');
      }

      const r=await worker();
      toast(`${r.processed} messages processed.`);

      if(state.campaign){
        await refreshCampaign();
      }else{
        await load();
      }
    });
  }

  if(b.hasAttribute('data-check-google')){
    return busy(b,async()=>{
      toast((await api('check_google',{})).message);
    });
  }

  if(b.dataset.resolve)return resolveModal(b.dataset.resolve);

  if(b.dataset.suppress){
    modal('Opt out this contact?',`
      <p>${esc(b.dataset.suppress)} will be excluded from future sends across all lead lists.</p>
      <div class="modal-actions">
        <button class="secondary" data-close>Cancel</button>
        <button id="confirm-suppress" class="danger">Opt out</button>
      </div>
    `);

    $('#confirm-suppress').onclick=()=>busy($('#confirm-suppress'),async()=>{
      await api('suppress',{email:b.dataset.suppress});
      closeModal();
      await load();
      toast('Contact opted out.');
    });
  }
});

document.addEventListener('input',e=>{
  if(e.target.id==='lead-search'){
    const q=e.target.value.toLowerCase();

    $('#lead-body').innerHTML=leadRows(
      state.data.contacts.filter(c=>
        [c.email,c.first_name,c.last_name,c.organization]
          .join(' ')
          .toLowerCase()
          .includes(q)
      )
    );
  }
});

$('#top-new').onclick=()=>newCampaign();
$('#top-import').onclick=()=>openImport();
$('#signout').onclick=signout;
$('#exit-demo').onclick=signout;

$('#demo-btn').onclick=()=>{
  state.demo=true;
  seedDemo();
  enter();
  render();
};

$('#login-form').onsubmit=async e=>{
  e.preventDefault();
  $('#login-error').textContent='';

  const button=e.submitter;
  button.disabled=true;

  try{
    if(!state.config){
      throw new Error('Configure the Vercel environment variables first. You can still explore the design preview.');
    }

    const r=await fetch(
      state.config.supabase_url+'/auth/v1/token?grant_type=password',
      {
        method:'POST',
        headers:{
          apikey:state.config.anon_key,
          'Content-Type':'application/json'
        },
        body:JSON.stringify({
          email:$('#login-email').value,
          password:$('#login-password').value
        })
      }
    );

    const data=await r.json();

    if(!r.ok){
      throw new Error(data.msg||data.error_description||'Sign-in failed');
    }

    storeSession(data);
    state.demo=false;
    await load();
    enter();
    $('#login-password').value='';
  }catch(error){
    $('#login-error').textContent=error.message;
  }finally{
    button.disabled=false;
  }
};

async function init(){
  if(new URLSearchParams(location.search).has('demo')){
    state.demo=true;
    seedDemo();
    enter();
    render();
    return;
  }

  try{
    const r=await fetch('/api/app?action=config');
    if(!r.ok)throw new Error();

    state.config=await r.json();

    const saved=sessionStorage.getItem('r3vcore-session');

    if(saved){
      state.session=JSON.parse(saved);
      await load();
      enter();
    }
  }catch{
    $('#login-error').textContent='Project setup is not complete. Use the design preview, or add your Supabase and Vercel configuration.';
  }
}

init();
