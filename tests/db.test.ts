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
    for (const f of [{}, { min_years: 0 }, { max_years: 15 }, { roles: [] }, { open_to_work: 'yes' }]) {
      expect((await search({ f, lim: 20, off: 0 })).total).toBe(0);
    }
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
