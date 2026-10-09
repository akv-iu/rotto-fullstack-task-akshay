-- Functions, then RLS, then grants (last, so nothing created here keeps Supabase's broad default grants).

-- ---------- helpers ----------
create function public.current_company_id() returns uuid
language sql stable security definer set search_path = ''
as $$ select company_id from public.recruiters where user_id = auth.uid() $$;

-- Safe readers for filter JSON: wrong types read as "not set", never as an error or a match-all.
create function public.f_arr(f jsonb, k text) returns text[]
language sql immutable set search_path = ''
as $$ select case when jsonb_typeof(f -> k) = 'array' and jsonb_array_length(f -> k) > 0
                  then array(select jsonb_array_elements_text(f -> k)) end $$;

create function public.f_num(f jsonb, k text) returns numeric
language sql immutable set search_path = ''
as $$ select case when jsonb_typeof(f -> k) = 'number' then (f ->> k)::numeric end $$;

create function public.f_txt(f jsonb, k text) returns text
language sql immutable set search_path = ''
as $$ select case when jsonb_typeof(f -> k) = 'string' then f ->> k end $$;

-- True only if nothing is unsupported AND at least one condition actually narrows the set.
create function public.filters_have_conditions(f jsonb) returns boolean
language sql immutable set search_path = ''
as $$
  select coalesce(f -> 'unsupported', '[]'::jsonb) in ('[]'::jsonb, 'null'::jsonb) and (
       public.f_arr(f, 'roles') is not null or public.f_arr(f, 'seniorities') is not null
    or public.f_arr(f, 'cities') is not null or public.f_arr(f, 'skills') is not null
    or public.f_arr(f, 'any_skills') is not null or public.f_arr(f, 'companies') is not null
    or public.f_arr(f, 'current_companies') is not null or public.f_arr(f, 'degrees') is not null
    or public.f_arr(f, 'fields') is not null or public.f_arr(f, 'schools') is not null
    or public.f_arr(f, 'not_skills') is not null or public.f_arr(f, 'not_companies') is not null
    or public.f_arr(f, 'not_roles') is not null or public.f_arr(f, 'all_companies') is not null
    or public.f_txt(f, 'never_company_type') is not null
    or coalesce(public.f_num(f, 'min_years'), 0) > 0 or coalesce(public.f_num(f, 'max_years'), 15) < 15
    or jsonb_typeof(f -> 'open_to_work') = 'boolean'  -- true: open to work; false: not open
    or public.f_txt(f, 'worked_at_company_type') is not null or public.f_txt(f, 'current_company_type') is not null)
$$;

-- ---------- search (service_role only: the server calls it after checking the recruiter; see grants) ----------
create function public.search_candidates(f jsonb, lim int, off int) returns jsonb
language sql stable security invoker set search_path = ''
as $$
  -- Read each filter once (one row), not once per candidate: keeps the query fast and lets the GIN indexes work.
  with p as materialized (  -- MATERIALIZED: else Postgres inlines it and re-reads the filters for every candidate (240 ms → 7 ms)
    select public.f_arr(f, 'roles') roles, public.f_arr(f, 'seniorities') seniorities, public.f_arr(f, 'cities') cities,
           public.f_arr(f, 'skills') skills, public.f_arr(f, 'any_skills') any_skills, public.f_arr(f, 'companies') companies,
           public.f_arr(f, 'current_companies') current_companies, public.f_arr(f, 'degrees') degrees,
           public.f_arr(f, 'fields') fields, public.f_arr(f, 'schools') schools,
           public.f_arr(f, 'not_skills') not_skills, public.f_arr(f, 'not_companies') not_companies,
           public.f_arr(f, 'not_roles') not_roles, public.f_arr(f, 'all_companies') all_companies,
           public.f_txt(f, 'never_company_type') never_type,
           public.f_num(f, 'min_years') min_years, public.f_num(f, 'max_years') max_years,
           case when jsonb_typeof(f -> 'open_to_work') = 'boolean' then (f ->> 'open_to_work')::boolean end want_open,
           public.f_txt(f, 'worked_at_company_type') worked_type, public.f_txt(f, 'current_company_type') current_type,
           public.filters_have_conditions(f) ok
  ),
  m as (
    select c.id, c.full_name, c.avatar_url, c.headline, c.current_title, c.current_company, c.city,
           c.years_experience, c.open_to_work, c.skills
    from public.candidates c, p
    where p.ok
      and (p.roles is null or c.role = any (p.roles))
      and (p.seniorities is null or c.seniority = any (p.seniorities))
      and (p.cities is null or c.city = any (p.cities))
      and (p.skills is null or c.skills @> p.skills)
      and (p.any_skills is null or c.skills && p.any_skills)
      and (p.companies is null or c.companies && p.companies)
      and (p.current_companies is null or c.current_company = any (p.current_companies))
      and (p.degrees is null or c.degrees && p.degrees)
      and (p.fields is null or c.fields && p.fields)
      and (p.schools is null or c.schools && p.schools)
      and (p.min_years is null or c.years_experience >= p.min_years)
      and (p.max_years is null or c.years_experience <= p.max_years)
      and (p.want_open is null or c.open_to_work = p.want_open)
      and (p.worked_type is null or c.company_types @> array[p.worked_type])
      and (p.current_type is null or c.current_company_type = p.current_type)
      and (p.not_skills is null or not c.skills && p.not_skills)
      and (p.not_companies is null or not c.companies && p.not_companies)
      and (p.not_roles is null or not c.role = any (p.not_roles))
      and (p.all_companies is null or c.companies @> p.all_companies)
      and (p.never_type is null or not c.company_types @> array[p.never_type])
  ),
  -- Last line of defence: filters that match every candidate (e.g. all 10 cities, however they got past the app's
  -- checks) return nobody. "Never return everyone" then holds whatever the filter JSON says.
  n as (select count(*) total, count(*) = (select count(*) from public.candidates) everyone from m)
  select case when (select everyone from n) then jsonb_build_object('total', 0, 'results', '[]'::jsonb)
  else jsonb_build_object(
    'total', (select total from n),
    'results', coalesce((
      select jsonb_agg(to_jsonb(r) order by r.open_to_work desc, r.years_experience desc, r.id)
      from (select * from m order by open_to_work desc, years_experience desc, id
            limit least(greatest(lim, 0), 100) offset greatest(off, 0)) r
    ), '[]'::jsonb)) end
$$;

-- ---------- quota: the only way searches are created or changed ----------
create function public.reserve_search(p_brief text) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare cid uuid := public.current_company_id(); sid uuid;
begin
  if cid is null then raise exception 'not a recruiter' using errcode = '42501'; end if;
  -- One statement takes the search; concurrent callers queue on the row lock and re-check the condition.
  update public.companies set searches_used = searches_used + 1
   where id = cid and (plan = 'paid' or searches_used < 1);
  if not found then return null; end if;
  insert into public.searches (company_id, brief, status) values (cid, p_brief, 'pending') returning id into sid;
  return sid;
end $$;

create function public.complete_search(p_search uuid, p_filters jsonb) returns boolean
language plpgsql security definer set search_path = ''
as $$
begin
  update public.searches set status = 'ready', filters = p_filters
   where id = p_search and company_id = public.current_company_id() and status = 'pending';
  return found;
end $$;

-- Server only (see grants): the server refunds after its own AI call failed. A recruiter could otherwise refund an
-- in-flight search and reserve another, paying for unlimited AI calls on one free search.
create function public.refund_search(p_search uuid, p_company uuid) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare cid uuid := p_company;
begin
  -- Only a search still waiting on the AI can be refunded; a finished one never can.
  update public.searches set status = 'refunded'
   where id = p_search and company_id = cid and status = 'pending';
  if not found then return false; end if;
  update public.companies set searches_used = greatest(searches_used - 1, 0) where id = cid;
  return true;
end $$;

create function public.create_correction(p_parent uuid, p_filters jsonb) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare cid uuid := public.current_company_id(); root_row public.searches; sid uuid;
begin
  select r.* into root_row
    from public.searches p join public.searches r on r.id = coalesce(p.root_id, p.id)
   where p.id = p_parent and p.company_id = cid and p.status = 'ready' and r.status = 'ready';
  if not found then return jsonb_build_object('error', 'not_found'); end if;
  -- Free plan: 10 corrections per search, so rewriting the filters can't stand in for new searches. Paid: no cap.
  update public.searches set corrections_used = corrections_used + 1
   where id = root_row.id
     and (corrections_used < 10 or exists (select 1 from public.companies where id = cid and plan = 'paid'));
  if not found then return jsonb_build_object('error', 'cap'); end if;
  insert into public.searches (company_id, brief, filters, status, root_id)
  values (cid, root_row.brief, p_filters, 'ready', root_row.id) returning id into sid;
  return jsonb_build_object('id', sid);
end $$;

-- ---------- billing (service_role only) ----------
create function public.apply_billing_event(
  p_event_id text, p_created bigint, p_type text, p_subscription text, p_company text, p_status text
) returns text
language plpgsql security definer set search_path = ''
as $$
declare cid uuid; eff text;
begin
  insert into public.billing_events (event_id) values (p_event_id) on conflict do nothing;
  if not found then return 'duplicate'; end if;
  -- Lock every company row, always in the same order, before touching any: events apply one at a time, the plan below
  -- never reads stale state, and two events for different companies can't each hold one row and wait for the other.
  perform 1 from public.companies order by id for update;
  select id into cid from public.companies where slug = p_company;
  if cid is null then return 'unknown_company'; end if;
  eff := case when p_type = 'customer.subscription.deleted' then 'canceled' else p_status end;
  -- Older events never overwrite newer state; on a same-second tie a cancellation wins.
  insert into public.subscriptions as s (stripe_subscription_id, company_id, status, last_event_created, last_event_type)
  values (p_subscription, cid, eff, p_created, p_type)
  on conflict (stripe_subscription_id) do update
     set company_id = excluded.company_id, status = excluded.status,
         last_event_created = excluded.last_event_created, last_event_type = excluded.last_event_type
   where s.last_event_created < excluded.last_event_created
      or (s.last_event_created = excluded.last_event_created and (excluded.status = 'canceled' or s.status <> 'canceled'));
  if not found then return 'stale'; end if;
  update public.companies c
     set plan = case when exists (select 1 from public.subscriptions x
                                   where x.company_id = c.id and x.status in ('active', 'trialing'))
                     then 'paid' else 'free' end
   where true;  -- both companies (2 rows): also right if a subscription moved between companies
  return 'applied';
end $$;

-- ---------- row level security ----------
alter table public.candidates enable row level security;
alter table public.companies enable row level security;
alter table public.recruiters enable row level security;
alter table public.searches enable row level security;
alter table public.shortlists enable row level security;
alter table public.shortlist_members enable row level security;
alter table public.saved_briefs enable row level security;
alter table public.subscriptions enable row level security;   -- no policies: invisible to recruiters
alter table public.billing_events enable row level security;  -- no policies: invisible to recruiters

-- candidates: RLS on and no policy, and no grant below. Recruiters can't read or filter candidates directly,
-- otherwise a free company could skip its one-search limit by querying Supabase itself (SCORING §6).
create policy companies_own on public.companies for select to authenticated
  using (id = (select public.current_company_id()));
create policy recruiters_own on public.recruiters for select to authenticated
  using (user_id = (select auth.uid()));
create policy searches_own on public.searches for select to authenticated
  using (company_id = (select public.current_company_id()));
create policy shortlists_own on public.shortlists for all to authenticated
  using (company_id = (select public.current_company_id()))
  with check (company_id = (select public.current_company_id()));
create policy members_own on public.shortlist_members for all to authenticated
  using (company_id = (select public.current_company_id()))
  with check (company_id = (select public.current_company_id()));
create policy saved_briefs_own on public.saved_briefs for all to authenticated
  using (company_id = (select public.current_company_id()))
  with check (company_id = (select public.current_company_id()));

-- ---------- grants: remove Supabase's broad defaults, then grant back only what's needed ----------
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;
-- ...and for anything a later migration creates.
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;

grant select on public.companies, public.recruiters, public.searches to authenticated;
grant select, insert, delete on public.shortlists to authenticated;
grant update (name) on public.shortlists to authenticated;
grant select, insert, delete on public.shortlist_members, public.saved_briefs to authenticated;

grant execute on function
  public.current_company_id(), public.f_arr(jsonb, text), public.f_num(jsonb, text), public.f_txt(jsonb, text),
  public.filters_have_conditions(jsonb),
  public.reserve_search(text), public.complete_search(uuid, jsonb),
  public.create_correction(uuid, jsonb)
to authenticated;
grant execute on function public.apply_billing_event(text, bigint, text, text, text, text), public.search_candidates(jsonb, int, int),
  public.refund_search(uuid, uuid),
  public.f_arr(jsonb, text), public.f_num(jsonb, text), public.f_txt(jsonb, text), public.filters_have_conditions(jsonb)
to service_role;
