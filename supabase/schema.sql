-- Run ONCE in a dedicated Supabase project's SQL Editor.
-- All data goes through the authenticated server API; no browser table access.
create table public.lead_lists(id uuid primary key default gen_random_uuid(), name text not null, created_at timestamptz not null default now());
create table public.contacts(id uuid primary key default gen_random_uuid(), email text not null unique check(email=lower(trim(email))), first_name text not null default '', last_name text not null default '', organization text not null default '', unsubscribed_at timestamptz, created_at timestamptz not null default now());
create table public.list_memberships(list_id uuid references public.lead_lists on delete cascade, contact_id uuid references public.contacts on delete cascade, primary key(list_id,contact_id));
create table public.campaigns(
 id uuid primary key default gen_random_uuid(), name text not null, list_id uuid references public.lead_lists,
 subject text not null default '', title text not null default '', webinar_when text not null default '', body text not null default '', registration_url text not null default '',
 company_name text not null default 'R3VCORE', postal_address text not null default '', contact_reason text not null default '',
 status text not null default 'draft' check(status in('draft','sending','paused','completed')),
 version integer not null default 1, tested_version integer, followup_from uuid references public.campaigns,
 created_at timestamptz not null default now(), last_error text);
create table public.recipients(
 id uuid primary key default gen_random_uuid(), campaign_id uuid not null references public.campaigns on delete cascade, contact_id uuid references public.contacts,
 email text not null, first_name text not null default '', last_name text not null default '', snapshot jsonb not null,
 status text not null default 'queued' check(status in('queued','sending','accepted','failed','uncertain','skipped')),
 is_test boolean not null default false, attempted_at timestamptz, accepted_at timestamptz, registered_at timestamptz,
 gmail_id text, error text, claim_id uuid);
create unique index recipient_campaign_email on public.recipients(campaign_id,email) where not is_test;
create table public.email_events(id bigint generated always as identity primary key, recipient_id uuid not null references public.recipients on delete cascade, kind text not null check(kind in('image_load','link_request','unsubscribe')), created_at timestamptz not null default now());
create table public.worker_lock(id integer primary key check(id=1), owner uuid, expires_at timestamptz);
insert into public.worker_lock(id) values(1);
create index recipients_queue_idx on public.recipients(status,is_test);
create index events_recipient_idx on public.email_events(recipient_id,kind);

create function public.import_leads(p_name text,p_rows jsonb) returns jsonb language plpgsql set search_path=public as $$
declare lid uuid; r jsonb; cid uuid; n integer:=0;
begin
 if jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows)>2000 then raise exception 'Invalid import size'; end if;
 insert into lead_lists(name) values(p_name) returning id into lid;
 for r in select value from jsonb_array_elements(p_rows) loop
  insert into contacts(email,first_name,last_name,organization) values(lower(trim(r->>'email')),coalesce(r->>'first_name',''),coalesce(r->>'last_name',''),coalesce(r->>'organization',''))
  on conflict(email) do update set first_name=case when excluded.first_name<>'' then excluded.first_name else contacts.first_name end,last_name=case when excluded.last_name<>'' then excluded.last_name else contacts.last_name end,organization=case when excluded.organization<>'' then excluded.organization else contacts.organization end returning id into cid;
  insert into list_memberships values(lid,cid) on conflict do nothing; n:=n+1;
 end loop;
 return jsonb_build_object('list_id',lid,'imported',n);
end $$;

create function public.save_campaign(p_id uuid,p_version integer,p_data jsonb) returns jsonb language plpgsql set search_path=public as $$
declare c campaigns;
begin
 select * into c from campaigns where id=p_id for update;
 if not found or c.status<>'draft' or c.version<>p_version then raise exception 'Campaign changed or is no longer a draft'; end if;
 update campaigns set name=p_data->>'name',list_id=(p_data->>'list_id')::uuid,subject=p_data->>'subject',title=p_data->>'title',webinar_when=p_data->>'webinar_when',body=p_data->>'body',registration_url=p_data->>'registration_url',company_name=p_data->>'company_name',postal_address=p_data->>'postal_address',contact_reason=p_data->>'contact_reason',version=version+1,tested_version=null,last_error=null where id=p_id returning * into c;
 return to_jsonb(c);
end $$;

create function public.start_campaign(p_id uuid) returns jsonb language plpgsql set search_path=public as $$
declare c campaigns; n integer;
begin
 select * into c from campaigns where id=p_id for update;
 if not found or c.status not in('draft','paused') then raise exception 'Campaign cannot start'; end if;
 if exists(select 1 from recipients where campaign_id=p_id and status='uncertain') then raise exception 'Review uncertain sends before resuming'; end if;
 if c.status='draft' then
  if c.tested_version is distinct from c.version then raise exception 'Send a successful test of the current version first'; end if;
  if c.list_id is null then raise exception 'Select a lead list'; end if;
  insert into recipients(campaign_id,contact_id,email,first_name,last_name,snapshot)
  select c.id,l.id,l.email,l.first_name,l.last_name,to_jsonb(c) from contacts l join list_memberships lm on lm.contact_id=l.id and lm.list_id=c.list_id
  where l.unsubscribed_at is null and (c.followup_from is null or not exists(select 1 from recipients prior where prior.campaign_id=c.followup_from and prior.email=l.email and prior.registered_at is not null))
  on conflict(campaign_id,email) where not is_test do nothing;
 end if;
 select count(*) into n from recipients where campaign_id=p_id and status='queued' and not is_test;
 if n=0 then raise exception 'No eligible queued recipients'; end if;
 update campaigns set status='sending',last_error=null where id=p_id;
 return jsonb_build_object('queued',n);
