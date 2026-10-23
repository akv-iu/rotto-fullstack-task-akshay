import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { getSession, signOut } = vi.hoisted(() => ({ getSession: vi.fn(), signOut: vi.fn() }));
vi.mock('@/lib/client/supabase', () => ({ supabase: { auth: { getSession, signOut } } }));
import { api } from '@/lib/client/api';

beforeEach(() => {
  getSession.mockResolvedValue({ data: { session: { access_token: 'token' } } });
  signOut.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

describe('API errors shown to recruiters', () => {
  it.each([
    [500, { error: 'Internal server error' }],
    [502, { error: 'Bad Gateway' }],
    [503, { error: 'Service Unavailable' }],
    [504, { error: 'Gateway Timeout' }],
    [500, { error: { message: 'SQL details' } }],
    [500, { error: '  ' }],
  ])('replaces a raw %i failure with a friendly message', async (status, body) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(body, { status })));
    await expect(api('/api/search')).rejects.toMatchObject({ status, message: 'Something went wrong. Please try again in a moment.' });
  });

  it('handles a non-JSON server failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<h1>Internal Server Error</h1>', { status: 500 })));
    await expect(api('/api/search')).rejects.toMatchObject({ status: 500, message: expect.stringContaining('Please try again') });
  });

  it('preserves actionable failures, including confirmed search refunds', async () => {
    const message = "The search didn't go through. It wasn't counted against your plan. Please try again.";
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ error: message }, { status: 502 })));
    await expect(api('/api/search')).rejects.toMatchObject({ status: 502, message });
  });

  it('handles network failures and expired sessions', async () => {
    const fetch = vi.fn().mockRejectedValueOnce(new TypeError('offline'))
      .mockResolvedValueOnce(Response.json({ error: 'Sign in to continue.' }, { status: 401 }));
    vi.stubGlobal('fetch', fetch);
    await expect(api('/api/search')).rejects.toMatchObject({ status: 0, message: expect.stringContaining('Check your connection') });
    await expect(api('/api/search')).rejects.toMatchObject({ status: 401 });
    expect(signOut).toHaveBeenCalledOnce();
  });
});
