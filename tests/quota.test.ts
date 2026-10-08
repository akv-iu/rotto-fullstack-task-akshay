import { beforeEach, describe, expect, it } from 'vitest';
import { api, resetCompany, signIn } from './helpers';

const hasKey = Boolean(process.env.OPENAI_API_KEY);

beforeEach(() => resetCompany('globex'));

describe.runIf(hasKey)('free plan: exactly 1 search, even under a burst', () => {
  it('20 simultaneous searches → exactly one 200, nineteen 402; paging never uses it', async () => {
    const t = await signIn('globex');
    const all = await Promise.all(Array.from({ length: 20 }, () => api(t, 'POST', '/api/search', { brief: 'data scientists with a PhD' })));
    const codes = all.map((r) => r.status).sort();
    expect(codes.filter((c) => c === 200)).toHaveLength(1);
    expect(codes.filter((c) => c === 402)).toHaveLength(19);
    const ok = all.find((r) => r.status === 200)!;
    for (let page = 1; page <= 3; page++) {
      expect((await api(t, 'GET', `/api/search/${ok.body.search_id}?page=${page}`)).status).toBe(200);
    }
    expect((await api(t, 'GET', '/api/plan')).body).toEqual({ plan: 'free', searches_remaining: 0 });
  });
});
