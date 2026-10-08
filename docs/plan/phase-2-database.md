# Phase 2: Database and security

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
  - `search_candidates(f jsonb, lim int, off int) → jsonb { total: number, results: CandidateCard[] }` where `CandidateCard = { id, full_name, avatar_url, current_title, current_company, city, years_experience, open_to_work, skills }`
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

describe('search_candidates', () => {
  it('returns nobody when there are no real conditions (never everyone)', async () => {
    const t = await signIn('acme');
    for (const f of [{}, { min_years: 0 }, { max_years: 15 }, { roles: [] }, { open_to_work: false }]) {
      expect((await rpc(t, 'search_candidates', { f, lim: 20, off: 0 })).total).toBe(0);
    }
  });

  it('returns nobody when anything is unsupported', async () => {
    const t = await signIn('acme');
    const r = await rpc(t, 'search_candidates', { f: { roles: ['Product Manager'], unsupported: [{ text: 'speaks Japanese', reason: 'unsupported' }] }, lim: 20, off: 0 });
    expect(r.total).toBe(0);
  });

  it('matches exactly (data scientists with a PhD = 47)', async () => {
    const t = await signIn('acme');
    const r = await rpc(t, 'search_candidates', { f: { roles: ['Data Scientist'], degrees: ['PhD'] }, lim: 20, off: 0 });
    expect(r.total).toBe(47);
    expect(r.results).toHaveLength(20);
    expect(Object.keys(r.results[0]).sort()).toEqual(
      ['avatar_url', 'city', 'current_company', 'current_title', 'full_name', 'id', 'open_to_work', 'skills', 'years_experience'],
    );
  });

  it('pages through every result exactly once in a stable order', async () => {
    const t = await signIn('acme');
    const f = { roles: ['Mobile Engineer'], skills: ['Swift'] };
    const seen: string[] = [];
    for (let off = 0; off < 220; off += 20) {
      const r = await rpc(t, 'search_candidates', { f, lim: 20, off });
      seen.push(...r.results.map((c: { id: string }) => c.id));
    }
    expect(seen).toHaveLength(199);
    expect(new Set(seen).size).toBe(199);
    const past = await rpc(t, 'search_candidates', { f, lim: 20, off: 400 });
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
    expect(error).toBeTruthy();
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
  select public.f_arr(f, 'unsupported') is null and (
       public.f_arr(f, 'roles') is not null or public.f_arr(f, 'seniorities') is not null
    or public.f_arr(f, 'cities') is not null or public.f_arr(f, 'skills') is not null
    or public.f_arr(f, 'any_skills') is not null or public.f_arr(f, 'companies') is not null
    or public.f_arr(f, 'current_companies') is not null or public.f_arr(f, 'degrees') is not null
    or public.f_arr(f, 'fields') is not null or public.f_arr(f, 'schools') is not null
    or coalesce(public.f_num(f, 'min_years'), 0) > 0 or coalesce(public.f_num(f, 'max_years'), 15) < 15
    or f -> 'open_to_work' = 'true'::jsonb
    or public.f_txt(f, 'worked_at_company_type') is not null or public.f_txt(f, 'current_company_type') is not null)
$$;

-- ---------- search (runs as the caller: RLS applies) ----------
create function public.search_candidates(f jsonb, lim int, off int) returns jsonb
language sql stable security invoker set search_path = ''
as $$
  with m as (
    select c.id, c.full_name, c.avatar_url, c.current_title, c.current_company, c.city,
           c.years_experience, c.open_to_work, c.skills
    from public.candidates c
    where public.filters_have_conditions(f)
      and (public.f_arr(f, 'roles') is null or c.role = any (public.f_arr(f, 'roles')))
      and (public.f_arr(f, 'seniorities') is null or c.seniority = any (public.f_arr(f, 'seniorities')))
      and (public.f_arr(f, 'cities') is null or c.city = any (public.f_arr(f, 'cities')))
      and (public.f_arr(f, 'skills') is null or c.skills @> public.f_arr(f, 'skills'))
      and (public.f_arr(f, 'any_skills') is null or c.skills && public.f_arr(f, 'any_skills'))
      and (public.f_arr(f, 'companies') is null or c.companies && public.f_arr(f, 'companies'))
      and (public.f_arr(f, 'current_companies') is null or c.current_company = any (public.f_arr(f, 'current_companies')))
      and (public.f_arr(f, 'degrees') is null or c.degrees && public.f_arr(f, 'degrees'))
      and (public.f_arr(f, 'fields') is null or c.fields && public.f_arr(f, 'fields'))
      and (public.f_arr(f, 'schools') is null or c.schools && public.f_arr(f, 'schools'))
      and (public.f_num(f, 'min_years') is null or c.years_experience >= public.f_num(f, 'min_years'))
      and (public.f_num(f, 'max_years') is null or c.years_experience <= public.f_num(f, 'max_years'))
      and (f -> 'open_to_work' is distinct from 'true'::jsonb or c.open_to_work)
      and (public.f_txt(f, 'worked_at_company_type') is null or c.company_types @> array[public.f_txt(f, 'worked_at_company_type')])
      and (public.f_txt(f, 'current_company_type') is null or c.current_company_type = public.f_txt(f, 'current_company_type'))
  )
  select jsonb_build_object(
    'total', (select count(*) from m),
    'results', coalesce((
      select jsonb_agg(to_jsonb(p) order by p.open_to_work desc, p.years_experience desc, p.id)
      from (select * from m order by open_to_work desc, years_experience desc, id
            limit least(greatest(lim, 0), 100) offset greatest(off, 0)) p
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
   where c.id = cid;
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

create policy candidates_read on public.candidates for select to authenticated using (true);
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

grant select on public.candidates, public.companies, public.recruiters, public.searches to authenticated;
grant select, insert, delete on public.shortlists to authenticated;
grant update (name) on public.shortlists to authenticated;
grant select, insert, delete on public.shortlist_members, public.saved_briefs to authenticated;

grant execute on function
  public.current_company_id(), public.f_arr(jsonb, text), public.f_num(jsonb, text), public.f_txt(jsonb, text),
  public.filters_have_conditions(jsonb), public.search_candidates(jsonb, int, int),
  public.reserve_search(text), public.complete_search(uuid, jsonb), public.refund_search(uuid),
  public.create_correction(uuid, jsonb)
to authenticated;
grant execute on function public.apply_billing_event(text, bigint, text, text, text, text) to service_role;
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

const globexState = async () => {
  const db = admin();
  return {
    list: (await db.from('shortlists').select('name').eq('id', globexList).single()).data,
    members: (await db.from('shortlist_members').select('candidate_id').eq('shortlist_id', globexList)).data,
    saved: (await db.from('saved_briefs').select('brief').eq('id', globexSaved).single()).data,
    search: (await db.from('searches').select('status').eq('id', globexSearch).single()).data,
    company: (await db.from('companies').select('plan, searches_used').eq('id', COMPANY.globex).single()).data,
  };
};

describe('acme cannot read globex data directly through Supabase', () => {
  it.each(['shortlists', 'shortlist_members', 'saved_briefs', 'searches', 'companies', 'recruiters'])('%s shows no globex rows', async (table) => {
    const { data } = await acme.from(table).select('*');
    expect(JSON.stringify(data ?? [])).not.toContain(COMPANY.globex);
  });

  it.each(['subscriptions', 'billing_events'])('%s is not readable at all', async (table) => {
    const { data, error } = await acme.from(table).select('*');
    expect(error ?? (data?.length === 0 ? 'empty' : null)).toBeTruthy();
  });
});

describe('acme cannot change globex data directly through Supabase', () => {
  it('every write attempt leaves globex untouched', async () => {
    const before = await globexState();
    await acme.from('shortlists').update({ name: 'pwned' }).eq('id', globexList);
    await acme.from('shortlists').delete().eq('id', globexList);
    await acme.from('shortlists').insert({ company_id: COMPANY.globex, name: 'planted' });
    await acme.from('shortlist_members').insert({ shortlist_id: globexList, company_id: COMPANY.acme, candidate_id: 'cand_0002' });
    await acme.from('shortlist_members').insert({ shortlist_id: globexList, company_id: COMPANY.globex, candidate_id: 'cand_0003' });
    await acme.from('shortlist_members').delete().eq('shortlist_id', globexList);
    await acme.from('saved_briefs').update({ brief: 'pwned' }).eq('id', globexSaved);
    await acme.from('saved_briefs').delete().eq('id', globexSaved);
    await acme.from('saved_briefs').insert({ company_id: COMPANY.globex, brief: 'planted', filters: {} });
    await acme.from('searches').update({ status: 'refunded' }).eq('id', globexSearch);
    await acme.rpc('complete_search', { p_search: globexSearch, p_filters: {} });
    await acme.rpc('refund_search', { p_search: globexSearch });
    await acme.from('companies').update({ plan: 'paid', searches_used: 0 }).eq('id', COMPANY.globex);
    expect(await globexState()).toEqual(before);
    const { count } = await admin().from('shortlists').select('id', { count: 'exact', head: true }).eq('company_id', COMPANY.globex);
    expect(count).toBe(1);
  });
});

describe('acme cannot cheat its own plan or quota', () => {
  it('cannot set its plan, reset its counter, insert searches, or refund a finished search', async () => {
    await acme.from('companies').update({ plan: 'paid', searches_used: 0 }).eq('id', COMPANY.acme);
    await acme.from('searches').insert({ company_id: COMPANY.acme, brief: 'x', status: 'ready', filters: {} });
    expect((await acme.rpc('refund_search', { p_search: acmeReady })).data).toBe(false);
    const { data } = await admin().from('companies').select('plan, searches_used').eq('id', COMPANY.acme).single();
    expect(data).toEqual({ plan: 'free', searches_used: 1 });
    const { error } = await acme.from('subscriptions').insert({ stripe_subscription_id: 'x', company_id: COMPANY.acme, status: 'active', last_event_created: 1, last_event_type: 'x' });
    expect(error).toBeTruthy();
  });
});

describe('signed-out visitors get nothing', () => {
  it.each(['candidates', 'companies', 'recruiters', 'searches', 'shortlists', 'shortlist_members', 'saved_briefs', 'subscriptions', 'billing_events'])('%s', async (table) => {
    const anon = asUser(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!);
    const { data, error } = await anon.from(table).select('*').limit(1);
    expect(error ?? (data?.length === 0 ? 'empty' : null)).toBeTruthy();
  });

  it('cannot call the search or quota functions', async () => {
    const anon = asUser(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!);
    const { error } = await anon.rpc('search_candidates', { f: { roles: ['Recruiter'] }, lim: 20, off: 0 });
    expect(error).toBeTruthy();
    expect((await anon.rpc('reserve_search', { p_brief: 'x' })).error).toBeTruthy();
  });
});
```

Note: `asUser(<publishable key>)` sends the publishable key as the bearer, which is exactly what a signed-out browser sends.

- [ ] **Step 2: Run it**

Run: `npm test -- tests/isolation.test.ts`
Expected: PASS. **Any failure here is a release blocker** (the security score is all or nothing): fix the migration, never the test.

- [ ] **Step 3: Commit**

```bash
git add tests/isolation.test.ts
git commit -m "test: direct-Supabase isolation attack suite"
```
