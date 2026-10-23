alter table public.companies drop constraint companies_slug_check;
alter table public.companies add column is_demo boolean not null default false;
alter table public.companies add column searches_day date;

create table public.demo_daily_usage (
  day date primary key,
  attempts int not null check (attempts between 1 and 100)
);
alter table public.demo_daily_usage enable row level security;
revoke all on public.demo_daily_usage from anon, authenticated;
grant select, insert, update, delete on public.demo_daily_usage to service_role;

-- Anonymous visitors get separate workspaces; user metadata never chooses a company.
create function public.create_demo_workspace() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare cid uuid := gen_random_uuid();
begin
  if new.is_anonymous then
    insert into public.companies (id, slug, name, is_demo)
    values (cid, 'demo-' || cid::text, 'Demo workspace', true);
    insert into public.recruiters (user_id, company_id) values (new.id, cid);
  end if;
  return new;
end $$;
revoke all on function public.create_demo_workspace() from public, anon, authenticated;
create trigger create_demo_workspace after insert on auth.users
for each row execute function public.create_demo_workspace();

create or replace function public.reserve_search(p_brief text) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  cid uuid := public.current_company_id();
  c public.companies;
  sid uuid;
  today date := (now() at time zone 'UTC')::date;
  reserved int;
begin
  if cid is null then raise exception 'not a recruiter' using errcode = '42501'; end if;
  select * into c from public.companies where id = cid for update;
  if c.is_demo then
    if c.searches_day = today and c.searches_used >= 5 then return null; end if;
    -- Count attempts globally even when the AI fails; repeated failures cannot bypass the daily spending cap.
    insert into public.demo_daily_usage (day, attempts) values (today, 1)
    on conflict (day) do update set attempts = public.demo_daily_usage.attempts + 1
      where public.demo_daily_usage.attempts < 100
    returning attempts into reserved;
    if reserved is null then return null; end if;
    update public.companies set searches_used = case when searches_day = today then searches_used + 1 else 1 end,
      searches_day = today where id = cid;
  else
    update public.companies set searches_used = searches_used + 1
      where id = cid and (plan = 'paid' or searches_used < 1);
    if not found then return null; end if;
  end if;
  insert into public.searches (company_id, brief, status) values (cid, p_brief, 'pending') returning id into sid;
  return sid;
end $$;

create or replace function public.refund_search(p_search uuid, p_company uuid) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare searched_at timestamptz;
begin
  update public.searches set status = 'refunded'
    where id = p_search and company_id = p_company and status = 'pending'
    returning created_at into searched_at;
  if not found then return false; end if;
  -- A search from yesterday must not refund one of today's demo searches after the daily reset.
  update public.companies set searches_used = greatest(searches_used - 1, 0)
    where id = p_company and (not is_demo or searches_day = (searched_at at time zone 'UTC')::date);
  return true;
end $$;

-- shortcut: anonymous workspaces persist, add scheduled cleanup if demo traffic grows.