end $$;

create function public.acquire_worker() returns uuid language plpgsql set search_path=public as $$
declare own uuid:=gen_random_uuid(); current_lock worker_lock;
begin
 select * into current_lock from worker_lock where id=1 for update;
 if current_lock.expires_at>now() then return null; end if;
 -- Never re-send a stale claimed message: Gmail may already have accepted it.
 update recipients set status='uncertain',error='Worker interrupted; inspect Gmail Sent Mail before resolving' where status='sending';
 update campaigns set status='paused',last_error='Review an interrupted send' where status='sending' and exists(select 1 from recipients r where r.campaign_id=campaigns.id and r.status='uncertain');
 update worker_lock set owner=own,expires_at=now()+interval '3 minutes' where id=1;
 return own;
end $$;
create function public.release_worker(p_owner uuid) returns void language sql set search_path=public as $$ update worker_lock set owner=null,expires_at=null where id=1 and owner=p_owner $$;

create function public.claim_recipient(p_owner uuid,p_cap integer) returns setof public.recipients language plpgsql set search_path=public as $$
declare rid uuid;
begin
 if not exists(select 1 from worker_lock where id=1 and owner=p_owner and expires_at>now()) then return; end if;
 update recipients r set status='skipped',error='Unsubscribed or registered' where r.status='queued' and not r.is_test and (r.registered_at is not null or exists(select 1 from contacts ct where ct.id=r.contact_id and ct.unsubscribed_at is not null) or exists(select 1 from recipients prior where prior.campaign_id=(r.snapshot->>'followup_from')::uuid and prior.email=r.email and prior.registered_at is not null));
 update campaigns c set status='completed' where c.status='sending' and not exists(select 1 from recipients r where r.campaign_id=c.id and not r.is_test and r.status in('queued','sending','uncertain'));
 if (select count(*) from recipients where attempted_at>now()-interval '24 hours')>=p_cap then return; end if;
 select r.id into rid from recipients r join campaigns c on c.id=r.campaign_id where r.status='queued' and not r.is_test and c.status='sending' order by c.created_at,r.id limit 1 for update of r skip locked;
 if rid is null then return; end if;
 return query update recipients set status='sending',attempted_at=now(),claim_id=p_owner where id=rid returning *;
end $$;

create function public.suppress_recipient(p_id uuid) returns void language plpgsql set search_path=public as $$
declare e text; changed integer;
begin
 select email into e from recipients where id=p_id;
 if e is null then raise exception 'Message not found'; end if;
 update contacts set unsubscribed_at=now() where email=e and unsubscribed_at is null;
 get diagnostics changed=row_count;
 if changed>0 then insert into email_events(recipient_id,kind) values(p_id,'unsubscribe'); end if;
 update recipients set status='skipped',error='Unsubscribed' where email=e and status='queued' and not is_test;
end $$;

create function public.import_registrations(p_campaign uuid,p_emails jsonb) returns integer language plpgsql set search_path=public as $$
declare n integer;
begin
 update recipients set registered_at=coalesce(registered_at,now()),status=case when status='queued' then 'skipped' else status end where campaign_id=p_campaign and not is_test and email in(select lower(trim(value)) from jsonb_array_elements_text(p_emails));
 get diagnostics n=row_count; return n;
end $$;

create function public.campaign_report(p_id uuid) returns jsonb language sql set search_path=public as $$
 select jsonb_build_object('recipients',coalesce((select jsonb_agg(to_jsonb(x) order by x.email) from (select r.id,r.email,r.first_name,r.last_name,r.status,r.accepted_at,r.registered_at,r.error,r.is_test,(select count(*) from email_events e where e.recipient_id=r.id and e.kind='image_load') as opens,(select count(*) from email_events e where e.recipient_id=r.id and e.kind='link_request') as clicks from recipients r where r.campaign_id=p_id) x),'[]'::jsonb),
 'stats',jsonb_build_object('total',(select count(*) from recipients where campaign_id=p_id and not is_test),'accepted',(select count(*) from recipients where campaign_id=p_id and status='accepted' and not is_test),'queued',(select count(*) from recipients where campaign_id=p_id and status='queued' and not is_test),'uncertain',(select count(*) from recipients where campaign_id=p_id and status='uncertain' and not is_test),'failed',(select count(*) from recipients where campaign_id=p_id and status='failed' and not is_test),'registered',(select count(*) from recipients where campaign_id=p_id and registered_at is not null and not is_test),'open_signals',(select count(distinct r.id) from recipients r join email_events e on e.recipient_id=r.id where r.campaign_id=p_id and not r.is_test and e.kind='image_load'),'click_signals',(select count(distinct r.id) from recipients r join email_events e on e.recipient_id=r.id where r.campaign_id=p_id and not r.is_test and e.kind='link_request')))
 $$;

-- No anonymous/authenticated access to campaign data or privileged RPCs.
do $$ declare t text; f record; begin
 foreach t in array array['lead_lists','contacts','list_memberships','campaigns','recipients','email_events','worker_lock'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on table public.%I from anon, authenticated',t);
  execute format('grant all on table public.%I to service_role',t);
 end loop;
 for f in select oid::regprocedure as signature from pg_proc where pronamespace='public'::regnamespace and proname in('import_leads','save_campaign','start_campaign','acquire_worker','release_worker','claim_recipient','suppress_recipient','import_registrations','campaign_report') loop
  execute format('revoke all on function %s from public, anon, authenticated',f.signature);
  execute format('grant execute on function %s to service_role',f.signature);
 end loop;
end $$;
grant usage,select on sequence public.email_events_id_seq to service_role;
