import { beforeEach, describe, expect, it } from 'vitest';
import { COMPANY, admin, api, signIn } from './helpers';

let acme: string, globexSaved: string;

beforeEach(async () => {
  const db = admin();
  await db.from('saved_briefs').delete().in('company_id', [COMPANY.acme, COMPANY.globex]);
  globexSaved = (await db.from('saved_briefs').insert({ company_id: COMPANY.globex, brief: 'globex brief', filters: { roles: ['Recruiter'] } }).select('id').single()).data!.id;
  acme = await signIn('acme');
});

describe('saved searches', () => {
  it('saves cleaned filters and lists them newest first', async () => {
    const a = await api(acme, 'POST', '/api/saved-briefs', { brief: 'phd ds', filters: { roles: ['Data Scientist'], degrees: ['PhD'] } });
    expect(a.status).toBe(200);
    const b = await api(acme, 'POST', '/api/saved-briefs', { brief: 'london', filters: { cities: ['London'] } });
    const list = (await api(acme, 'GET', '/api/saved-briefs')).body;
    expect(list.map((s: { id: string }) => s.id)).toEqual([b.body.id, a.body.id]);
    expect(list[1]).toMatchObject({ brief: 'phd ds', filters: { roles: ['Data Scientist'], degrees: ['PhD'] } });
    expect(list[0].filters).toEqual({ unsupported: [{ text: 'London', reason: 'unsupported' }] });
  });

  it('400 for a bad body; delete is own-company only', async () => {
    expect((await api(acme, 'POST', '/api/saved-briefs', { brief: '', filters: {} })).status).toBe(400);
    expect((await api(acme, 'POST', '/api/saved-briefs', { brief: 'x', filters: 'roles' })).status).toBe(400);
    expect((await api(acme, 'POST', '/api/saved-briefs', { brief: 'x' })).status).toBe(400);
    expect(JSON.stringify((await api(acme, 'GET', '/api/saved-briefs')).body)).not.toContain(globexSaved);
    expect((await api(acme, 'DELETE', `/api/saved-briefs/${globexSaved}`)).status).toBe(404);
    expect((await api(acme, 'DELETE', '/api/saved-briefs/not-a-uuid')).status).toBe(400);
    expect((await api(null, 'GET', '/api/saved-briefs')).status).toBe(401);
    expect((await admin().from('saved_briefs').select('id').eq('id', globexSaved)).data).toHaveLength(1);
    const { id } = (await api(acme, 'POST', '/api/saved-briefs', { brief: 'x', filters: { roles: ['Recruiter'] } })).body;
    expect((await api(acme, 'DELETE', `/api/saved-briefs/${id}`)).status).toBe(200);
  });
});

describe('GET /api/people/{id}', () => {
  it('returns experience, education and skills; 404 unknown; 400 malformed; 401 signed out', async () => {
    const r = await api(acme, 'GET', '/api/people/cand_1634');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ id: 'cand_1634', full_name: 'Felix Walsh' });
    expect(r.body.experiences.length).toBeGreaterThan(0);
    expect(r.body.education.length).toBeGreaterThan(0);
    expect(r.body.skills).toContain('React');
    expect((await api(acme, 'GET', '/api/people/cand_9999')).status).toBe(404);
    expect((await api(acme, 'GET', '/api/people/1%20or%201=1')).status).toBe(400);
    expect((await api(acme, 'GET', '/api/people/%25')).status).toBe(400);
    expect((await api(null, 'GET', '/api/people/cand_1634')).status).toBe(401);
  });
});
