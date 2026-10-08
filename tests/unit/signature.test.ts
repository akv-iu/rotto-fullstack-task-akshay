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
