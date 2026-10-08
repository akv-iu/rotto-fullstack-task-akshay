import { beforeEach, describe, expect, it } from 'vitest';
import { COMPANY, admin, api, signIn } from './helpers';

let acme: string, globex: string, globexList: string;

beforeEach(async () => {
  const db = admin();
  await db.from('shortlists').delete().in('company_id', [COMPANY.acme, COMPANY.globex]);
  globexList = (await db.from('shortlists').insert({ company_id: COMPANY.globex, name: 'Globex list' }).select('id').single()).data!.id;
  await db.from('shortlist_members').insert({ shortlist_id: globexList, company_id: COMPANY.globex, candidate_id: 'cand_0001' });
  [acme, globex] = await Promise.all([signIn('acme'), signIn('globex')]);
});

describe('shortlists (contract)', () => {
  it('create returns 200 { id }, then it is listed with its members', async () => {
    const created = await api(acme, 'POST', '/api/shortlists', { name: '  Frontend NYC  ' });
    expect(created.status).toBe(200);
    expect(created.body.id).toMatch(/^[0-9a-f-]{36}$/);
    expect((await api(acme, 'POST', `/api/shortlists/${created.body.id}/people/cand_0629`)).status).toBe(200);
    const list = await api(acme, 'GET', '/api/shortlists');
    expect(list.body).toEqual([{ id: created.body.id, name: 'Frontend NYC', count: 1, candidate_ids: ['cand_0629'] }]);
  });

  it('adding someone already on the list changes nothing; removing is idempotent too', async () => {
    const { id } = (await api(acme, 'POST', '/api/shortlists', { name: 'A' })).body;
    for (let i = 0; i < 3; i++) expect((await api(acme, 'POST', `/api/shortlists/${id}/people/cand_0883`)).status).toBe(200);
    expect((await api(acme, 'GET', `/api/shortlists/${id}`)).body.people.map((p: { id: string }) => p.id)).toEqual(['cand_0883']);
    expect((await api(acme, 'DELETE', `/api/shortlists/${id}/people/cand_0883`)).status).toBe(200);
    expect((await api(acme, 'DELETE', `/api/shortlists/${id}/people/cand_0883`)).status).toBe(200);
    expect((await api(acme, 'GET', `/api/shortlists/${id}`)).body.people).toEqual([]);
  });

  it('validates names (400), rejects duplicates (409), renames and deletes', async () => {
    expect((await api(acme, 'POST', '/api/shortlists', { name: '   ' })).status).toBe(400);
    expect((await api(acme, 'POST', '/api/shortlists', { name: 'x'.repeat(81) })).status).toBe(400);
    expect((await api(acme, 'POST', '/api/shortlists', {})).status).toBe(400);
    const { id } = (await api(acme, 'POST', '/api/shortlists', { name: 'Dupes' })).body;
    expect((await api(acme, 'POST', '/api/shortlists', { name: 'Dupes' })).status).toBe(409);
    expect((await api(acme, 'POST', '/api/shortlists', { name: 'Globex list' })).status).toBe(200); // names are per company
    expect((await api(acme, 'PATCH', `/api/shortlists/${id}`, { name: 'Renamed' })).status).toBe(200);
    expect((await api(acme, 'GET', `/api/shortlists/${id}`)).body.name).toBe('Renamed');
    expect((await api(acme, 'PATCH', `/api/shortlists/${id}`, { name: 'Globex list' })).status).toBe(409); // rename onto a taken name
    expect((await api(acme, 'PATCH', `/api/shortlists/${id}`, { name: ' ' })).status).toBe(400);
    expect((await api(acme, 'PATCH', '/api/shortlists/not-a-uuid', { name: 'x' })).status).toBe(400);
    expect((await api(acme, 'DELETE', '/api/shortlists/not-a-uuid')).status).toBe(400);
    await api(acme, 'POST', `/api/shortlists/${id}/people/cand_0001`);
    expect((await api(acme, 'DELETE', `/api/shortlists/${id}`)).status).toBe(200);
    expect((await api(acme, 'GET', `/api/shortlists/${id}`)).status).toBe(404);
    // Deleting a list removes its members too (FR-6.6).
    expect((await admin().from('shortlist_members').select('candidate_id').eq('shortlist_id', id)).data).toEqual([]);
  });

  it('unknown candidate 404, malformed IDs 400, no token 401', async () => {
    const { id } = (await api(acme, 'POST', '/api/shortlists', { name: 'B' })).body;
    expect((await api(acme, 'POST', `/api/shortlists/${id}/people/cand_9999`)).status).toBe(404);
    expect((await api(acme, 'POST', `/api/shortlists/${id}/people/robert'); drop table--`)).status).toBe(400);
    expect((await api(acme, 'POST', `/api/shortlists/${id}/people/%25`)).status).toBe(400); // odd encoding: 400, never a crash
    expect((await api(acme, 'GET', '/api/shortlists/not-a-uuid')).status).toBe(400);
    expect((await api(null, 'GET', '/api/shortlists')).status).toBe(401);
  });
});

describe('acme cannot read or change globex shortlists through the API', () => {
  it('every attempt is 404 (or absent) and globex is untouched', async () => {
    expect(JSON.stringify((await api(acme, 'GET', '/api/shortlists')).body)).not.toContain(globexList);
    expect((await api(acme, 'GET', `/api/shortlists/${globexList}`)).status).toBe(404);
    expect((await api(acme, 'PATCH', `/api/shortlists/${globexList}`, { name: 'pwned' })).status).toBe(404);
    expect((await api(acme, 'POST', `/api/shortlists/${globexList}/people/cand_0002`)).status).toBe(404);
    expect((await api(acme, 'DELETE', `/api/shortlists/${globexList}/people/cand_0001`)).status).toBe(404);
    expect((await api(acme, 'DELETE', `/api/shortlists/${globexList}`)).status).toBe(404);
    const g = await api(globex, 'GET', `/api/shortlists/${globexList}`);
    expect(g.body).toMatchObject({ name: 'Globex list' });
    expect(g.body.people.map((p: { id: string }) => p.id)).toEqual(['cand_0001']);
  });
});
