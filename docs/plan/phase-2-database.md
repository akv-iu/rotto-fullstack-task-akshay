# Phase 2: Database and security

> **In short:** Puts the security rules inside the database itself: each company sees only its own lists, saved searches and searches, and nobody can change plans, quotas or billing directly.
> It also holds the fixed SQL search and the race-safe "one free search" counter; the tests attack it the way the grader's script will, with a real recruiter's token.

Goal: the database itself keeps the companies apart and protects the plan, quota and billing tables, even against a recruiter calling Supabase directly with their own token. This is worth the all-or-nothing 10 security points, plus the free-plan points.

---

### Task 4: Security migration (grants, RLS) and the SQL functions

**Files:**
- Create: `supabase/migrations/20261008000100_functions_security.sql`
- Test: `tests/db.test.ts`

**Interfaces:**
- Consumes: the tables from Task 2; helpers `admin()`, `signIn()`, `asUser()`, `resetCompany()`, `COMPANY`.
- Produces (callable through `client.rpc(name, args)`):
  - `current_company_id() → uuid`
  - `search_candidates(f jsonb, lim int, off int) → jsonb { total: number, results: CandidateCard[] }` (**service_role only**: the server calls it after its own checks; a recruiter calling it directly gets `42501`) where `CandidateCard = { id, full_name, avatar_url, headline, current_title, current_company, city, years_experience, open_to_work, skills }`
  - `reserve_search(p_brief text) → uuid | null` (null = no searches left)
  - `complete_search(p_search uuid, p_filters jsonb) → boolean`
  - `refund_search(p_search uuid) → boolean`
  - `create_correction(p_parent uuid, p_filters jsonb) → jsonb` = `{ id }` or `{ error: 'not_found' | 'cap' }`
  - `apply_billing_event(p_event_id text, p_created bigint, p_type text, p_subscription text, p_company text, p_status text) → text` = `'applied' | 'duplicate' | 'stale' | 'unknown_company'` (service_role only)

- [ ] **Step 1: Write the failing test `tests/db.test.ts`**

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { COMPANY, admin, asUser, resetCompany, signIn } from './helpers';

const rpc = async (token: string, fn: string, args: Record<string, unknown>) => {
  const { data, error } = await asUser(token).rpc(fn, args);
  if (error) throw new Error(error.message);
  return data;
};
// The search runs with the server's key (recruiters can't call it), so these tests do too.
const search = async (args: Record<string, unknown>) => {
  const { data, error } = await admin().rpc('search_candidates', args);
  if (error) throw new Error(error.message);
  return data;
};

describe('search_candidates', () => {
  it('returns nobody when there are no real conditions (never everyone)', async () => {
    for (const f of [{}, { min_years: 0 }, { max_years: 15 }, { roles: [] }, { open_to_work: false }]) {
      expect((await search({ f, lim: 20, off: 0 })).total).toBe(0);
    }
  });

  it('returns nobody when anything is unsupported', async () => {
    const r = await search({ f: { roles: ['Product Manager'], unsupported: [{ text: 'speaks Japanese', reason: 'unsupported' }] }, lim: 20, off: 0 });
    expect(r.total).toBe(0);
  });

  it('matches exactly (data scientists with a PhD = 47)', async () => {
    const r = await search({ f: { roles: ['Data Scientist'], degrees: ['PhD'] }, lim: 20, off: 0 });
    expect(r.total).toBe(47);
    expect(r.results).toHaveLength(20);
    expect(Object.keys(r.results[0]).sort()).toEqual(
      ['avatar_url', 'city', 'current_company', 'current_title', 'full_name', 'headline', 'id', 'open_to_work', 'skills', 'years_experience'],
    );
  });

  it('pages through every result exactly once in a stable order', async () => {
    const f = { roles: ['Mobile Engineer'], skills: ['Swift'] };
    const seen: string[] = [];
    for (let off = 0; off < 220; off += 20) {
      const r = await search({ f, lim: 20, off });
      seen.push(...r.results.map((c: { id: string }) => c.id));
    }
    expect(seen).toHaveLength(199);
    expect(new Set(seen).size).toBe(199);
    const past = await search({ f, lim: 20, off: 400 });
    expect(past.total).toBe(199);
    expect(past.results).toEqual([]);
  });
});

