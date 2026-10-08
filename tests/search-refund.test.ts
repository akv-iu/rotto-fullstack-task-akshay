import { afterEach, describe, expect, it, vi } from 'vitest';
import { newSearch } from '@/lib/server/search';
import { COMPANY, admin, asUser, resetCompany, signIn } from './helpers';

// Only the call to OpenAI fails; the database calls stay real, so this proves the search is given back end to end.
const realFetch = globalThis.fetch;
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('a failed AI call never uses up the free search', () => {
  it('times out → 502 "not counted", the search is refunded and can be used again', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key');
    vi.stubGlobal('fetch', vi.fn((url: string | URL | Request, init?: RequestInit) =>
      String(url).startsWith('https://api.openai.com/')
        ? Promise.reject(new DOMException('timed out', 'TimeoutError'))
        : realFetch(url, init)));
    await resetCompany('acme');
    const ctx = { db: asUser(await signIn('acme')), companyId: COMPANY.acme };

    await expect(newSearch(ctx, 'data scientists with a PhD')).rejects.toMatchObject({ status: 502 });

    const db = admin();
    expect((await db.from('companies').select('searches_used').eq('id', COMPANY.acme).single()).data).toEqual({ searches_used: 0 });
    const last = (await db.from('searches').select('status').eq('company_id', COMPANY.acme).order('created_at', { ascending: false }).limit(1).single()).data;
    expect(last).toEqual({ status: 'refunded' });
  });
});
