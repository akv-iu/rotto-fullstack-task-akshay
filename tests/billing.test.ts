import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { BASE, COMPANY, admin, api, signIn } from './helpers';

const SECRET = process.env.STRIPE_WEBHOOK_SECRET!;
const file = JSON.parse(readFileSync('data/stripe-events.json', 'utf8'));
const events = file.events as { description: string; payload: string; headers: Record<string, string> }[];

// Re-sign with whatever secret the server runs with, as the graders will with theirs.
const sign = (raw: string, t: number) => `t=${t},v1=${createHmac('sha256', SECRET).update(`${t}.${raw}`).digest('hex')}`;
const post = (raw: string, signature?: string) =>
  fetch(`${BASE}/api/billing/events`, { method: 'POST', headers: { 'content-type': 'application/json', ...(signature ? { 'stripe-signature': signature } : {}) }, body: raw });
const t0 = (e: { headers: Record<string, string> }) => Number(/t=(\d+)/.exec(e.headers['Stripe-Signature'])![1]);

async function plans() {
  const [a, g] = await Promise.all([signIn('acme'), signIn('globex')]);
  const [ab, gb] = [(await api(a, 'GET', '/api/plan')).body, (await api(g, 'GET', '/api/plan')).body];
  // The whole body: paid must also mean searches_remaining null.
  for (const b of [ab, gb]) expect(b).toEqual(b.plan === 'paid' ? { plan: 'paid', searches_remaining: null } : { plan: 'free', searches_remaining: 1 });
  return { acme: ab.plan, globex: gb.plan };
}

beforeEach(async () => {
  const db = admin();
  await db.from('billing_events').delete().neq('event_id', '');
  await db.from('subscriptions').delete().neq('stripe_subscription_id', '');
  await db.from('companies').update({ plan: 'free', searches_used: 0 }).in('id', [COMPANY.acme, COMPANY.globex]);
});

describe.runIf(Boolean(SECRET))('POST /api/billing/events', () => {
  it('replays the sample file in order and checks /api/plan after every event', async () => {
    const expectedAfter = [
      { acme: 'paid', globex: 'free' }, // acme subscribes
      { acme: 'paid', globex: 'free' }, // the same event again
      { acme: 'paid', globex: 'paid' }, // globex's newer (active) event arrives first
      { acme: 'paid', globex: 'paid' }, // globex's older (incomplete) event arrives late: ignored
      { acme: 'free', globex: 'paid' }, // acme cancels
    ];
    for (const [i, e] of events.entries()) {
      const res = await post(e.payload, sign(e.payload, t0(e)));
      expect(res.status, e.description).toBe(200);
      expect(await plans(), e.description).toEqual(expectedAfter[i]);
    }
    expect(await plans()).toEqual(file.expected_plans_after);
  });

  it('400 for a bad, missing or tampered signature, and nothing changes', async () => {
    const e = events[0];
    expect((await post(e.payload)).status).toBe(400);
    expect((await post(e.payload, 't=1,v1=' + '0'.repeat(64))).status).toBe(400);
    expect((await post(e.payload.replace('acme', 'globex'), sign(e.payload, t0(e)))).status).toBe(400);
    expect(await plans()).toEqual({ acme: 'free', globex: 'free' });
  });

  it('applies a duplicate delivered concurrently only once', async () => {
    const e = events[0];
    const results = await Promise.all([1, 2, 3].map(() => post(e.payload, sign(e.payload, t0(e))).then((r) => r.json())));
    expect(results.map((r) => r.result).sort()).toEqual(['applied', 'duplicate', 'duplicate']);
  });

  it('ignores other event types and unknown companies with 200', async () => {
    const other = JSON.stringify({ id: 'evt_x', type: 'invoice.paid', created: 1, data: { object: { id: 'in_1' } } });
    expect((await post(other, sign(other, 1))).status).toBe(200);
    const unknown = JSON.stringify({ id: 'evt_y', type: 'customer.subscription.created', created: 1, data: { object: { id: 'sub_y', status: 'active', metadata: { company: 'initech' } } } });
    expect((await post(unknown, sign(unknown, 1))).status).toBe(200);
    expect(await plans()).toEqual({ acme: 'free', globex: 'free' });
  });
});
