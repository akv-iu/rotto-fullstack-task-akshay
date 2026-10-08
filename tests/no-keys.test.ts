import { describe, expect, it } from 'vitest';
import { BASE, api, resetCompany, signIn } from './helpers';

const noKeys = !process.env.OPENAI_API_KEY && !process.env.STRIPE_WEBHOOK_SECRET;

describe.runIf(noKeys)('without OPENAI_API_KEY and STRIPE_WEBHOOK_SECRET', () => {
  it('sign-in and the plan work; search says 503 and uses no search', async () => {
    await resetCompany('acme');
    const t = await signIn('acme');
    expect((await api(t, 'POST', '/api/search', { brief: 'data scientists with a PhD' })).status).toBe(503);
    expect((await api(t, 'GET', '/api/plan')).body).toEqual({ plan: 'free', searches_remaining: 1 });
  });

  it('the webhook returns 500 and changes nothing', async () => {
    const res = await fetch(`${BASE}/api/billing/events`, { method: 'POST', headers: { 'stripe-signature': 't=1,v1=00' }, body: '{}' });
    expect(res.status).toBe(500);
    expect((await api(await signIn('acme'), 'GET', '/api/plan')).body.plan).toBe('free');
  });
});
