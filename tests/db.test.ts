import { beforeEach, describe, expect, it } from 'vitest';
import { VOCAB } from '@/lib/shared/vocab';
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
    for (const f of [{}, { min_years: 0 }, { max_years: 15 }, { roles: [] }, { open_to_work: 'yes' }]) {
      expect((await search({ f, lim: 20, off: 0 })).total).toBe(0);
    }
  });

  it('returns nobody for filters that match every candidate, however they get past the app (the last line of defence)', async () => {
    const everyCity = [...VOCAB.cities];
    for (const f of [{ cities: everyCity }, { seniorities: ['junior', 'mid', 'senior', 'staff'] }]) {
      expect((await search({ f, lim: 20, off: 0 })).total).toBe(0);
    }
    expect((await search({ f: { cities: everyCity.slice(1) }, lim: 1, off: 0 })).total).toBeGreaterThan(0); // 9 of 10 cities still narrows
  });

  it('returns nobody when anything is unsupported', async () => {
    const r = await search({ f: { roles: ['Product Manager'], unsupported: [{ text: 'speaks Japanese', reason: 'unsupported' }] }, lim: 20, off: 0 });
    expect(r.total).toBe(0);
  });

  it('open_to_work true and false split a group exactly ("not open to work" is a real filter)', async () => {
    const total = async (f: object) => (await search({ f, lim: 1, off: 0 })).total as number;
    const [all, open, notOpen] = await Promise.all([
      total({ seniorities: ['staff'] }), total({ seniorities: ['staff'], open_to_work: true }), total({ seniorities: ['staff'], open_to_work: false }),
    ]);
    expect(open).toBeGreaterThan(0);
    expect(notOpen).toBeGreaterThan(0);
    expect(open + notOpen).toBe(all);
    expect(await total({ open_to_work: false })).toBe(3490); // 5,000 candidates, 1,510 open to work
  });

  it('exclusions match exactly, counted straight from the data (engineers without Java = 2,761; never at a startup = 959)', async () => {
    const total = async (f: object) => (await search({ f, lim: 1, off: 0 })).total as number;
    const engineers = VOCAB.roles.filter((r) => r.endsWith('Engineer'));
    const data: { skills: string[]; companies: string[]; company_types: string[] }[] = [];
    for (let from = 0; ; from += 1000) { // the API returns at most 1,000 rows at a time
      const page = (await admin().from('candidates').select('skills, companies, company_types').in('role', engineers).order('id').range(from, from + 999)).data!;
      data.push(...page);
      if (page.length < 1000) break;
    }
    expect(data.length).toBe(await total({ roles: engineers }));
    const count = (keep: (c: { skills: string[]; companies: string[]; company_types: string[] }) => boolean) => data.filter(keep).length;
    expect(await total({ roles: engineers, not_skills: ['Java'] })).toBe(count((c) => !c.skills.includes('Java')));
    expect(await total({ roles: engineers, not_skills: ['Java'] })).toBe(2761);
    expect(await total({ roles: engineers, never_company_type: 'startup' })).toBe(959);
    expect(await total({ roles: engineers, not_companies: ['Saltbox', 'Mintleaf'] }))
      .toBe(count((c) => !c.companies.includes('Saltbox') && !c.companies.includes('Mintleaf')));
    expect(await total({ not_skills: ['Java'] })).toBeGreaterThan(0); // an exclusion alone is a real condition
  });

  it('"worked at all of" and excluded roles match exactly (counted from the data)', async () => {
    const total = async (f: object) => (await search({ f, lim: 1, off: 0 })).total as number;
    const engineers = VOCAB.roles.filter((r) => r.endsWith('Engineer'));
    expect(await total({ all_companies: ['Fernway', 'Saltbox'] })).toBe(9); // both, not either (590)
    expect(await total({ companies: ['Fernway', 'Saltbox'] })).toBe(590); // "either" still works
    expect(await total({ cities: ['Boston'], not_roles: engineers })).toBe(152);
    expect(await total({ seniorities: ['senior'], skills: ['React'], not_roles: ['Frontend Engineer'] })).toBe(68);
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

  it('create_correction has no cap on the paid plan (the cap only stops free corrections replacing new searches)', async () => {
    const t = await signIn('acme');
    await admin().from('companies').update({ plan: 'paid' }).eq('id', COMPANY.acme);
    const root = await rpc(t, 'reserve_search', { p_brief: 'x' });
    await rpc(t, 'complete_search', { p_search: root, p_filters: { roles: ['Recruiter'] } });
    for (let i = 0; i < 15; i++) expect((await rpc(t, 'create_correction', { p_parent: root, p_filters: { roles: ['Recruiter'] } })).id).toBeTruthy();
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

  it('counts a trialing subscription as paid, and incomplete or past_due as free (SPEC OQ-3)', async () => {
    expect(await apply('t1', 100, 'customer.subscription.created', 'trialing')).toBe('applied');
    expect(await plan()).toBe('paid');
    expect(await apply('t2', 101, 'customer.subscription.updated', 'past_due')).toBe('applied');
    expect(await plan()).toBe('free');
    expect(await apply('t3', 102, 'customer.subscription.updated', 'incomplete')).toBe('applied');
    expect(await plan()).toBe('free');
  });

  it('events for both companies at the same moment all apply (no deadlock between the two company rows)', async () => {
    await resetCompany('globex');
    try {
      const results = await Promise.all(Array.from({ length: 40 }, (_, i) => admin().rpc('apply_billing_event', {
        p_event_id: `race_${i}`, p_created: 1000 + i, p_type: 'customer.subscription.updated',
        p_subscription: `sub_race_${i % 2 ? 'acme' : 'globex'}`, p_company: i % 2 ? 'acme' : 'globex', p_status: 'active',
      })));
      expect(results.map((r) => r.error?.message ?? 'ok')).toEqual(Array(40).fill('ok'));
      expect(results.every((r) => r.data === 'applied' || r.data === 'stale')).toBe(true);
      const plans = (await admin().from('companies').select('slug, plan').order('slug')).data;
      expect(plans).toEqual([{ slug: 'acme', plan: 'paid' }, { slug: 'globex', plan: 'paid' }]);
    } finally {
      await resetCompany('globex');
    }
  });

  it('cannot be called by a recruiter', async () => {
    const { error } = await asUser(await signIn('acme')).rpc('apply_billing_event', {
      p_event_id: 'x', p_created: 1, p_type: 'customer.subscription.created', p_subscription: 's', p_company: 'acme', p_status: 'active',
    });
    expect(error?.code).toBe('42501'); // permission denied, not just "some error"
  });
});