describe('quota functions', () => {
  beforeEach(() => resetCompany('acme'));

  it('reserve_search grants exactly one of 20 concurrent free searches', async () => {
    const t = await signIn('acme');
    const ids = await Promise.all(Array.from({ length: 20 }, () => rpc(t, 'reserve_search', { p_brief: 'x' })));
    expect(ids.filter(Boolean)).toHaveLength(1);
  });

  it('refund_search only refunds a pending search', async () => {
    const t = await signIn('acme');
    const id = await rpc(t, 'reserve_search', { p_brief: 'x' });
    expect(await rpc(t, 'complete_search', { p_search: id, p_filters: { roles: ['Recruiter'] } })).toBe(true);
    expect(await rpc(t, 'refund_search', { p_search: id })).toBe(false);
    expect(await rpc(t, 'reserve_search', { p_brief: 'y' })).toBeNull();

    await resetCompany('acme');
    const pending = await rpc(t, 'reserve_search', { p_brief: 'x' });
    expect(await rpc(t, 'refund_search', { p_search: pending })).toBe(true);
    expect(await rpc(t, 'reserve_search', { p_brief: 'y' })).toBeTruthy();
  });

  it('create_correction allows 10 corrections per root, then reports the cap', async () => {
    const t = await signIn('acme');
    const root = await rpc(t, 'reserve_search', { p_brief: 'x' });
    await rpc(t, 'complete_search', { p_search: root, p_filters: { roles: ['Recruiter'] } });
    let parent = root;
    for (let i = 0; i < 10; i++) {
      const r = await rpc(t, 'create_correction', { p_parent: parent, p_filters: { roles: ['Recruiter'] } });
      expect(r.id).toBeTruthy();
      parent = r.id; // corrections of corrections count against the same root
    }
    expect(await rpc(t, 'create_correction', { p_parent: parent, p_filters: {} })).toEqual({ error: 'cap' });
  });
});

