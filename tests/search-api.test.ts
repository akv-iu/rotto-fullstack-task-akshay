import { beforeEach, describe, expect, it } from 'vitest';
import { COMPANY, admin, api, asUser, resetCompany, signIn } from './helpers';

const hasKey = Boolean(process.env.OPENAI_API_KEY);

/** A finished search created without the AI, so these tests run with or without a key. */
async function readySearch(token: string, filters: object) {
  const db = asUser(token);
  const id = (await db.rpc('reserve_search', { p_brief: 'data scientists with a PhD' })).data;
  await db.rpc('complete_search', { p_search: id, p_filters: filters });
  return id as string;
}

beforeEach(async () => { await resetCompany('acme'); await resetCompany('globex'); });

describe('POST /api/search', () => {
  it('401 without a token, 400 for a bad brief or body', async () => {
    expect((await api(null, 'POST', '/api/search', { brief: 'x' })).status).toBe(401);
    const t = await signIn('acme');
    expect((await api(t, 'POST', '/api/search', { brief: '   ' })).status).toBe(400);
    expect((await api(t, 'POST', '/api/search', { brief: 'x'.repeat(501) })).status).toBe(400);
    expect((await api(t, 'POST', '/api/search', { nothing: true })).status).toBe(400);
    expect((await api(t, 'POST', '/api/search', ['brief'])).status).toBe(400);
    expect((await api(t, 'POST', '/api/search', { brief: 'x', filters: {} })).status).toBe(400); // two modes at once
    expect((await api(t, 'POST', '/api/search', { brief: 'x', saved_brief_id: 'y' })).status).toBe(400);
  });

  it.runIf(!hasKey)('without OPENAI_API_KEY: 503 and no search used', async () => {
    const t = await signIn('acme');
    expect((await api(t, 'POST', '/api/search', { brief: 'data scientists with a PhD' })).status).toBe(503);
    expect((await api(t, 'GET', '/api/plan')).body).toEqual({ plan: 'free', searches_remaining: 1 });
  });

  it.runIf(hasKey)('returns the contract shape, then 402 on the next search', async () => {
    const t = await signIn('acme');
    const r = await api(t, 'POST', '/api/search', { brief: 'data scientists with a PhD' });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ total: 47, searches_remaining: 0, filters: { roles: ['Data Scientist'], degrees: ['PhD'] } });
    expect(r.body.search_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(r.body.results).toHaveLength(20);
    expect(r.body.results[0].id).toMatch(/^cand_\d{4}$/);
    expect((await api(t, 'POST', '/api/search', { brief: 'mobile engineers who know Swift' })).status).toBe(402);
  });
});

describe('corrections (no AI, no quota)', () => {
  it('re-runs edited filters, inherits the brief, and does not use a search', async () => {
    const t = await signIn('acme');
    const parent = await readySearch(t, { roles: ['Data Scientist'], degrees: ['PhD'] });
    const r = await api(t, 'POST', '/api/search', { parent_search_id: parent, filters: { roles: ['Data Scientist'] } });
    expect(r.status).toBe(200);
    expect(r.body.total).toBe(323);
    expect(r.body.searches_remaining).toBe(0); // unchanged: the one search was used by readySearch
  });

  it('rejects non-object filters (400), unknown or foreign parents (404), and the 11th correction (429)', async () => {
    const acme = await signIn('acme');
    const globexSearch = await readySearch(await signIn('globex'), { roles: ['Recruiter'] });
    const parent = await readySearch(acme, { roles: ['Recruiter'] });
    expect((await api(acme, 'POST', '/api/search', { parent_search_id: parent, filters: 'Recruiter' })).status).toBe(400);
    const odd = await api(acme, 'POST', '/api/search', { parent_search_id: parent, filters: { roles: 'Recruiter' } });
    expect(odd.status).toBe(200); // wrong type → unsupported chip, nobody returned (FR-2.3)
    expect(odd.body.total).toBe(0);
    expect((await api(acme, 'POST', '/api/search', { parent_search_id: globexSearch, filters: { roles: ['Recruiter'] } })).status).toBe(404);
    expect((await api(acme, 'POST', '/api/search', { parent_search_id: 'not-a-uuid', filters: {} })).status).toBe(400);
    for (let i = 0; i < 9; i++) { // the odd-type correction above was the 1st of 10
      expect((await api(acme, 'POST', '/api/search', { parent_search_id: parent, filters: { roles: ['Recruiter'] } })).status).toBe(200);
    }
    expect((await api(acme, 'POST', '/api/search', { parent_search_id: parent, filters: { roles: ['Recruiter'] } })).status).toBe(429);
  });

  it('an unsupported value from the browser returns nobody, never everyone', async () => {
    const t = await signIn('acme');
    const parent = await readySearch(t, { roles: ['Recruiter'] });
    const r = await api(t, 'POST', '/api/search', { parent_search_id: parent, filters: { cities: ['London'] } });
    expect(r.status).toBe(200);
    expect(r.body.total).toBe(0);
    expect(r.body.filters.unsupported).toEqual([{ text: 'London', reason: 'unsupported' }]);
  });
});

