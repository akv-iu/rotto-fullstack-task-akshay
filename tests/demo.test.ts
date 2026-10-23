import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getPlan } from '@/lib/server/search';
import { admin, asUser } from './helpers';

type Visitor = { token: string; userId: string; companyId: string };
const visitors: Visitor[] = [];
const today = () => new Date().toISOString().slice(0, 10);
let previousUsage: { day: string; attempts: number } | null = null;

beforeAll(async () => {
  if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(process.env.SUPABASE_URL!).hostname)) throw new Error('Demo quota tests must use the local database.');
  const previous = await admin().from('demo_daily_usage').select('*').eq('day', today()).maybeSingle();
  if (previous.error) throw previous.error;
  previousUsage = previous.data;
  for (let i = 0; i < 2; i++) {
    const client = createClient(process.env.SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, { auth: { persistSession: false } });
    const { data, error } = await client.auth.signInAnonymously();
    if (error || !data.session || !data.user) throw error ?? new Error('No anonymous session');
    const company = await client.rpc('current_company_id');
    if (company.error || !company.data) throw company.error ?? new Error('No demo workspace');
    visitors.push({ token: data.session.access_token, userId: data.user.id, companyId: company.data });
  }
});

beforeEach(async () => {
  const ids = visitors.map((v) => v.companyId);
  await admin().from('searches').delete().in('company_id', ids);
  await admin().from('companies').update({ searches_used: 0, searches_day: today() }).in('id', ids);
  const usage = await admin().from('demo_daily_usage').upsert({ day: today(), attempts: 1 });
  if (usage.error) throw usage.error;
});

afterAll(async () => {
  if (!visitors.length) return;
  const ids = visitors.map((v) => v.companyId);
  await admin().from('shortlists').delete().in('company_id', ids);
  await admin().from('saved_briefs').delete().in('company_id', ids);
  await admin().from('searches').delete().in('company_id', ids);
  for (const v of visitors) await admin().auth.admin.deleteUser(v.userId);
  await admin().from('companies').delete().in('id', ids);
  if (previousUsage) await admin().from('demo_daily_usage').upsert(previousUsage);
  else await admin().from('demo_daily_usage').delete().eq('day', today());
});

describe('public demo isolation and spending limits', () => {
  it('creates separate private workspaces and keeps shared quota data inaccessible', async () => {
    const [a, b] = visitors;
    expect(a.companyId).not.toBe(b.companyId);
    const own = await asUser(a.token).from('companies').select('id, is_demo');
    expect(own.error).toBeNull();
    expect(own.data).toEqual([{ id: a.companyId, is_demo: true }]);
    const shortlist = await asUser(a.token).from('shortlists').insert({ company_id: a.companyId, name: 'Private demo list' }).select('id').single();
    expect(shortlist.error).toBeNull();
    const foreign = await asUser(b.token).from('shortlists').select('id').eq('id', shortlist.data!.id);
    expect(foreign.error).toBeNull();
    expect(foreign.data).toEqual([]);
    expect((await asUser(a.token).from('demo_daily_usage').select('*')).error?.code).toBe('42501');
    expect((await asUser(a.token).from('companies').update({ is_demo: false, plan: 'paid' }).eq('id', a.companyId)).error?.code).toBe('42501');
  });

  it('permits exactly five reservations under a concurrent burst', async () => {
    const a = visitors[0];
    const all = await Promise.all(Array.from({ length: 20 }, () => asUser(a.token).rpc('reserve_search', { p_brief: 'recruiters' })));
    expect(all.every((r) => !r.error)).toBe(true);
    expect(all.filter((r) => r.data)).toHaveLength(5);
    expect(all.filter((r) => r.data === null)).toHaveLength(15);
    expect(await getPlan({ db: asUser(a.token), companyId: a.companyId })).toEqual({ plan: 'free', demo: true, searches_remaining: 0 });
  });

  it('enforces the shared daily cap atomically across different visitors', async () => {
    await admin().from('demo_daily_usage').update({ attempts: 99 }).eq('day', today());
    const all = await Promise.all(Array.from({ length: 12 }, (_, i) => asUser(visitors[i % 2].token).rpc('reserve_search', { p_brief: 'recruiters' })));
    expect(all.every((r) => !r.error)).toBe(true);
    expect(all.filter((r) => r.data)).toHaveLength(1);
    expect((await admin().from('demo_daily_usage').select('attempts').eq('day', today()).single()).data).toEqual({ attempts: 100 });
  });

  it('refunds a failed search to its visitor without refunding the shared attempt cap', async () => {
    const a = visitors[0];
    const reserved = await asUser(a.token).rpc('reserve_search', { p_brief: 'recruiters' });
    expect(reserved.error).toBeNull();
    const refund = await admin().rpc('refund_search', { p_search: reserved.data, p_company: a.companyId });
    expect(refund.error).toBeNull();
    expect(refund.data).toBe(true);
    expect((await getPlan({ db: asUser(a.token), companyId: a.companyId })).searches_remaining).toBe(5);
    expect((await admin().from('demo_daily_usage').select('attempts').eq('day', today()).single()).data).toEqual({ attempts: 2 });
  });

  it('resets a visitor on a new day and never refunds an old search into the new allowance', async () => {
    const a = visitors[0];
    await admin().from('companies').update({ searches_used: 5, searches_day: '2000-01-01' }).eq('id', a.companyId);
    expect((await getPlan({ db: asUser(a.token), companyId: a.companyId })).searches_remaining).toBe(5);
    const old = await admin().from('searches').insert({ company_id: a.companyId, brief: 'old test search', status: 'pending', created_at: '2000-01-01T00:00:00Z' }).select('id').single();
    expect(old.error).toBeNull();
    expect((await asUser(a.token).rpc('reserve_search', { p_brief: 'recruiters' })).data).toBeTruthy();
    expect((await admin().rpc('refund_search', { p_search: old.data!.id, p_company: a.companyId })).data).toBe(true);
    expect((await getPlan({ db: asUser(a.token), companyId: a.companyId })).searches_remaining).toBe(4);
  });
});
