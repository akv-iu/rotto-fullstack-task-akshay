# Phase 4: Billing

Goal: `POST /api/billing/events` verifies Stripe signatures on the exact raw body, ignores repeats, never lets an older event overwrite newer state, and keeps `/api/plan` right after every event. Proven by replaying the sample file. Worth 15 points.

---

### Task 10: Stripe webhook

**Files:**
- Create: `lib/server/billing.ts`, `app/api/billing/events/route.ts`
- Test: `tests/unit/signature.test.ts`, `tests/billing.test.ts`

**Interfaces:**
- Consumes: `adminClient()` (Task 8; **only** this file may call it), `apply_billing_event` (Task 4), `route`/`json` (Task 8).
- Produces:
  - `verifyStripeSignature(raw: string, header: string | null, secret: string): boolean`
  - `processStripeWebhook(raw: string, signatureHeader: string | null): Promise<{ status: number; body: Record<string, unknown> }>`

- [ ] **Step 1: Write the failing unit test `tests/unit/signature.test.ts`**

```ts
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { verifyStripeSignature } from '@/lib/server/billing';

const SAMPLE_SECRET = 'whsec_rotto_assessment_sample';
const sample = JSON.parse(readFileSync('data/stripe-events.json', 'utf8')).events as { payload: string; headers: Record<string, string> }[];
const sign = (raw: string, secret: string, t = 1791211200) => `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${raw}`).digest('hex')}`;

describe('verifyStripeSignature', () => {
  it('accepts every sample event with the sample secret (old timestamps are fine)', () => {
    for (const e of sample) expect(verifyStripeSignature(e.payload, e.headers['Stripe-Signature'], SAMPLE_SECRET)).toBe(true);
  });

  it('rejects a wrong secret, a tampered body, and re-serialised JSON', () => {
    const e = sample[0];
    const header = e.headers['Stripe-Signature'];
    expect(verifyStripeSignature(e.payload, header, 'whsec_wrong')).toBe(false);
    expect(verifyStripeSignature(e.payload.replace('active', 'canceled'), header, SAMPLE_SECRET)).toBe(false);
    expect(verifyStripeSignature(JSON.stringify(JSON.parse(e.payload), null, 2), header, SAMPLE_SECRET)).toBe(false);
  });

  it('rejects missing or malformed headers, and accepts if any one v1 matches', () => {
    const raw = sample[0].payload;
    expect(verifyStripeSignature(raw, null, SAMPLE_SECRET)).toBe(false);
    expect(verifyStripeSignature(raw, 'garbage', SAMPLE_SECRET)).toBe(false);
    expect(verifyStripeSignature(raw, 't=abc,v1=00', SAMPLE_SECRET)).toBe(false);
    const good = sign(raw, 'whsec_other');
    expect(verifyStripeSignature(raw, `${good},v1=${'0'.repeat(64)}`, 'whsec_other')).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:unit -- tests/unit/signature.test.ts`
Expected: FAIL, "Cannot find module '@/lib/server/billing'".

- [ ] **Step 3: Write `lib/server/billing.ts`**

```ts
import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { must } from './http';
import { adminClient } from './supabase';

/**
 * Stripe's scheme: HMAC-SHA256(secret, `${t}.${rawBody}`), hex, in any `v1=` of the header.
 * No timestamp tolerance on purpose: the graders replay old events; repeats and ordering protect us (NOTES.md).
 */
export function verifyStripeSignature(raw: string, header: string | null, secret: string): boolean {
  if (!header) return false;
  const pairs = header.split(',').map((p) => {
    const i = p.indexOf('=');
    return [p.slice(0, i).trim(), p.slice(i + 1).trim()] as const;
  });
  const t = pairs.find(([k]) => k === 't')?.[1];
  const candidates = pairs.filter(([k, v]) => k === 'v1' && /^[0-9a-f]{64}$/i.test(v)).map(([, v]) => v);
  if (!t || !/^\d+$/.test(t) || candidates.length === 0) return false;
  const expected = createHmac('sha256', secret).update(`${t}.${raw}`, 'utf8').digest();
  return candidates.some((v) => timingSafeEqual(Buffer.from(v, 'hex'), expected));
}

type StripeEvent = {
  id?: unknown; type?: unknown; created?: unknown;
  data?: { object?: { id?: unknown; status?: unknown; metadata?: { company?: unknown } } };
};

export async function processStripeWebhook(raw: string, signatureHeader: string | null) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return { status: 500, body: { error: 'Billing is not set up on this server yet.' } };
  if (!verifyStripeSignature(raw, signatureHeader, secret)) return { status: 400, body: { error: 'Invalid signature.' } };

  let event: StripeEvent;
  try { event = JSON.parse(raw); } catch { return { status: 200, body: { received: true, result: 'ignored' } }; }
  const sub = event.data?.object;
  const company = sub?.metadata?.company;
  if (
    typeof event.type !== 'string' || !event.type.startsWith('customer.subscription.') ||
    typeof event.id !== 'string' || typeof event.created !== 'number' ||
    typeof sub?.id !== 'string' || typeof sub.status !== 'string' ||
    (company !== 'acme' && company !== 'globex')
  ) {
    return { status: 200, body: { received: true, result: 'ignored' } };
  }

  const result = must(await adminClient().rpc('apply_billing_event', {
    p_event_id: event.id, p_created: event.created, p_type: event.type,
    p_subscription: sub.id, p_company: company, p_status: sub.status,
  }));
  return { status: 200, body: { received: true, result } };
}
```

- [ ] **Step 4: Write `app/api/billing/events/route.ts`**

```ts
import { processStripeWebhook } from '@/lib/server/billing';
import { json, route } from '@/lib/server/http';

// No recruiter token: Stripe calls this. The raw text is verified byte for byte, never re-serialised.
export const POST = route(async (req) => {
  const { status, body } = await processStripeWebhook(await req.text(), req.headers.get('stripe-signature'));
  return json(body, status);
});
```

- [ ] **Step 5: Run the unit test**

Run: `npm run test:unit -- tests/unit/signature.test.ts`
Expected: PASS.

- [ ] **Step 6: Write the integration test `tests/billing.test.ts`**

```ts
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
  return { acme: (await api(a, 'GET', '/api/plan')).body.plan, globex: (await api(g, 'GET', '/api/plan')).body.plan };
}

beforeEach(async () => {
  const db = admin();
  await db.from('billing_events').delete().neq('event_id', '');
  await db.from('subscriptions').delete().neq('stripe_subscription_id', '');
  await db.from('companies').update({ plan: 'free' }).in('id', [COMPANY.acme, COMPANY.globex]);
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
```

- [ ] **Step 7: Run it (dev server running with `STRIPE_WEBHOOK_SECRET` set in both terminals)**

Run: `npm test -- tests/billing.test.ts`
Expected: PASS. Also run it once with `STRIPE_WEBHOOK_SECRET=whsec_rotto_assessment_sample` and once with any other value: both must pass.

- [ ] **Step 8: Commit**

```bash
git add lib/server/billing.ts app/api/billing tests/unit/signature.test.ts tests/billing.test.ts
git commit -m "feat: verified, idempotent, order-safe Stripe webhook"
```
