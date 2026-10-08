# Phase 4: Billing

> **In short:** Receives Stripe's billing events, checks each signature against the exact bytes that were sent, and updates the company's plan.
> Repeats are ignored and older events never overwrite newer ones; replaying the sample file ends with acme free and globex paid, with `/api/plan` checked after every event.

Goal: `POST /api/billing/events` verifies Stripe signatures on the exact raw body, ignores repeats, never lets an older event overwrite newer state, and keeps `/api/plan` right after every event. Proven by replaying the sample file. Worth 15 points.

---

### Task 10: Stripe webhook

**Files:**
- Create: `lib/server/billing.ts`, `app/api/billing/events/route.ts`
- Modify: `.github/workflows/ci.yml` (adds the no-keys job)
- Test: `tests/unit/signature.test.ts`, `tests/billing.test.ts`, `tests/no-keys.test.ts`

**Interfaces:**
- Consumes: `adminClient()` (Task 8; **only** this file may call it), `apply_billing_event` (Task 4), `route`/`json`/`must` (Task 8).
- Produces:
  - `verifyStripeSignature(raw: string | Buffer, header: string | null, secret: string): boolean`
  - `processStripeWebhook(raw: Buffer | string, signatureHeader: string | null): Promise<{ status: number; body: Record<string, unknown> }>`

- [ ] **Step 1: Write the failing unit test `tests/unit/signature.test.ts`**

```ts
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { processStripeWebhook, verifyStripeSignature } from '@/lib/server/billing';

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

describe('processStripeWebhook without a database call', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('500 and no change when STRIPE_WEBHOOK_SECRET is not set (S7)', async () => {
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', '');
    expect((await processStripeWebhook(sample[0].payload, sample[0].headers['Stripe-Signature'])).status).toBe(500);
  });

  it('a correctly signed but odd body is acknowledged (200), never a retry loop', async () => {
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'whsec_other');
    for (const raw of ['null', '[]', '"x"', 'not json', JSON.stringify({ id: 'e', type: 'customer.subscription.created', created: 1.5, data: { object: { id: 's', status: 'active', metadata: { company: 'acme' } } } })]) {
      expect((await processStripeWebhook(raw, sign(raw, 'whsec_other'))).status, raw).toBe(200);
    }
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
export function verifyStripeSignature(raw: string | Buffer, header: string | null, secret: string): boolean {
  if (!header) return false;
  const pairs = header.split(',').map((p) => {
    const i = p.indexOf('=');
    return [p.slice(0, i).trim(), p.slice(i + 1).trim()] as const;
  });
  const t = pairs.find(([k]) => k === 't')?.[1];
  const candidates = pairs.filter(([k, v]) => k === 'v1' && /^[0-9a-f]{64}$/i.test(v)).map(([, v]) => v);
  if (!t || !/^\d+$/.test(t) || candidates.length === 0) return false;
  const expected = createHmac('sha256', secret).update(`${t}.`).update(raw).digest();
  return candidates.some((v) => timingSafeEqual(Buffer.from(v, 'hex'), expected));
}

type StripeEvent = {
  id?: unknown; type?: unknown; created?: unknown;
  data?: { object?: { id?: unknown; status?: unknown; metadata?: { company?: unknown } } };
};

const ignored = (why: string, id?: unknown) => {
  console.warn('billing event ignored:', why, typeof id === 'string' ? id : '');
  return { status: 200, body: { received: true, result: 'ignored' } };
};

/** 400 only for a bad signature; 500 only when we can't process (Stripe retries); anything else signed is a 200. */
export async function processStripeWebhook(raw: Buffer | string, signatureHeader: string | null) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return { status: 500, body: { error: 'Billing is not set up on this server yet.' } };
  if (!verifyStripeSignature(raw, signatureHeader, secret)) return { status: 400, body: { error: 'Invalid signature.' } };

  let event: StripeEvent;
  try { event = JSON.parse(raw.toString()); } catch { return ignored('not JSON'); }
  if (!event || typeof event !== 'object' || Array.isArray(event)) return ignored('not an object');
  const sub = event.data?.object;
  const company = sub?.metadata?.company;
  if (typeof event.type !== 'string' || !event.type.startsWith('customer.subscription.')) return ignored(`type ${String(event.type)}`, event.id);
  if (
    typeof event.id !== 'string' || !Number.isSafeInteger(event.created) ||
    typeof sub?.id !== 'string' || typeof sub.status !== 'string' || typeof company !== 'string'
  ) {
    return ignored('missing or malformed fields', event.id);
  }

  const result = must(await adminClient().rpc('apply_billing_event', {
    p_event_id: event.id, p_created: event.created, p_type: event.type,
    p_subscription: sub.id, p_company: company, p_status: sub.status,
  }));
  if (result === 'unknown_company') console.warn('billing event ignored: unknown company', company, event.id); // FR-9.5
  return { status: 200, body: { received: true, result } };
}
```

