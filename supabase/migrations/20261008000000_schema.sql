-- Tables and indexes. Security (grants, RLS) is in the functions/security migration.

create table public.companies (
  id uuid primary key,
  slug text not null unique check (slug in ('acme', 'globex')),
  name text not null,
  plan text not null default 'free' check (plan in ('free', 'paid')),
  searches_used int not null default 0 check (searches_used >= 0)
);

create table public.recruiters (
  user_id uuid primary key references auth.users (id) on delete cascade,
  company_id uuid not null references public.companies (id)
);

create table public.candidates (
  id text primary key check (id ~ '^cand_[0-9]{4}$'),
  full_name text not null,
  avatar_url text not null,
  headline text not null,
  current_title text not null,
  current_company text not null,
  current_company_logo_url text not null,
  current_company_type text not null,
  role text not null,
  seniority text not null,
  years_experience int not null,
  city text not null,
  state text not null,
  open_to_work boolean not null,
  skills text[] not null,
  companies text[] not null,
  company_types text[] not null,
  degrees text[] not null,
  fields text[] not null,
  schools text[] not null,
  profile jsonb not null
);
create index candidates_role_idx on public.candidates (role);
create index candidates_seniority_idx on public.candidates (seniority);
create index candidates_city_idx on public.candidates (city);
create index candidates_years_idx on public.candidates (years_experience);
create index candidates_skills_gin on public.candidates using gin (skills);
create index candidates_companies_gin on public.candidates using gin (companies);
create index candidates_company_types_gin on public.candidates using gin (company_types);
create index candidates_degrees_gin on public.candidates using gin (degrees);
create index candidates_fields_gin on public.candidates using gin (fields);
create index candidates_schools_gin on public.candidates using gin (schools);

create table public.searches (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id),
  brief text not null check (char_length(brief) between 1 and 500),
  filters jsonb,
  status text not null check (status in ('pending', 'ready', 'refunded')),
  root_id uuid references public.searches (id),
  corrections_used int not null default 0,
  created_at timestamptz not null default now()
);
create index searches_company_idx on public.searches (company_id);

create table public.shortlists (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id),
  name text not null check (char_length(name) between 1 and 80),
  created_at timestamptz not null default now(),
  unique (company_id, name),
  unique (id, company_id)
);

create table public.shortlist_members (
  shortlist_id uuid not null,
  company_id uuid not null,
  candidate_id text not null references public.candidates (id),
  added_at timestamptz not null default now(),
  primary key (shortlist_id, candidate_id),
  foreign key (shortlist_id, company_id) references public.shortlists (id, company_id) on delete cascade
);

create table public.saved_briefs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id),
  brief text not null check (char_length(brief) between 1 and 500),
  filters jsonb not null,
  created_at timestamptz not null default now()
);
create index saved_briefs_company_idx on public.saved_briefs (company_id, created_at desc);

create table public.subscriptions (
  stripe_subscription_id text primary key,
  company_id uuid not null references public.companies (id),
  status text not null,
  last_event_created bigint not null,
  last_event_type text not null
);

create table public.billing_events (
  event_id text primary key,
  received_at timestamptz not null default now()
);
