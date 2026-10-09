import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The database is faked here so failures that are hard to cause on a real one (a failed page query, a failed refund)
// can be tested. `adminRpc` answers the server-key calls, `userRpc` the recruiter's.
const adminRpc = vi.fn();
vi.mock('@/lib/server/supabase', () => ({ adminClient: () => ({ rpc: adminRpc }) }));
const { correctSearch, newSearch } = await import('@/lib/server/search');

const userRpc = vi.fn();
// A working plan read (free plan, nothing used), so only the failure under test can stop a request.
const plan = { select: () => plan, eq: () => plan, single: async () => ({ data: { plan: 'free', searches_used: 0 }, error: null }) };
const ctx = { companyId: 'c0000000-0000-0000-0000-000000000001', db: { rpc: userRpc, from: () => plan } } as never;
const PARENT = '11111111-1111-1111-1111-111111111111';

beforeEach(() => { adminRpc.mockReset(); userRpc.mockReset(); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('a failed refine uses none of the 10 edits', () => {
  it('loads the results before recording the edit, so a failed page query records nothing', async () => {
    adminRpc.mockResolvedValue({ data: null, error: { message: 'statement timeout' } });
    await expect(correctSearch(ctx, PARENT, { roles: ['Recruiter'] })).rejects.toThrow('statement timeout');
    expect(userRpc).not.toHaveBeenCalledWith('create_correction', expect.anything());
  });

  it('a successful refine records the edit and returns its results', async () => {
    adminRpc.mockResolvedValue({ data: { total: 1, results: [] }, error: null });
    userRpc.mockResolvedValue({ data: { id: 'child-1' }, error: null });
    expect(await correctSearch(ctx, PARENT, { roles: ['Recruiter'] })).toMatchObject({ search_id: 'child-1', total: 1, searches_remaining: 1 });
    expect(userRpc).toHaveBeenCalledWith('create_correction', { p_parent: PARENT, p_filters: { roles: ['Recruiter'] } });
  });
});

describe('the "not counted" promise is only made when the refund applied', () => {
  beforeEach(() => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key');
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('network down'); })); // the AI call fails
    userRpc.mockImplementation(async (fn: string) => (fn === 'reserve_search' ? { data: 'search-1', error: null } : { data: null, error: null }));
  });

  it('refund applied: "It wasn\'t counted"', async () => {
    adminRpc.mockResolvedValue({ data: true, error: null });
    await expect(newSearch(ctx, 'recruiters')).rejects.toThrow(/wasn't counted/);
    expect(adminRpc).toHaveBeenCalledWith('refund_search', { p_search: 'search-1', p_company: 'c0000000-0000-0000-0000-000000000001' });
  });

  it('refund failed: no promise it wasn\'t counted', async () => {
    adminRpc.mockResolvedValue({ data: null, error: { message: 'connection lost' } });
    const err = await newSearch(ctx, 'recruiters').catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).not.toMatch(/wasn't counted/);
  });
});
