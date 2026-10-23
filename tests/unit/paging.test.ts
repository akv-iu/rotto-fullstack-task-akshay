import { beforeEach, describe, expect, it, vi } from 'vitest';

const { adminRpc } = vi.hoisted(() => ({ adminRpc: vi.fn() }));
vi.mock('@/lib/server/supabase', () => ({ adminClient: () => ({ rpc: adminRpc }) }));
import { getPage } from '@/lib/server/search';

const read = vi.fn();
const db = { rpc: read } as never;
const ID = '11111111-1111-1111-1111-111111111111';
beforeEach(() => {
  read.mockReset(); adminRpc.mockReset();
  read.mockResolvedValue({ status: 200, data: { filters: { roles: ['Recruiter'] } }, error: null });
  adminRpc.mockResolvedValue({ data: { total: 25, results: [] }, error: null });
});

describe('paging with one combined recruiter/search lookup', () => {
  it('makes two database calls and keeps the page size, offset, and response contract', async () => {
    expect(await getPage(db, ID, '2')).toEqual({ search_id: ID, page: 2, filters: { roles: ['Recruiter'] }, total: 25, results: [] });
    expect(read).toHaveBeenCalledExactlyOnceWith('read_search', { p_search: ID });
    expect(adminRpc).toHaveBeenCalledExactlyOnceWith('search_candidates', { f: { roles: ['Recruiter'] }, lim: 20, off: 20 });
  });

  it('defaults to page one and revalidates stored filters before querying candidates', async () => {
    read.mockResolvedValue({ status: 200, data: { filters: { cities: ['Atlantis'] } }, error: null });
    expect(await getPage(db, ID, null)).toMatchObject({ page: 1, total: 0, results: [], filters: { unsupported: [{ text: 'Atlantis', reason: 'unsupported' }] } });
    expect(adminRpc).not.toHaveBeenCalled();
  });

  it.each(['0', '-1', '1.5', '10001', 'abc'])('rejects page %s before any database calls', async (page) => {
    await expect(getPage(db, ID, page)).rejects.toMatchObject({ status: 400 });
    expect(read).not.toHaveBeenCalled(); expect(adminRpc).not.toHaveBeenCalled();
  });

  it.each([
    [{ status: 401, data: null, error: { message: 'invalid JWT' } }, 401],
    [{ status: 403, data: null, error: { message: 'permission denied' } }, 401],
    [{ status: 200, data: { error: 'unauthorized' }, error: null }, 401],
    [{ status: 200, data: null, error: null }, 404],
  ])('never reads candidates without a ready search owned by a recruiter', async (response, status) => {
    read.mockResolvedValue(response);
    await expect(getPage(db, ID, '1')).rejects.toMatchObject({ status });
    expect(adminRpc).not.toHaveBeenCalled();
  });

  it('keeps database outages as server errors rather than signing the recruiter out', async () => {
    read.mockResolvedValue({ status: 500, data: null, error: { message: 'database unavailable' } });
    await expect(getPage(db, ID, '1')).rejects.toThrow('database unavailable');
    expect(adminRpc).not.toHaveBeenCalled();
  });
});
