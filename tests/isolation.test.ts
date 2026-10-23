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
    const { data, error } = await acme.from(table).select('*');
    expect(error).toBeNull(); // an error would make "no globex rows" true for the wrong reason
    expect(JSON.stringify(data)).not.toContain(COMPANY.globex);
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
    // Planting a member on globex's list while claiming to be acme: blocked by the composite key, even with the
    // server's key (recruiters can't insert at all, so this is the server-side guarantee). 23503 = foreign key violation.
    expect((await admin().from('shortlist_members').insert({ shortlist_id: globexList, company_id: COMPANY.acme, candidate_id: 'cand_0002' })).error?.code).toBe('23503');
    await acme.rpc('complete_search', { p_search: globexSearch, p_filters: {} });
    await acme.rpc('refund_search', { p_search: globexSearch, p_company: COMPANY.globex });
    expect(await snapshot()).toEqual(before);
  });

  it('cannot search or read candidates directly (no way round the free plan)', async () => {
    expect((await acme.rpc('search_candidates', { f: { roles: ['Recruiter'] }, lim: 20, off: 0 })).error?.code).toBe('42501');
    expect((await acme.from('candidates').select('id').eq('role', 'Recruiter')).error?.code).toBe('42501');
  });

  it('acme is still acme (cannot move its recruiter into globex)', async () => {
    expect((await acme.rpc('current_company_id')).data).toBe(COMPANY.acme);
  });

  it('the paging lookup exposes only a ready search owned by the recruiter', async () => {
    const own = await acme.rpc('read_search', { p_search: acmeReady });
    expect(own.error).toBeNull();
    expect(own.data).toEqual({ filters: { roles: ['Recruiter'] } });
    const foreignId = (await admin().from('searches').insert({ company_id: COMPANY.globex, brief: 'foreign', status: 'ready', filters: { roles: ['Recruiter'] } }).select('id').single()).data!.id;
    const foreign = await acme.rpc('read_search', { p_search: foreignId });
    expect(foreign.error).toBeNull();
    expect(foreign.data).toBeNull();
    const id = (await admin().from('searches').insert({ company_id: COMPANY.acme, brief: 'pending', status: 'pending' }).select('id').single()).data!.id;
    const unfinished = await acme.rpc('read_search', { p_search: id });
    expect(unfinished.error).toBeNull();
    expect(unfinished.data).toBeNull();
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
    expect((await acme.rpc('refund_search', { p_search: acmeReady, p_company: COMPANY.acme })).error?.code).toBe('42501');
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
    expect((await anon().rpc('read_search', { p_search: acmeReady })).error?.code).toBe('42501');
  });
});
