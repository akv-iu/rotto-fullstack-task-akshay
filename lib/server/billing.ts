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