describe('saved re-run (no AI, uses quota)', () => {
  it('runs the stored filters and uses the free search; foreign IDs are 404', async () => {
    const db = admin();
    const saved = (await db.from('saved_briefs').insert({ company_id: COMPANY.acme, brief: 'phd ds', filters: { roles: ['Data Scientist'], degrees: ['PhD'] } }).select('id').single()).data!.id;
    const foreign = (await db.from('saved_briefs').insert({ company_id: COMPANY.globex, brief: 'g', filters: { roles: ['Recruiter'] } }).select('id').single()).data!.id;
    const t = await signIn('acme');
    expect((await api(t, 'POST', '/api/search', { saved_brief_id: foreign })).status).toBe(404);
    const r = await api(t, 'POST', '/api/search', { saved_brief_id: saved });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ total: 47, searches_remaining: 0 });
    expect((await api(t, 'POST', '/api/search', { saved_brief_id: saved })).status).toBe(402);
  });
});

describe('GET /api/search/{id}?page=N', () => {
  it('pages every result exactly once, never counts as a search, and handles bad pages', async () => {
    const t = await signIn('acme');
    const id = await readySearch(t, { roles: ['Mobile Engineer'], skills: ['Swift'] });
    const seen: string[] = [];
    for (let page = 1; page <= 10; page++) {
      const r = await api(t, 'GET', `/api/search/${id}?page=${page}`);
      expect(r.status).toBe(200);
      expect(r.body).toMatchObject({ search_id: id, page, total: 199 });
      seen.push(...r.body.results.map((c: { id: string }) => c.id));
    }
    expect(new Set(seen).size).toBe(199);
    expect(seen).toHaveLength(199);
    expect((await api(t, 'GET', `/api/search/${id}?page=11`)).body.results).toEqual([]);
    for (const bad of ['0', '-1', 'abc', '1.5']) expect((await api(t, 'GET', `/api/search/${id}?page=${bad}`)).status).toBe(400);
    expect((await api(t, 'GET', `/api/search/${id}`)).status).toBe(200); // page defaults to 1
    expect((await api(t, 'GET', '/api/plan')).body).toEqual({ plan: 'free', searches_remaining: 0 });
  });

  it('another company cannot page my search (404), and malformed IDs are 400', async () => {
    const id = await readySearch(await signIn('acme'), { roles: ['Recruiter'] });
    const globex = await signIn('globex');
    expect((await api(globex, 'GET', `/api/search/${id}?page=1`)).status).toBe(404);
    expect((await api(globex, 'GET', '/api/search/not-a-uuid?page=1')).status).toBe(400);
  });
});

describe('GET /api/plan', () => {
  it('free: 1 then 0; paid: null', async () => {
    const t = await signIn('acme');
    expect((await api(t, 'GET', '/api/plan')).body).toEqual({ plan: 'free', searches_remaining: 1 });
    await readySearch(t, { roles: ['Recruiter'] });
    expect((await api(t, 'GET', '/api/plan')).body).toEqual({ plan: 'free', searches_remaining: 0 });
    await admin().from('companies').update({ plan: 'paid' }).eq('id', COMPANY.acme);
    expect((await api(t, 'GET', '/api/plan')).body).toEqual({ plan: 'paid', searches_remaining: null });
  });
});
