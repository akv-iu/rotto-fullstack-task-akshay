import { afterEach, describe, expect, it, vi } from 'vitest';
import { getPlan, newSearch } from '@/lib/server/search';

const company = vi.fn();
const rpc = vi.fn();
const query = { select: () => query, eq: () => query, single: company };
const ctx = { companyId: 'test', db: { from: () => query, rpc } } as never;
afterEach(() => { vi.unstubAllEnvs(); company.mockReset(); rpc.mockReset(); });

describe('demo plan presentation', () => {
  it('shows the remaining allowance for today and resets an older day', async () => {
    company.mockResolvedValueOnce({ data: { is_demo: true, searches_used: 3, searches_day: new Date().toISOString().slice(0, 10) }, error: null })
      .mockResolvedValueOnce({ data: { is_demo: true, searches_used: 5, searches_day: '2000-01-01' }, error: null });
    expect(await getPlan(ctx)).toEqual({ plan: 'free', demo: true, searches_remaining: 2 });
    expect(await getPlan(ctx)).toEqual({ plan: 'free', demo: true, searches_remaining: 5 });
  });

  it('keeps the original recruiter quota unchanged', async () => {
    company.mockResolvedValue({ data: { plan: 'free', is_demo: false, searches_used: 1 }, error: null });
    expect(await getPlan(ctx)).toEqual({ plan: 'free', searches_remaining: 0 });
  });

  it('explains an exhausted demo allowance without requesting a paid upgrade or calling the AI', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key');
    rpc.mockResolvedValue({ data: null, error: null });
    company.mockResolvedValue({ data: { is_demo: true, searches_used: 5, searches_day: new Date().toISOString().slice(0, 10) }, error: null });
    await expect(newSearch(ctx, 'recruiters')).rejects.toMatchObject({ status: 429, message: expect.stringContaining('demo search allowance') });
    expect(rpc).toHaveBeenCalledExactlyOnceWith('reserve_search', { p_brief: 'recruiters' });
  });
});