describe('apply_billing_event', () => {
  beforeEach(async () => {
    const db = admin();
    await db.from('billing_events').delete().neq('event_id', '');
    await resetCompany('acme');
  });

  const apply = async (id: string, created: number, type: string, status: string) => {
    const { data, error } = await admin().rpc('apply_billing_event', {
      p_event_id: id, p_created: created, p_type: type, p_subscription: 'sub_test', p_company: 'acme', p_status: status,
    });
    if (error) throw new Error(error.message);
    return data;
  };
  const plan = async () => (await admin().from('companies').select('plan').eq('id', COMPANY.acme).single()).data!.plan;

  it('applies, ignores repeats and older events, and lets a same-second cancellation win', async () => {
    expect(await apply('e1', 100, 'customer.subscription.created', 'active')).toBe('applied');
    expect(await plan()).toBe('paid');
    expect(await apply('e1', 100, 'customer.subscription.created', 'active')).toBe('duplicate');
    expect(await apply('e0', 90, 'customer.subscription.updated', 'incomplete')).toBe('stale');
    expect(await plan()).toBe('paid');
    expect(await apply('e2', 100, 'customer.subscription.deleted', 'canceled')).toBe('applied');
    expect(await plan()).toBe('free');
    expect(await apply('e3', 100, 'customer.subscription.updated', 'active')).toBe('stale');
    expect(await plan()).toBe('free');
  });

  it('cannot be called by a recruiter', async () => {
    const { error } = await asUser(await signIn('acme')).rpc('apply_billing_event', {
      p_event_id: 'x', p_created: 1, p_type: 'customer.subscription.created', p_subscription: 's', p_company: 'acme', p_status: 'active',
    });
    expect(error?.code).toBe('42501'); // permission denied, not just "some error"
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- tests/db.test.ts`
Expected: FAIL with "Could not find the function public.search_candidates".

- [ ] **Step 3: Write `supabase/migrations/20261008000100_functions_security.sql`**

```sql
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
    or coalesce(public.f_num(f, 'min_years'), 0) > 0 or coalesce(public.f_num(f, 'max_years'), 15) < 15
    or f -> 'open_to_work' = 'true'::jsonb
    or public.f_txt(f, 'worked_at_company_type') is not null or public.f_txt(f, 'current_company_type') is not null)
$$;

-- ---------- search (service_role only: the server calls it after checking the recruiter; see grants) ----------
create function public.search_candidates(f jsonb, lim int, off int) returns jsonb
language sql stable security invoker set search_path = ''
as $$
  -- Read each filter once (one row), not once per candidate: keeps the query fast and lets the GIN indexes work.
  with p as (
    select public.f_arr(f, 'roles') roles, public.f_arr(f, 'seniorities') seniorities, public.f_arr(f, 'cities') cities,
           public.f_arr(f, 'skills') skills, public.f_arr(f, 'any_skills') any_skills, public.f_arr(f, 'companies') companies,
           public.f_arr(f, 'current_companies') current_companies, public.f_arr(f, 'degrees') degrees,
           public.f_arr(f, 'fields') fields, public.f_arr(f, 'schools') schools,
           public.f_num(f, 'min_years') min_years, public.f_num(f, 'max_years') max_years,
           f -> 'open_to_work' = 'true'::jsonb open_only,
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
      and (p.open_only is not true or c.open_to_work)
      and (p.worked_type is null or c.company_types @> array[p.worked_type])
      and (p.current_type is null or c.current_company_type = p.current_type)
  )
  select jsonb_build_object(
    'total', (select count(*) from m),
    'results', coalesce((
      select jsonb_agg(to_jsonb(r) order by r.open_to_work desc, r.years_experience desc, r.id)
      from (select * from m order by open_to_work desc, years_experience desc, id
            limit least(greatest(lim, 0), 100) offset greatest(off, 0)) r
    ), '[]'::jsonb))
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

create function public.refund_search(p_search uuid) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare cid uuid := public.current_company_id();
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
  update public.searches set corrections_used = corrections_used + 1
   where id = root_row.id and corrections_used < 10;
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
  -- Lock the company row: concurrent events for one company apply one at a time, so the plan below never reads stale state.
  select id into cid from public.companies where slug = p_company for update;
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
  public.reserve_search(text), public.complete_search(uuid, jsonb), public.refund_search(uuid),
  public.create_correction(uuid, jsonb)
to authenticated;
grant execute on function public.apply_billing_event(text, bigint, text, text, text, text), public.search_candidates(jsonb, int, int),
  public.f_arr(jsonb, text), public.f_num(jsonb, text), public.f_txt(jsonb, text), public.filters_have_conditions(jsonb)
to service_role;
```

- [ ] **Step 4: Apply and run the tests**

```bash
npm run db:setup
npm test -- tests/db.test.ts
```
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261008000100_functions_security.sql tests/db.test.ts
git commit -m "feat: RLS, grants and SQL functions for search, quota and billing"
```

---

### Task 5: Isolation attack test (direct Supabase)

This mirrors the grader's script: *"signed in as one company, our script tries to read and change the other company's shortlists and saved searches through your API and directly through Supabase with that recruiter's token."* Each API route task (8, 11, 12) adds its own cross-company API checks.

**Files:**
- Create: `tests/isolation.test.ts`

**Interfaces:**
- Consumes: Task 4's schema and functions; helpers.

- [ ] **Step 1: Write the test**

```ts
import { beforeAll, describe, expect, it } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { COMPANY, admin, asUser, signIn } from './helpers';

let acme: ReturnType<typeof asUser>;
let globexList: string, globexSaved: string, globexSearch: string, acmeReady: string;

beforeAll(async () => {
  const db = admin();
  await db.from('shortlists').delete().in('company_id', [COMPANY.acme, COMPANY.globex]);
  await db.from('saved_briefs').delete().in('company_id', [COMPANY.acme, COMPANY.globex]);
  await db.from('companies').update({ plan: 'free', searches_used: 0 }).in('id', [COMPANY.acme, COMPANY.globex]);

  globexList = (await db.from('shortlists').insert({ company_id: COMPANY.globex, name: 'Globex secret list' }).select('id').single()).data!.id;
  await db.from('shortlist_members').insert({ shortlist_id: globexList, company_id: COMPANY.globex, candidate_id: 'cand_0001' });
  globexSaved = (await db.from('saved_briefs').insert({ company_id: COMPANY.globex, brief: 'globex brief', filters: { roles: ['Recruiter'] } }).select('id').single()).data!.id;
  globexSearch = (await db.from('searches').insert({ company_id: COMPANY.globex, brief: 'g', status: 'pending' }).select('id').single()).data!.id;

  const token = await signIn('acme');
  acme = asUser(token);
  acmeReady = (await acme.rpc('reserve_search', { p_brief: 'mine' })).data;
  await acme.rpc('complete_search', { p_search: acmeReady, p_filters: { roles: ['Recruiter'] } });
});

describe('acme cannot read globex data directly through Supabase', () => {
  it.each(['shortlists', 'shortlist_members', 'saved_briefs', 'searches', 'companies', 'recruiters'])('%s shows no globex rows', async (table) => {
    const { data } = await acme.from(table).select('*');
    expect(JSON.stringify(data ?? [])).not.toContain(COMPANY.globex);
  });

  it.each(['subscriptions', 'billing_events'])('%s is not readable at all', async (table) => {
    expect((await acme.from(table).select('*')).error?.code).toBe('42501');
  });
});

// Every table x insert/update/delete, aimed at globex's rows (and at moving acme's recruiter into globex).
// [table, row to plant, patch, filter column, filter value]
const attacks = (): [string, Record<string, unknown>, Record<string, unknown>, string, string][] => [
  ['companies', { id: crypto.randomUUID(), slug: 'acme', name: 'x' }, { plan: 'paid', searches_used: 0 }, 'id', COMPANY.globex],
  ['recruiters', { user_id: crypto.randomUUID(), company_id: COMPANY.globex }, { company_id: COMPANY.globex }, 'company_id', COMPANY.acme],
  ['candidates', { id: 'cand_9999' }, { full_name: 'pwned' }, 'id', 'cand_0001'],
  ['searches', { company_id: COMPANY.globex, brief: 'x', status: 'ready', filters: {} }, { status: 'refunded' }, 'company_id', COMPANY.globex],
  ['shortlists', { company_id: COMPANY.globex, name: 'planted' }, { name: 'pwned' }, 'company_id', COMPANY.globex],
  ['shortlist_members', { shortlist_id: globexList, company_id: COMPANY.globex, candidate_id: 'cand_0003' }, { candidate_id: 'cand_0004' }, 'company_id', COMPANY.globex],
  ['saved_briefs', { company_id: COMPANY.globex, brief: 'planted', filters: {} }, { brief: 'pwned' }, 'company_id', COMPANY.globex],
  ['subscriptions', { stripe_subscription_id: 'x', company_id: COMPANY.globex, status: 'active', last_event_created: 1, last_event_type: 'x' }, { status: 'active' }, 'company_id', COMPANY.globex],
  ['billing_events', { event_id: 'planted' }, { event_id: 'pwned' }, 'event_id', 'planted'],
];

// Everything a recruiter could damage, read with the service key (candidates: count + one row; 5,000 rows are too many to compare).
const ORDER: Record<string, string> = { recruiters: 'user_id', billing_events: 'event_id', subscriptions: 'stripe_subscription_id', shortlist_members: 'candidate_id' };
const snapshot = async () => {
  const db = admin();
  const out: Record<string, unknown> = {};
  for (const t of ['companies', 'recruiters', 'searches', 'shortlists', 'shortlist_members', 'saved_briefs', 'subscriptions', 'billing_events']) {
    out[t] = (await db.from(t).select('*').order(ORDER[t] ?? 'id')).data;
  }
  out.candidates = [
    (await db.from('candidates').select('id', { count: 'exact', head: true })).count,
    (await db.from('candidates').select('full_name').eq('id', 'cand_0001').single()).data,
  ];
  return out;
};

describe('acme cannot change anything it does not own, directly through Supabase', () => {
  it('every insert is refused with permission denied, and no update or delete changes a row', async () => {
    const before = await snapshot();
    for (const [table, row, patch, col, val] of attacks()) {
      expect((await acme.from(table).insert(row)).error?.code, `${table} insert`).toBe('42501');
      await acme.from(table).update(patch).eq(col, val);
      await acme.from(table).delete().eq(col, val);
    }
    // Planting a member on globex's list while claiming to be acme: blocked by the composite key.
    expect((await acme.from('shortlist_members').insert({ shortlist_id: globexList, company_id: COMPANY.acme, candidate_id: 'cand_0002' })).error).toBeTruthy();
    await acme.rpc('complete_search', { p_search: globexSearch, p_filters: {} });
    await acme.rpc('refund_search', { p_search: globexSearch });
    expect(await snapshot()).toEqual(before);
  });

  it('cannot search or read candidates directly (no way round the free plan)', async () => {
    expect((await acme.rpc('search_candidates', { f: { roles: ['Recruiter'] }, lim: 20, off: 0 })).error?.code).toBe('42501');
    expect((await acme.from('candidates').select('id').eq('role', 'Recruiter')).error?.code).toBe('42501');
  });

  it('acme is still acme (cannot move its recruiter into globex)', async () => {
    expect((await acme.rpc('current_company_id')).data).toBe(COMPANY.acme);
  });

  it('cannot branch a correction off a finished globex search', async () => {
    const ready = (await admin().from('searches').insert({ company_id: COMPANY.globex, brief: 'g', status: 'ready', filters: { roles: ['Recruiter'] } }).select('id').single()).data!.id;
    expect((await acme.rpc('create_correction', { p_parent: ready, p_filters: { roles: ['Recruiter'] } })).data).toEqual({ error: 'not_found' });
  });
});

describe('acme cannot cheat its own plan or quota', () => {
  it('cannot set its plan, reset its counter, insert searches, or refund a finished search', async () => {
    await acme.from('companies').update({ plan: 'paid', searches_used: 0 }).eq('id', COMPANY.acme);
    const acmeSearches = async () => (await admin().from('searches').select('id', { count: 'exact', head: true }).eq('company_id', COMPANY.acme)).count;
    const searchesBefore = await acmeSearches();
    expect((await acme.from('searches').insert({ company_id: COMPANY.acme, brief: 'x', status: 'ready', filters: {} })).error?.code).toBe('42501');
    expect((await acme.rpc('refund_search', { p_search: acmeReady })).data).toBe(false);
    expect(await acmeSearches()).toBe(searchesBefore);
    const { data } = await admin().from('companies').select('plan, searches_used').eq('id', COMPANY.acme).single();
    expect(data).toEqual({ plan: 'free', searches_used: 1 });
    const { error } = await acme.from('subscriptions').insert({ stripe_subscription_id: 'x', company_id: COMPANY.acme, status: 'active', last_event_created: 1, last_event_type: 'x' });
    expect(error?.code).toBe('42501');
  });
});

describe('signed-out visitors get nothing', () => {
  // Exactly what a signed-out browser has: the publishable key and no session.
  const anon = () => createClient(process.env.SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, { auth: { persistSession: false } });

  it.each(['candidates', 'companies', 'recruiters', 'searches', 'shortlists', 'shortlist_members', 'saved_briefs', 'subscriptions', 'billing_events'])('%s', async (table) => {
    expect((await anon().from(table).select('*').limit(1)).error?.code).toBe('42501');
  });

  it('cannot call the search or quota functions', async () => {
    expect((await anon().rpc('search_candidates', { f: { roles: ['Recruiter'] }, lim: 20, off: 0 })).error?.code).toBe('42501');
    expect((await anon().rpc('reserve_search', { p_brief: 'x' })).error?.code).toBe('42501');
  });
});
```

Every assertion checks for `42501` (permission denied), not just "an error": a typo in a function name or argument is also an error and must not count as a pass.

- [ ] **Step 2: Run it**

Run: `npm test -- tests/isolation.test.ts`
Expected: PASS. **Any failure here is a release blocker** (the security score is all or nothing): fix the migration, never the test.

- [ ] **Step 3: Commit**

```bash
git add tests/isolation.test.ts
git commit -m "test: direct-Supabase isolation attack suite"
```

---

## Requirements check (plan review, 2026-10-07)

An independent reviewer checked this phase against TECH_REQUIREMENTS, SCORING, SPEC, ARCHITECTURE and DESIGN. I verified each finding against those docs before accepting or rejecting it.

| Requirement | Where in this phase | Proof |
|---|---|---|
| B1 / SCORING §6: the free plan can't be skipped by querying Supabase directly | no candidate grant or policy; `search_candidates` for service_role only | isolation "cannot search or read candidates directly" (`42501`) |
| X1 / SEC-1: companies can't see or change each other's data, through Supabase directly | RLS policies, revoked grants, composite key on list members | `tests/isolation.test.ts`: every table × insert/update/delete, each refused with `42501`, full before/after snapshot |
| SEC-2 / OQ-8: a recruiter can't change their own plan, quota or company | no write grants on `companies`, `recruiters`, `searches`; definer functions only | isolation "cheat" test; "acme is still acme" test |
| F6 / FR-8.3: exactly one free search, even under a burst | one conditional `UPDATE` in `reserve_search` | `db.test.ts`: 20 concurrent → 1 |
| FR-8.4: refunds can't be abused | refund only while `pending` | `db.test.ts`, isolation test |
| FR-4.5: corrections capped at 10 | `create_correction` | `db.test.ts` |
| FR-2.6: never "everyone" | `filters_have_conditions` in SQL (any `unsupported` blocks) | `db.test.ts` empty-filter cases |
| B2 / B3 / FR-9.4: dedup, ordering, same-second cancellation wins | `apply_billing_event` in one transaction, company row locked | `db.test.ts` billing case; Task 10 replay |
| P1: paging fast | filters read once (one-row CTE) so indexes work | Task 9 speed test |

**Changed after review:** tests assert `42501` (permission denied), not just "an error" (a typo would also be an error); the attack covers every table and verb, moving acme's recruiter into globex, and branching a correction off a finished globex search; search reads each filter once instead of once per candidate; billing locks the company row so concurrent events can't set the wrong plan, and recomputes both companies; default privileges revoked for future migrations; `unsupported` of any non-empty shape blocks the search; result cards include `headline` (NOTES search-flow row).

**Decided (user, 2026-10-07, Option A):** recruiters get no direct access to candidates. A free recruiter could otherwise call `search_candidates` or filter the `candidates` table through Supabase with their own token and get unlimited searches. Only the server reads candidates, using its own key and only after checking the recruiter (Tasks 8, 11, 12).

**Verdict:** ready to implement.
