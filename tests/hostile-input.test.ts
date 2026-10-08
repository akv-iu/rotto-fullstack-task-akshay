import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BASE, COMPANY, admin, api, resetCompany, signIn } from './helpers';

// Text Postgres refuses to store (a NUL character, half an emoji) and absurdly deep JSON must be a clean 400,
// never a 500: the brief scores hostile input on "doesn't crash".
const NUL = 'a\u0000b';
const HALF_EMOJI = 'a\ud83db'; // a lone surrogate: not valid text
const deep = (n: number) => '{"a":'.repeat(n) + '1' + '}'.repeat(n);

let acme: string;
beforeAll(async () => { await resetCompany('acme'); acme = await signIn('acme'); });
afterAll(() => resetCompany('acme'));

describe('text the database cannot store → 400, nothing used or saved', () => {
  it.each([
    ['search brief', '/api/search', (s: string) => ({ brief: `data scientists ${s}` })],
    ['shortlist name', '/api/shortlists', (s: string) => ({ name: s })],
    ['saved search brief', '/api/saved-briefs', (s: string) => ({ brief: s, filters: { roles: ['Recruiter'] } })],
    ['saved search filter value', '/api/saved-briefs', (s: string) => ({ brief: 'x', filters: { roles: [s] } })],
  ])('%s', async (_name, path, body) => {
    for (const bad of [NUL, HALF_EMOJI]) expect((await api(acme, 'POST', path, body(bad))).status).toBe(400);
    expect((await api(acme, 'GET', '/api/plan')).body).toEqual({ plan: 'free', searches_remaining: 1 });
  });

  it('filters nested thousands of levels deep', async () => {
    const res = await fetch(`${BASE}/api/saved-briefs`, {
      method: 'POST', headers: { authorization: `Bearer ${acme}`, 'content-type': 'application/json' },
      body: `{"brief":"deep","filters":${deep(5000)}}`,
    });
    expect(res.status).toBe(400);
  });
});

describe.runIf(Boolean(process.env.STRIPE_WEBHOOK_SECRET))('webhook', () => {
  it('a correctly signed event with a NUL in it is ignored with 200 and changes nothing', async () => {
    const raw = JSON.stringify({ id: 'evt_\u0000x', type: 'customer.subscription.created', created: 5,
      data: { object: { id: 'sub_\u0000x', status: 'active', metadata: { company: 'acme' } } } });
    const t = 1700000000;
    const sig = `t=${t},v1=${createHmac('sha256', process.env.STRIPE_WEBHOOK_SECRET!).update(`${t}.${raw}`).digest('hex')}`;
    const res = await fetch(`${BASE}/api/billing/events`, { method: 'POST', headers: { 'stripe-signature': sig }, body: raw });
    expect(res.status).toBe(200);
    expect((await admin().from('companies').select('plan').eq('id', COMPANY.acme).single()).data).toEqual({ plan: 'free' });
  });
});