- [ ] **Step 4: Write `app/api/billing/events/route.ts`**

```ts
import { processStripeWebhook } from '@/lib/server/billing';
import { json, route } from '@/lib/server/http';

// No recruiter token: Stripe calls this. The raw bytes are verified exactly as sent, never decoded or re-serialised first.
export const POST = route(async (req) => {
  const { status, body } = await processStripeWebhook(Buffer.from(await req.arrayBuffer()), req.headers.get('stripe-signature'));
  return json(body, status);
});
```

- [ ] **Step 5: Run the unit test**

Run: `npm run test:unit -- tests/unit/signature.test.ts`
Expected: PASS (5 tests).

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
  const [ab, gb] = [(await api(a, 'GET', '/api/plan')).body, (await api(g, 'GET', '/api/plan')).body];
  // The whole body: paid must also mean searches_remaining null (SCORING §4).
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
```

- [ ] **Step 7: Run it (dev server running with `STRIPE_WEBHOOK_SECRET` set in both terminals)**

Run: `npm test -- tests/billing.test.ts`
Expected: PASS. Also run it once with `STRIPE_WEBHOOK_SECRET=whsec_rotto_assessment_sample` and once with any other value: both must pass.

- [ ] **Step 8: Write `tests/no-keys.test.ts` (S7: the app boots and works without the grader's keys)**

```ts
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
```

Then add a second CI job to `.github/workflows/ci.yml`, so this runs on every push with the keys really absent from the server:
```yaml
  no-keys:
    runs-on: ubuntu-latest
    timeout-minutes: 30
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
      - run: make setup
      - name: make dev (no OPENAI_API_KEY, no STRIPE_WEBHOOK_SECRET)
        run: |
          (make dev > dev.log 2>&1 &)
          for i in $(seq 90); do curl -sf http://localhost:3000 > /dev/null && exit 0; sleep 2; done
          cat dev.log; exit 1
      - run: node scripts/with-env.mjs vitest run tests/gate.test.ts tests/no-keys.test.ts
```
Locally: start `npm run dev` in a terminal with both variables unset, then `npm test -- tests/no-keys.test.ts` → PASS (2 tests).

- [ ] **Step 9: Commit**

```bash
git add lib/server/billing.ts app/api/billing tests/unit/signature.test.ts tests/billing.test.ts tests/no-keys.test.ts .github/workflows/ci.yml
git commit -m "feat: verified, idempotent, order-safe Stripe webhook"
```

---

## Requirements check (plan review, 2026-10-07)

An independent reviewer checked this phase against TECH_REQUIREMENTS, SCORING, SPEC, ARCHITECTURE and DESIGN. I verified each finding against those docs before accepting or rejecting it.

| Requirement | Where in this phase | Proof |
|---|---|---|
| B1 / TECH §3: 400 on a bad signature, 200 otherwise | `verifyStripeSignature` on the raw bytes | `tests/unit/signature.test.ts` (real sample signatures, tampered and re-serialised bodies) |
| B2: repeats ignored, including concurrent ones | `billing_events` primary key in the same transaction | billing "concurrent duplicate" test |
| B3 / FR-9.4: older events never win; same-second cancellation wins | `apply_billing_event` | sample replay + `db.test.ts` |
| FR-9.5: unknown company → 200, logged | `console.warn` | billing "ignores" test |
| SCORING §4: works with the grader's own secret; `/api/plan` right after every event | re-signs with the server's secret; CI uses a non-sample secret | replay checks the whole `/api/plan` body after each event |
| S7: no secret → 500, nothing changes | | unit test + `tests/no-keys.test.ts` in the CI `no-keys` job |

**Changed after review:** a correctly signed but odd body (`null`, an array, a fractional `created`) now gets 200 instead of a 500 that Stripe would retry forever; the signature is checked over the exact bytes received; ignored and unknown-company events are logged; the S7 test and a second CI job without keys; whole-body `/api/plan` checks; the TS company list was dropped (the database is the one source of truth); interface names fixed in the plan index.

**Rejected:** nothing.

**Verdict:** ready to implement.
